-- ===== Enums =====
CREATE TYPE public.workspace_role AS ENUM ('owner', 'agent');
CREATE TYPE public.lead_source AS ENUM ('facebook', 'instagram', 'whatsapp', 'referral', 'website', 'other');
CREATE TYPE public.lead_status AS ENUM ('new', 'contacted', 'qualified', 'meeting', 'negotiation', 'won', 'lost');

-- ===== Shared updated_at helper =====
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ===== Profiles =====
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text CHECK (full_name IS NULL OR char_length(full_name) <= 120),
  phone text CHECK (phone IS NULL OR char_length(phone) <= 25),
  language text NOT NULL DEFAULT 'ar' CHECK (language IN ('ar', 'en')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ===== Workspaces =====
CREATE TABLE public.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.workspaces TO authenticated;
GRANT ALL ON public.workspaces TO service_role;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER workspaces_updated_at BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ===== Workspace members (tenant-scoped roles; only writable by server/triggers) =====
CREATE TABLE public.workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role public.workspace_role NOT NULL DEFAULT 'agent',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);
CREATE INDEX workspace_members_user_idx ON public.workspace_members(user_id);
GRANT SELECT ON public.workspace_members TO authenticated;
GRANT ALL ON public.workspace_members TO service_role;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

-- ===== Membership helpers (security definer avoids recursive RLS) =====
CREATE OR REPLACE FUNCTION public.is_workspace_member(_workspace_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = _workspace_id AND user_id = auth.uid()
  )
$$;

CREATE OR REPLACE FUNCTION public.has_workspace_role(_workspace_id uuid, _role public.workspace_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = _workspace_id AND user_id = auth.uid() AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.is_user_in_workspace(_user_id uuid, _workspace_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = _workspace_id AND user_id = _user_id
      AND (auth.role() = 'service_role' OR public.is_workspace_member(_workspace_id))
  )
$$;

CREATE OR REPLACE FUNCTION public.shares_workspace_with(_other_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members me
    JOIN public.workspace_members other ON other.workspace_id = me.workspace_id
    WHERE me.user_id = auth.uid() AND other.user_id = _other_user
  )
$$;

REVOKE EXECUTE ON FUNCTION public.is_workspace_member(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_workspace_role(uuid, public.workspace_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_user_in_workspace(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.shares_workspace_with(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_workspace_role(uuid, public.workspace_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_user_in_workspace(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shares_workspace_with(uuid) TO authenticated;

-- Profiles policies
CREATE POLICY "Read own or teammate profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.shares_workspace_with(id));
CREATE POLICY "Update own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- Workspaces policies
CREATE POLICY "Members read their workspace" ON public.workspaces
  FOR SELECT TO authenticated USING (public.is_workspace_member(id));
CREATE POLICY "Owners update their workspace" ON public.workspaces
  FOR UPDATE TO authenticated
  USING (public.has_workspace_role(id, 'owner'))
  WITH CHECK (public.has_workspace_role(id, 'owner'));

-- Members policies (read-only for clients)
CREATE POLICY "Members read workspace roster" ON public.workspace_members
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));

-- ===== Leads =====
CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  full_name text NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 1 AND 150),
  phone text NOT NULL CHECK (char_length(phone) BETWEEN 4 AND 25),
  email text CHECK (email IS NULL OR char_length(email) <= 255),
  source public.lead_source NOT NULL DEFAULT 'other',
  interested_project text CHECK (interested_project IS NULL OR char_length(interested_project) <= 200),
  preferred_area text CHECK (preferred_area IS NULL OR char_length(preferred_area) <= 200),
  budget_min numeric(14, 0) CHECK (budget_min IS NULL OR budget_min >= 0),
  budget_max numeric(14, 0) CHECK (budget_max IS NULL OR budget_max >= 0),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 5000),
  assigned_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  status public.lead_status NOT NULL DEFAULT 'new',
  status_changed_at timestamptz NOT NULL DEFAULT now(),
  next_follow_up_at timestamptz,
  is_demo boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leads_budget_range CHECK (budget_min IS NULL OR budget_max IS NULL OR budget_max >= budget_min)
);
CREATE INDEX leads_ws_created_idx ON public.leads(workspace_id, created_at DESC);
CREATE INDEX leads_ws_status_idx ON public.leads(workspace_id, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT ALL ON public.leads TO service_role;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read leads" ON public.leads
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE POLICY "Members create leads" ON public.leads
  FOR INSERT TO authenticated WITH CHECK (public.is_workspace_member(workspace_id));
CREATE POLICY "Members update leads" ON public.leads
  FOR UPDATE TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));
CREATE POLICY "Owners delete leads" ON public.leads
  FOR DELETE TO authenticated USING (public.has_workspace_role(workspace_id, 'owner'));

CREATE OR REPLACE FUNCTION public.leads_before_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.workspace_id <> OLD.workspace_id THEN
      RAISE EXCEPTION 'Leads cannot move between workspaces';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      NEW.status_changed_at = now();
    END IF;
    NEW.updated_at = now();
  END IF;
  IF NEW.assigned_to IS NOT NULL AND NOT public.is_user_in_workspace(NEW.assigned_to, NEW.workspace_id) THEN
    RAISE EXCEPTION 'Assigned agent must belong to this workspace';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER leads_before_write BEFORE INSERT OR UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.leads_before_write();

-- ===== Follow-ups =====
CREATE TABLE public.follow_ups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 2000),
  due_at timestamptz NOT NULL,
  completed_at timestamptz,
  assigned_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  is_demo boolean NOT NULL DEFAULT false,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX follow_ups_ws_due_idx ON public.follow_ups(workspace_id, due_at) WHERE completed_at IS NULL;
