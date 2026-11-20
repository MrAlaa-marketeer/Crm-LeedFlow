-- Phase 10-12 foundations. All records are workspace-owned and RLS protected.
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS unit_id uuid;
UPDATE public.deals SET unit_id=property_id WHERE unit_id IS NULL AND property_id IS NOT NULL;
CREATE OR REPLACE FUNCTION public.sync_deal_unit_alias() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.unit_id IS NOT NULL AND NEW.property_id IS NOT NULL AND NEW.unit_id<>NEW.property_id THEN RAISE EXCEPTION 'Deal unit fields must match'; END IF;
  NEW.unit_id := coalesce(NEW.unit_id,NEW.property_id);
  NEW.property_id := coalesce(NEW.property_id,NEW.unit_id);
  RETURN NEW;
END; $$;
CREATE TRIGGER deals_sync_unit_alias BEFORE INSERT OR UPDATE OF unit_id,property_id ON public.deals FOR EACH ROW EXECUTE FUNCTION public.sync_deal_unit_alias();
CREATE TABLE public.deal_stage_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE, from_stage public.deal_stage, to_stage public.deal_stage NOT NULL,
  changed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.deal_stage_history ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.deal_stage_history TO authenticated;
CREATE POLICY "Members read deal stage history" ON public.deal_stage_history FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE OR REPLACE FUNCTION public.log_deal_stage() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN IF TG_OP='INSERT' OR NEW.stage IS DISTINCT FROM OLD.stage THEN
  INSERT INTO public.deal_stage_history(workspace_id,deal_id,from_stage,to_stage,changed_by) VALUES(NEW.workspace_id,NEW.id,CASE WHEN TG_OP='INSERT' THEN NULL ELSE OLD.stage END,NEW.stage,auth.uid());
END IF; RETURN NEW; END; $$;
CREATE TRIGGER deals_stage_history AFTER INSERT OR UPDATE OF stage ON public.deals FOR EACH ROW EXECUTE FUNCTION public.log_deal_stage();
DO $$ BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL AND to_regclass('storage.objects') IS NOT NULL THEN
    INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
      VALUES('unit-media','unit-media',false,5242880,ARRAY['image/jpeg','image/png','image/webp'])
      ON CONFLICT (id) DO NOTHING;
    EXECUTE 'CREATE POLICY "Workspace members upload unit media" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id=''unit-media'' AND public.is_workspace_member((storage.foldername(name))[1]::uuid))';
    EXECUTE 'CREATE POLICY "Workspace members read unit media" ON storage.objects FOR SELECT TO authenticated USING (bucket_id=''unit-media'' AND public.is_workspace_member((storage.foldername(name))[1]::uuid))';
    EXECUTE 'CREATE POLICY "Workspace members delete unit media" ON storage.objects FOR DELETE TO authenticated USING (bucket_id=''unit-media'' AND public.is_workspace_member((storage.foldername(name))[1]::uuid))';
  END IF;
END $$;

