-- Team invitations are created only by a trusted server using the Supabase Auth admin API.
CREATE TABLE public.workspace_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(btrim(email)) AND char_length(email) <= 255),
  role public.workspace_role NOT NULL DEFAULT 'agent' CHECK (role = 'agent'),
  invited_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  invited_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '1 hour'),
  consumed_at timestamptz,
  revoked_at timestamptz,
  UNIQUE (id, workspace_id)
);
CREATE UNIQUE INDEX workspace_invitations_active_email_idx
  ON public.workspace_invitations(workspace_id, lower(email))
  WHERE consumed_at IS NULL AND revoked_at IS NULL;
CREATE INDEX workspace_invitations_workspace_created_idx
  ON public.workspace_invitations(workspace_id, created_at DESC);
ALTER TABLE public.workspace_invitations ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.workspace_invitations TO authenticated;
GRANT ALL ON public.workspace_invitations TO service_role;
CREATE POLICY "Owners read workspace invitations" ON public.workspace_invitations
  FOR SELECT TO authenticated USING (public.has_workspace_role(workspace_id, 'owner'));
-- No authenticated INSERT/UPDATE/DELETE grants or policies. Server/admin only.

CREATE TABLE public.lead_assignment_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  from_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  to_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lead_assignment_history_workspace_changed_idx
  ON public.lead_assignment_history(workspace_id, changed_at DESC);
ALTER TABLE public.lead_assignment_history ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.lead_assignment_history TO authenticated;
GRANT ALL ON public.lead_assignment_history TO service_role;
CREATE POLICY "Members read assignment history" ON public.lead_assignment_history
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));