CREATE INDEX follow_ups_lead_idx ON public.follow_ups(lead_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.follow_ups TO authenticated;
GRANT ALL ON public.follow_ups TO service_role;
ALTER TABLE public.follow_ups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read follow-ups" ON public.follow_ups
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE POLICY "Members create follow-ups" ON public.follow_ups
  FOR INSERT TO authenticated WITH CHECK (public.is_workspace_member(workspace_id));
CREATE POLICY "Members update follow-ups" ON public.follow_ups
  FOR UPDATE TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));
CREATE POLICY "Members delete follow-ups" ON public.follow_ups
  FOR DELETE TO authenticated USING (public.is_workspace_member(workspace_id));

-- Force follow-up workspace to match its lead (blocks cross-tenant attachment)
CREATE OR REPLACE FUNCTION public.follow_ups_before_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  lead_ws uuid;
BEGIN
  SELECT workspace_id INTO lead_ws FROM public.leads WHERE id = NEW.lead_id;
  IF lead_ws IS NULL THEN
    RAISE EXCEPTION 'Lead not found';
  END IF;
  NEW.workspace_id = lead_ws;
  IF NEW.assigned_to IS NOT NULL AND NOT public.is_user_in_workspace(NEW.assigned_to, lead_ws) THEN
    RAISE EXCEPTION 'Assigned agent must belong to this workspace';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER follow_ups_before_write BEFORE INSERT OR UPDATE ON public.follow_ups
  FOR EACH ROW EXECUTE FUNCTION public.follow_ups_before_write();