CREATE TABLE public.unit_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  property_id uuid NOT NULL, storage_path text NOT NULL CHECK (char_length(storage_path) <= 500),
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp')), size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.whatsapp_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL, body_ar text NOT NULL, body_en text NOT NULL, enabled boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL, template_id uuid REFERENCES public.whatsapp_templates(id) ON DELETE SET NULL,
  agent_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL, body text NOT NULL, sent_at timestamptz NOT NULL DEFAULT now(), status text NOT NULL DEFAULT 'sent'
);
CREATE TABLE public.notification_reads (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE, notification_id uuid NOT NULL REFERENCES public.in_app_notifications(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id, notification_id)
);
CREATE TABLE public.lead_scores (
  lead_id uuid PRIMARY KEY REFERENCES public.leads(id) ON DELETE CASCADE, workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  score smallint NOT NULL CHECK (score BETWEEN 0 AND 100), band text NOT NULL CHECK (band IN ('hot','warm','cold')), reasons jsonb NOT NULL DEFAULT '{}'::jsonb, calculated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.saved_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE, name text NOT NULL, criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  whatsapp_alert boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL, agent_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  duration_seconds integer CHECK (duration_seconds >= 0), outcome text, notes text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL, property_id uuid, starts_at timestamptz NOT NULL, ends_at timestamptz,
  status text NOT NULL DEFAULT 'scheduled', feedback text, calendar_event_id text, created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.rental_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  property_id uuid, landlord_name text NOT NULL, tenant_name text NOT NULL, monthly_collection numeric(14,2) NOT NULL CHECK (monthly_collection >= 0),
  starts_on date NOT NULL, ends_on date, renewal_reminder_on date, status text NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  referrer_lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL, referred_lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  reward_egp numeric(14,2) NOT NULL DEFAULT 0 CHECK (reward_egp >= 0), status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.workspace_settings (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE, company_logo_path text, maps_api_key text,
  notification_preferences jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.agent_targets (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE, agent_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  month date NOT NULL, target_leads integer NOT NULL DEFAULT 0, target_revenue numeric(14,2) NOT NULL DEFAULT 0, PRIMARY KEY(workspace_id, agent_id, month)
);
CREATE TABLE public.price_change_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  property_id uuid NOT NULL, old_price numeric(14,2), new_price numeric(14,2), changed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS floor text;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS finishing text;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS down_payment numeric(14,2) CHECK (down_payment IS NULL OR down_payment >= 0);
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS resale_code text;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.unit_photos ADD CONSTRAINT unit_photos_property_workspace_fk FOREIGN KEY(property_id,workspace_id) REFERENCES public.properties(id,workspace_id) ON DELETE CASCADE;
ALTER TABLE public.deals ADD CONSTRAINT deals_unit_workspace_fk FOREIGN KEY(unit_id,workspace_id) REFERENCES public.properties(id,workspace_id) ON DELETE RESTRICT;
ALTER TABLE public.visits ADD CONSTRAINT visits_property_workspace_fk FOREIGN KEY(property_id,workspace_id) REFERENCES public.properties(id,workspace_id) ON DELETE SET NULL (property_id);
ALTER TABLE public.rental_contracts ADD CONSTRAINT rentals_property_workspace_fk FOREIGN KEY(property_id,workspace_id) REFERENCES public.properties(id,workspace_id) ON DELETE SET NULL (property_id);
ALTER TABLE public.price_change_history ADD CONSTRAINT price_history_property_workspace_fk FOREIGN KEY(property_id,workspace_id) REFERENCES public.properties(id,workspace_id) ON DELETE CASCADE;
CREATE OR REPLACE FUNCTION public.log_property_price_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
  IF NEW.price IS DISTINCT FROM OLD.price THEN
    INSERT INTO public.price_change_history(workspace_id,property_id,old_price,new_price,changed_by)
    VALUES(NEW.workspace_id,NEW.id,OLD.price,NEW.price,auth.uid());
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER properties_price_history AFTER UPDATE OF price ON public.properties FOR EACH ROW EXECUTE FUNCTION public.log_property_price_change();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['unit_photos','whatsapp_templates','whatsapp_messages','lead_scores','saved_searches','calls','visits','rental_contracts','referrals','agent_targets','price_change_history'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('CREATE POLICY "%I workspace access" ON public.%I FOR ALL TO authenticated USING (public.is_workspace_member(workspace_id)) WITH CHECK (public.is_workspace_member(workspace_id))', t, t);
  END LOOP;
END $$;
ALTER TABLE public.notification_reads ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_reads TO authenticated;
CREATE POLICY "Users read notification state" ON public.notification_reads FOR ALL TO authenticated
  USING (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.in_app_notifications n WHERE n.id=notification_id AND public.is_workspace_member(n.workspace_id)))
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.in_app_notifications n WHERE n.id=notification_id AND public.is_workspace_member(n.workspace_id)));
ALTER TABLE public.workspace_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.workspace_settings TO authenticated;
CREATE POLICY "Workspace settings access" ON public.workspace_settings FOR ALL TO authenticated USING (public.is_workspace_member(workspace_id)) WITH CHECK (public.has_workspace_role(workspace_id,'owner'));

CREATE OR REPLACE FUNCTION public.recalculate_lead_score(_lead_id uuid)
RETURNS public.lead_scores LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE l public.leads%ROWTYPE; result public.lead_scores%ROWTYPE; s integer := 0; b text;
BEGIN
  SELECT * INTO l FROM public.leads WHERE id=_lead_id;
  IF l.id IS NULL THEN RAISE EXCEPTION 'Lead not found'; END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_workspace_member(l.workspace_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF l.budget_max IS NOT NULL OR l.budget_min IS NOT NULL THEN s := s + 30; END IF;
  IF l.next_follow_up_at IS NOT NULL THEN s := s + 20; END IF;
  IF l.status IN ('qualified','meeting','negotiation') THEN s := s + 30; ELSIF l.status='contacted' THEN s := s + 15; END IF;
  IF l.first_response_minutes IS NOT NULL AND l.first_response_minutes <= 5 THEN s := s + 20; END IF;
  s := least(s,100); b := CASE WHEN s >= 70 THEN 'hot' WHEN s >= 40 THEN 'warm' ELSE 'cold' END;
  INSERT INTO public.lead_scores(lead_id,workspace_id,score,band,reasons) VALUES(l.id,l.workspace_id,s,b,jsonb_build_object('budget',l.budget_min IS NOT NULL OR l.budget_max IS NOT NULL))
  ON CONFLICT(lead_id) DO UPDATE SET score=excluded.score, band=excluded.band, reasons=excluded.reasons, calculated_at=now()
  RETURNING * INTO result; RETURN result;
END; $$;
GRANT EXECUTE ON FUNCTION public.recalculate_lead_score(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.recalculate_lead_score(uuid) FROM PUBLIC, anon;