CREATE OR REPLACE FUNCTION public.log_lead_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    INSERT INTO public.lead_assignment_history (workspace_id, lead_id, from_user_id, to_user_id, actor_id)
    VALUES (NEW.workspace_id, NEW.id, OLD.assigned_to, NEW.assigned_to, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER leads_assignment_history AFTER UPDATE OF assigned_to ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.log_lead_assignment();

-- Safe, atomic removal: an owner cannot remove themselves or the workspace's sole owner.
CREATE OR REPLACE FUNCTION public.remove_workspace_member(_workspace_id uuid, _user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE target_role public.workspace_role;
BEGIN
  IF NOT public.has_workspace_role(_workspace_id, 'owner') THEN
    RAISE EXCEPTION 'Only the workspace owner can remove members';
  END IF;
  IF _user_id = auth.uid() THEN RAISE EXCEPTION 'The owner cannot remove themselves'; END IF;
  SELECT role INTO target_role FROM public.workspace_members
    WHERE workspace_id = _workspace_id AND user_id = _user_id FOR UPDATE;
  IF target_role IS NULL THEN RAISE EXCEPTION 'Workspace member not found'; END IF;
  IF target_role = 'owner' THEN RAISE EXCEPTION 'The workspace owner cannot be removed'; END IF;

  UPDATE public.leads SET assigned_to = NULL
    WHERE workspace_id = _workspace_id AND assigned_to = _user_id;
  UPDATE public.follow_ups SET assigned_to = NULL
    WHERE workspace_id = _workspace_id AND assigned_to = _user_id;
  DELETE FROM public.workspace_members WHERE workspace_id = _workspace_id AND user_id = _user_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.remove_workspace_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_workspace_member(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_workspace_invitation(_workspace_id uuid, _invitation_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE invited_user uuid;
BEGIN
  IF NOT public.has_workspace_role(_workspace_id, 'owner') THEN
    RAISE EXCEPTION 'Only the workspace owner can cancel invitations';
  END IF;
  SELECT invited_user_id INTO invited_user FROM public.workspace_invitations
    WHERE id = _invitation_id AND workspace_id = _workspace_id
      AND consumed_at IS NULL AND revoked_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active invitation not found'; END IF;
  UPDATE public.workspace_invitations SET revoked_at = now() WHERE id = _invitation_id;
  IF invited_user IS NOT NULL THEN
    UPDATE public.leads SET assigned_to = NULL
      WHERE workspace_id = _workspace_id AND assigned_to = invited_user;
    UPDATE public.follow_ups SET assigned_to = NULL
      WHERE workspace_id = _workspace_id AND assigned_to = invited_user;
    DELETE FROM public.workspace_members
      WHERE workspace_id = _workspace_id AND user_id = invited_user AND role = 'agent';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.cancel_workspace_invitation(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_workspace_invitation(uuid, uuid) TO authenticated;

-- One source of truth for the existing owner/agent model. Agents see only their own metrics.
CREATE OR REPLACE FUNCTION public.team_dashboard_stats(_workspace_id uuid)
RETURNS TABLE (
  user_id uuid,
  full_name text,
  role public.workspace_role,
  lead_count bigint,
  active_lead_count bigint,
  won_lead_count bigint,
  open_follow_up_count bigint,
  overdue_follow_up_count bigint,
  conversion_rate numeric
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF NOT public.is_workspace_member(_workspace_id) THEN
    RAISE EXCEPTION 'Not a member of this workspace';
  END IF;

  RETURN QUERY
  WITH visible_members AS (
    SELECT wm.user_id, wm.role, p.full_name
    FROM public.workspace_members wm
    JOIN public.profiles p ON p.id = wm.user_id
    WHERE wm.workspace_id = _workspace_id
      AND (public.has_workspace_role(_workspace_id, 'owner') OR wm.user_id = auth.uid())
  ), lead_totals AS (
    SELECT l.assigned_to,
      count(*) AS lead_count,
      count(*) FILTER (WHERE l.archived_at IS NULL AND l.status NOT IN ('won', 'lost')) AS active_lead_count,
      count(*) FILTER (WHERE l.status = 'won') AS won_lead_count
    FROM public.leads l
    WHERE l.workspace_id = _workspace_id AND l.assigned_to IS NOT NULL
    GROUP BY l.assigned_to
  ), follow_up_totals AS (
    SELECT f.assigned_to,
      count(*) FILTER (WHERE f.completed_at IS NULL) AS open_follow_up_count,
      count(*) FILTER (WHERE f.completed_at IS NULL AND f.due_at < now()) AS overdue_follow_up_count
    FROM public.follow_ups f
    WHERE f.workspace_id = _workspace_id AND f.assigned_to IS NOT NULL
    GROUP BY f.assigned_to
  )
  SELECT m.user_id, m.full_name, m.role,
    coalesce(l.lead_count, 0), coalesce(l.active_lead_count, 0), coalesce(l.won_lead_count, 0),
    coalesce(f.open_follow_up_count, 0), coalesce(f.overdue_follow_up_count, 0),
    CASE WHEN coalesce(l.lead_count, 0) = 0 THEN 0::numeric
      ELSE round(100.0 * coalesce(l.won_lead_count, 0) / l.lead_count, 1) END
  FROM visible_members m
  LEFT JOIN lead_totals l ON l.assigned_to = m.user_id
  LEFT JOIN follow_up_totals f ON f.assigned_to = m.user_id
  ORDER BY m.role, m.full_name NULLS LAST;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.team_dashboard_stats(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_dashboard_stats(uuid) TO authenticated;

-- Invitation members become active only after the invited address confirms its email.
CREATE OR REPLACE FUNCTION public.mark_workspace_invitation_confirmed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL THEN
    UPDATE public.workspace_invitations
      SET consumed_at = now()
      WHERE invited_user_id = NEW.id AND consumed_at IS NULL AND revoked_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER auth_user_confirms_workspace_invitation
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.mark_workspace_invitation_confirmed();

-- Auth invitations carry a random server-created invitation id in user metadata.
-- A supplied but invalid/revoked/expired invitation never falls back to owner signup.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  meta jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  lang text := CASE WHEN meta->>'language' = 'en' THEN 'en' ELSE 'ar' END;
  display_name text := left(NULLIF(btrim(COALESCE(meta->>'full_name', meta->>'name', '')), ''), 120);
  agency text := left(NULLIF(btrim(COALESCE(meta->>'agency_name', '')), ''), 120);
  invitation_text text := meta->>'workspace_invitation_id';
  invitation public.workspace_invitations%ROWTYPE;
  new_ws uuid;
BEGIN
  INSERT INTO public.profiles (id, full_name, language)
  VALUES (NEW.id, display_name, lang);

  IF invitation_text IS NOT NULL THEN
    IF invitation_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Invalid workspace invitation';
    END IF;
    SELECT * INTO invitation FROM public.workspace_invitations
      WHERE id = invitation_text::uuid AND lower(email) = lower(NEW.email)
        AND role = 'agent' AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > now()
      FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Workspace invitation is invalid or expired'; END IF;

    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (invitation.workspace_id, NEW.id, 'agent');
    UPDATE public.workspace_invitations SET invited_user_id = NEW.id
      WHERE id = invitation.id;
    RETURN NEW;
  END IF;

  INSERT INTO public.workspaces (name, created_by)
  VALUES (COALESCE(agency, CASE WHEN lang = 'en' THEN 'My Agency' ELSE 'وكالتي العقارية' END), NEW.id)
  RETURNING id INTO new_ws;

  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (new_ws, NEW.id, 'owner');

  RETURN NEW;
END;
$$;

-- No historical assignment rows are backfilled; this records only real future changes.
COMMENT ON TABLE public.workspace_invitations IS 'Owner-created, agent-only invitations; writes are restricted to trusted server code.';
COMMENT ON TABLE public.lead_assignment_history IS 'Future lead assignment changes recorded by a database trigger; no fabricated backfill.';