-- Keep leads.next_follow_up_at = earliest open follow-up
CREATE OR REPLACE FUNCTION public.sync_lead_next_follow_up(_lead_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  UPDATE public.leads l
  SET next_follow_up_at = (
    SELECT min(f.due_at) FROM public.follow_ups f
    WHERE f.lead_id = _lead_id AND f.completed_at IS NULL
  )
  WHERE l.id = _lead_id;
$$;
REVOKE EXECUTE ON FUNCTION public.sync_lead_next_follow_up(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.follow_ups_after_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public.sync_lead_next_follow_up(NEW.lead_id);
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') AND (TG_OP = 'DELETE' OR OLD.lead_id <> NEW.lead_id) THEN
    PERFORM public.sync_lead_next_follow_up(OLD.lead_id);
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER follow_ups_after_write AFTER INSERT OR UPDATE OR DELETE ON public.follow_ups
  FOR EACH ROW EXECUTE FUNCTION public.follow_ups_after_write();

-- ===== Signup: profile + workspace + owner membership =====
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  meta jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  lang text := CASE WHEN meta->>'language' = 'en' THEN 'en' ELSE 'ar' END;
  display_name text := left(NULLIF(btrim(COALESCE(meta->>'full_name', meta->>'name', '')), ''), 120);
  agency text := left(NULLIF(btrim(COALESCE(meta->>'agency_name', '')), ''), 120);
  new_ws uuid;
BEGIN
  INSERT INTO public.profiles (id, full_name, language)
  VALUES (NEW.id, display_name, lang);

  INSERT INTO public.workspaces (name, created_by)
  VALUES (COALESCE(agency, CASE WHEN lang = 'en' THEN 'My Agency' ELSE 'وكالتي العقارية' END), NEW.id)
  RETURNING id INTO new_ws;

  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (new_ws, NEW.id, 'owner');

  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ===== Dashboard stats (RLS applies; explicit membership check) =====
CREATE OR REPLACE FUNCTION public.dashboard_stats(
  _workspace_id uuid,
  _from timestamptz,
  _to timestamptz,
  _month_start timestamptz,
  _today_start timestamptz,
  _today_end timestamptz
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.is_workspace_member(_workspace_id) THEN
    RAISE EXCEPTION 'Not a member of this workspace';
  END IF;

  WITH active AS (
    SELECT * FROM public.leads WHERE workspace_id = _workspace_id AND archived_at IS NULL
  ),
  in_range AS (
    SELECT * FROM active
    WHERE (_from IS NULL OR created_at >= _from) AND (_to IS NULL OR created_at < _to)
  ),
  open_fu AS (
    SELECT f.* FROM public.follow_ups f
    JOIN public.leads l ON l.id = f.lead_id
    WHERE f.workspace_id = _workspace_id AND f.completed_at IS NULL AND l.archived_at IS NULL
  )
  SELECT jsonb_build_object(
    'total_leads', (SELECT count(*) FROM active),
    'new_this_month', (SELECT count(*) FROM active WHERE created_at >= _month_start),
    'range_leads', (SELECT count(*) FROM in_range),
    'range_won', (SELECT count(*) FROM in_range WHERE status = 'won'),
    'range_lost', (SELECT count(*) FROM in_range WHERE status = 'lost'),
    'overdue', (SELECT count(*) FROM open_fu WHERE due_at < _today_start),
    'due_today', (SELECT count(*) FROM open_fu WHERE due_at >= _today_start AND due_at < _today_end),
    'upcoming', (SELECT count(*) FROM open_fu WHERE due_at >= _today_end),
    'has_demo', (SELECT EXISTS (SELECT 1 FROM active WHERE is_demo)),
    'by_status', COALESCE((SELECT jsonb_object_agg(status, c) FROM (SELECT status, count(*) c FROM active GROUP BY status) s), '{}'::jsonb),
    'by_source', COALESCE((SELECT jsonb_object_agg(source, c) FROM (SELECT source, count(*) c FROM in_range GROUP BY source) s), '{}'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.dashboard_stats(uuid, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_stats(uuid, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz) TO authenticated;

-- ===== Demo data (clearly flagged with is_demo; user-triggered per workspace) =====
CREATE OR REPLACE FUNCTION public.load_demo_data(_workspace_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  me uuid := auth.uid();
  rec record;
  new_id uuid;
  inserted integer := 0;
BEGIN
  IF NOT public.is_workspace_member(_workspace_id) THEN
    RAISE EXCEPTION 'Not a member of this workspace';
  END IF;
  IF EXISTS (SELECT 1 FROM public.leads WHERE workspace_id = _workspace_id AND is_demo) THEN
    RAISE EXCEPTION 'Demo data is already loaded';
  END IF;

  FOR rec IN
    SELECT * FROM (VALUES
      ('أحمد محمود (تجريبي)', '+201000000101', 'ahmed.demo@example.com', 'facebook', 'كمبوند النخيل - تجريبي', 'التجمع الخامس', 3500000, 5000000, 'new', 0, -2, 'مكالمة تعريفية'),
      ('منى عبد الرحمن (تجريبي)', '+201000000102', NULL, 'instagram', 'أبراج النيل - تجريبي', 'المعادي', 2000000, 3000000, 'contacted', 3, 0, 'إرسال عروض الأسعار'),
      ('كريم حسن (تجريبي)', '+201000000103', 'karim.demo@example.com', 'whatsapp', 'ريفيرا الساحل - تجريبي', 'الساحل الشمالي', 6000000, 9000000, 'qualified', 6, 1, 'تحديد موعد معاينة'),
      ('سارة إبراهيم (تجريبي)', '+201000000104', NULL, 'referral', 'جاردنز زايد - تجريبي', 'الشيخ زايد', 4000000, 6500000, 'meeting', 9, 0, 'تأكيد موعد الاجتماع'),
      ('عمر فاروق (تجريبي)', '+201000000105', 'omar.demo@example.com', 'website', 'العاصمة هايتس - تجريبي', 'العاصمة الإدارية', 2500000, 4000000, 'negotiation', 12, -1, 'متابعة خطة السداد'),
      ('ياسمين علي (تجريبي)', '+201000000106', NULL, 'facebook', 'كمبوند النخيل - تجريبي', 'التجمع الخامس', 5000000, 7000000, 'won', 20, NULL, NULL),
      ('محمد سعيد (تجريبي)', '+201000000107', NULL, 'instagram', 'أكتوبر بارك - تجريبي', '٦ أكتوبر', 1500000, 2500000, 'lost', 25, NULL, NULL),
      ('نورهان مصطفى (تجريبي)', '+201000000108', 'nourhan.demo@example.com', 'whatsapp', 'أبراج النيل - تجريبي', 'المعادي', 3000000, 4500000, 'new', 1, 3, 'مكالمة أولى'),
      ('حسام الدين (تجريبي)', '+201000000109', NULL, 'other', 'ريفيرا الساحل - تجريبي', 'الساحل الشمالي', 8000000, 12000000, 'qualified', 15, 5, 'إرسال الكتيب'),
      ('ريم خالد (تجريبي)', '+201000000110', NULL, 'referral', 'جاردنز زايد - تجريبي', 'الشيخ زايد', 3500000, 5500000, 'contacted', 4, -3, 'إعادة الاتصال'),
      ('طارق يوسف (تجريبي)', '+201000000111', 'tarek.demo@example.com', 'website', 'العاصمة هايتس - تجريبي', 'العاصمة الإدارية', 2000000, 3500000, 'won', 40, NULL, NULL),
      ('دينا شريف (تجريبي)', '+201000000112', NULL, 'facebook', 'أكتوبر بارك - تجريبي', '٦ أكتوبر', 1800000, 2800000, 'meeting', 7, 2, 'اجتماع في المكتب')
    ) AS t(full_name, phone, email, source, project, area, bmin, bmax, status, age_days, fu_days, fu_title)
  LOOP
    INSERT INTO public.leads (workspace_id, full_name, phone, email, source, interested_project, preferred_area,
      budget_min, budget_max, notes, assigned_to, status, is_demo, created_at)
    VALUES (_workspace_id, rec.full_name, rec.phone, rec.email, rec.source::public.lead_source, rec.project, rec.area,
      rec.bmin, rec.bmax, 'بيانات تجريبية للعرض فقط — ليست عميلاً حقيقياً.', me, rec.status::public.lead_status, true,
      now() - make_interval(days => rec.age_days))
    RETURNING id INTO new_id;
    inserted := inserted + 1;

    IF rec.fu_days IS NOT NULL THEN
      INSERT INTO public.follow_ups (workspace_id, lead_id, title, due_at, assigned_to, is_demo)
      VALUES (_workspace_id, new_id, rec.fu_title,
        date_trunc('hour', now()) + make_interval(days => rec.fu_days, hours => 2), me, true);
    END IF;
  END LOOP;

  RETURN inserted;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.load_demo_data(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.load_demo_data(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_demo_data(_workspace_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  removed integer;
BEGIN
  IF NOT public.has_workspace_role(_workspace_id, 'owner') THEN
    RAISE EXCEPTION 'Only the workspace owner can remove demo data';
  END IF;
  DELETE FROM public.follow_ups WHERE workspace_id = _workspace_id AND is_demo;
  DELETE FROM public.leads WHERE workspace_id = _workspace_id AND is_demo;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.remove_demo_data(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_demo_data(uuid) TO authenticated;
