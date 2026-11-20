-- Phase 8: database-backed, workspace-scoped automation and in-app notifications.
-- No scheduler or email delivery is introduced by this migration.

CREATE TABLE public.automation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  trigger_event text NOT NULL CHECK (trigger_event IN (
    'lead.created', 'lead.status_changed', 'follow_up.created', 'follow_up.completed'
  )),
  action_type text NOT NULL CHECK (action_type IN ('notify_assignee', 'round_robin_unassigned')),
  enabled boolean NOT NULL DEFAULT true,
  last_assigned_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT automation_action_event_check CHECK (
    (action_type = 'round_robin_unassigned' AND trigger_event = 'lead.created') OR
    (action_type = 'notify_assignee')
  )
);
CREATE INDEX automation_rules_enabled_idx ON public.automation_rules(workspace_id, trigger_event)
  WHERE enabled;
CREATE UNIQUE INDEX automation_rules_single_round_robin_idx ON public.automation_rules(workspace_id)
  WHERE enabled AND action_type = 'round_robin_unassigned';
ALTER TABLE public.automation_rules ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.automation_rules TO authenticated;
CREATE POLICY "Owners manage workspace automation rules" ON public.automation_rules
  FOR ALL TO authenticated
  USING (public.has_workspace_role(workspace_id, 'owner'))
  WITH CHECK (public.has_workspace_role(workspace_id, 'owner'));
CREATE TRIGGER automation_rules_updated_at BEFORE UPDATE ON public.automation_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.notification_preferences (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  in_app_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.notification_preferences TO authenticated;
CREATE POLICY "Members read own notification preferences" ON public.notification_preferences
  FOR SELECT TO authenticated USING (user_id = auth.uid() AND public.is_workspace_member(workspace_id));
CREATE POLICY "Members manage own notification preferences" ON public.notification_preferences
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND public.is_workspace_member(workspace_id));
CREATE POLICY "Members update own notification preferences" ON public.notification_preferences
  FOR UPDATE TO authenticated USING (user_id = auth.uid() AND public.is_workspace_member(workspace_id))
  WITH CHECK (user_id = auth.uid() AND public.is_workspace_member(workspace_id));
CREATE TRIGGER notification_preferences_updated_at BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.in_app_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rule_id uuid REFERENCES public.automation_rules(id) ON DELETE SET NULL,
  event_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'lead.created', 'lead.status_changed', 'follow_up.created', 'follow_up.completed'
  )),
  entity_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  UNIQUE (rule_id, event_id, recipient_id)
);
CREATE INDEX in_app_notifications_inbox_idx
  ON public.in_app_notifications(workspace_id, recipient_id, created_at DESC);
ALTER TABLE public.in_app_notifications ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.in_app_notifications TO authenticated;
GRANT UPDATE (read_at) ON public.in_app_notifications TO authenticated;
CREATE POLICY "Members read own workspace notifications" ON public.in_app_notifications
  FOR SELECT TO authenticated USING (
    recipient_id = auth.uid() AND public.is_workspace_member(workspace_id)
  );
CREATE POLICY "Members mark own workspace notifications read" ON public.in_app_notifications
  FOR UPDATE TO authenticated USING (
    recipient_id = auth.uid() AND public.is_workspace_member(workspace_id)
  ) WITH CHECK (
    recipient_id = auth.uid() AND public.is_workspace_member(workspace_id)
  );

CREATE TABLE public.automation_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  rule_id uuid REFERENCES public.automation_rules(id) ON DELETE SET NULL,
  event_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'lead.created', 'lead.status_changed', 'follow_up.created', 'follow_up.completed'
  )),
  action_type text NOT NULL CHECK (action_type IN ('notify_assignee', 'round_robin_unassigned')),
  outcome text NOT NULL CHECK (outcome IN ('succeeded', 'skipped', 'failed')),
  error_message text,
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_id, event_id)
);
CREATE INDEX automation_executions_workspace_created_idx
  ON public.automation_executions(workspace_id, created_at DESC);
ALTER TABLE public.automation_executions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.automation_executions TO authenticated;
CREATE POLICY "Owners read workspace automation history" ON public.automation_executions
  FOR SELECT TO authenticated USING (public.has_workspace_role(workspace_id, 'owner'));

-- Round-robin is atomic under concurrent lead inserts. Explicitly assigned leads are preserved.
CREATE OR REPLACE FUNCTION public.assign_unassigned_lead_round_robin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  rule_row public.automation_rules%ROWTYPE;
  chosen_user uuid;
BEGIN
  PERFORM set_config('leadflow.round_robin_assigned', 'false', true);
  IF NEW.assigned_to IS NOT NULL THEN RETURN NEW; END IF;

  SELECT * INTO rule_row FROM public.automation_rules
    WHERE workspace_id = NEW.workspace_id AND trigger_event = 'lead.created'
      AND action_type = 'round_robin_unassigned' AND enabled
    ORDER BY created_at, id LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT wm.user_id INTO chosen_user FROM public.workspace_members wm
    WHERE wm.workspace_id = NEW.workspace_id
      AND wm.role = 'agent'
      AND (rule_row.last_assigned_to IS NULL OR wm.user_id > rule_row.last_assigned_to)
    ORDER BY wm.user_id LIMIT 1;
  IF chosen_user IS NULL THEN
    SELECT wm.user_id INTO chosen_user FROM public.workspace_members wm
      WHERE wm.workspace_id = NEW.workspace_id AND wm.role = 'agent'
      ORDER BY wm.user_id LIMIT 1;
  END IF;
  IF chosen_user IS NOT NULL THEN
    NEW.assigned_to := chosen_user;
    UPDATE public.automation_rules SET last_assigned_to = chosen_user WHERE id = rule_row.id;
    PERFORM set_config('leadflow.round_robin_assigned', 'true', true);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.assign_unassigned_lead_round_robin() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER leads_round_robin_before_insert BEFORE INSERT ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.assign_unassigned_lead_round_robin();

-- Event actions are transactional and idempotent. An exception in one rule is caught and audited;
-- the originating lead/follow-up write remains valid and can be investigated by the owner.
CREATE OR REPLACE FUNCTION public.run_workspace_automation(
  _workspace_id uuid, _event_id uuid, _event_type text, _entity_id uuid, _recipient_id uuid
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE rule_row public.automation_rules%ROWTYPE;
DECLARE previous_outcome text;
DECLARE is_retry boolean := false;
BEGIN
  FOR rule_row IN SELECT * FROM public.automation_rules
    WHERE workspace_id = _workspace_id AND trigger_event = _event_type AND enabled
    ORDER BY created_at, id
  LOOP
    BEGIN
      is_retry := false;
      INSERT INTO public.automation_executions
        (workspace_id, rule_id, event_id, event_type, action_type, outcome)
      VALUES (_workspace_id, rule_row.id, _event_id, _event_type, rule_row.action_type, 'succeeded')
      ON CONFLICT (rule_id, event_id) DO NOTHING;
      IF NOT FOUND THEN
        SELECT outcome INTO previous_outcome FROM public.automation_executions
          WHERE rule_id = rule_row.id AND event_id = _event_id FOR UPDATE;
        IF previous_outcome IS DISTINCT FROM 'failed' THEN CONTINUE; END IF;
        is_retry := true;
        UPDATE public.automation_executions SET outcome = 'succeeded', error_message = NULL,
          attempts = attempts + 1 WHERE rule_id = rule_row.id AND event_id = _event_id;
      END IF;

      IF rule_row.action_type = 'notify_assignee' THEN
        IF _recipient_id IS NULL OR NOT public.is_user_in_workspace(_recipient_id, _workspace_id) THEN
          UPDATE public.automation_executions SET outcome = 'skipped'
            WHERE rule_id = rule_row.id AND event_id = _event_id;
        ELSIF COALESCE((SELECT p.in_app_enabled FROM public.notification_preferences p
          WHERE p.workspace_id = _workspace_id AND p.user_id = _recipient_id), true) THEN
          INSERT INTO public.in_app_notifications
            (workspace_id, recipient_id, rule_id, event_id, event_type, entity_id)
          VALUES (_workspace_id, _recipient_id, rule_row.id, _event_id, _event_type, _entity_id)
          ON CONFLICT (rule_id, event_id, recipient_id) DO NOTHING;
        ELSE
          UPDATE public.automation_executions SET outcome = 'skipped'
            WHERE rule_id = rule_row.id AND event_id = _event_id;
        END IF;
      ELSIF rule_row.action_type = 'round_robin_unassigned'
        AND _recipient_id IS NOT NULL
        AND (is_retry OR current_setting('leadflow.round_robin_assigned', true) = 'true') THEN
        UPDATE public.automation_executions SET outcome = 'succeeded'
          WHERE rule_id = rule_row.id AND event_id = _event_id;
      ELSE
        UPDATE public.automation_executions SET outcome = 'skipped'
          WHERE rule_id = rule_row.id AND event_id = _event_id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.automation_executions
        (workspace_id, rule_id, event_id, event_type, action_type, outcome, error_message)
      VALUES (_workspace_id, rule_row.id, _event_id, _event_type, rule_row.action_type,
        'failed', left(SQLERRM, 1000))
      ON CONFLICT (rule_id, event_id) DO UPDATE
        SET outcome = 'failed', error_message = EXCLUDED.error_message,
            attempts = public.automation_executions.attempts + 1;
    END;
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.run_workspace_automation(uuid, uuid, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.process_lead_automation_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE event_name text;
DECLARE source_event_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    event_name := 'lead.created';
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    event_name := 'lead.status_changed';
  ELSE
    RETURN NEW;
  END IF;
  SELECT id INTO source_event_id FROM public.lead_activities
    WHERE lead_id = NEW.id AND activity_type = event_name
    ORDER BY created_at DESC, id DESC LIMIT 1;
  IF TG_OP = 'INSERT' AND current_setting('leadflow.round_robin_assigned', true) = 'true' THEN
    INSERT INTO public.lead_assignment_history
      (workspace_id, lead_id, from_user_id, to_user_id, actor_id)
    VALUES (NEW.workspace_id, NEW.id, NULL, NEW.assigned_to, NULL);
  END IF;
  IF source_event_id IS NOT NULL THEN
    PERFORM public.run_workspace_automation(NEW.workspace_id, source_event_id, event_name, NEW.id, NEW.assigned_to);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER zz_leads_automation_after_write AFTER INSERT OR UPDATE OF status ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.process_lead_automation_event();

CREATE OR REPLACE FUNCTION public.process_follow_up_automation_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE event_name text;
DECLARE entity_id uuid;
DECLARE source_event_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    event_name := 'follow_up.created'; entity_id := NEW.id;
  ELSIF NEW.completed_at IS NOT NULL AND OLD.completed_at IS NULL THEN
    event_name := 'follow_up.completed'; entity_id := NEW.id;
  ELSE
    RETURN NEW;
  END IF;
  SELECT id INTO source_event_id FROM public.lead_activities
    WHERE lead_id = NEW.lead_id AND activity_type = event_name
      AND details->>'follow_up_id' = NEW.id::text
    ORDER BY created_at DESC, id DESC LIMIT 1;
  IF source_event_id IS NOT NULL THEN
  PERFORM public.run_workspace_automation(NEW.workspace_id, source_event_id, event_name, entity_id,
    COALESCE(NEW.assigned_to, (SELECT l.assigned_to FROM public.leads l WHERE l.id = NEW.lead_id)));
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER zz_follow_ups_automation_after_write AFTER INSERT OR UPDATE OF completed_at ON public.follow_ups
  FOR EACH ROW EXECUTE FUNCTION public.process_follow_up_automation_event();

-- Include the follow-up id in creation activity details so concurrent follow-up creations
-- remain independently identifiable and idempotent.
CREATE OR REPLACE FUNCTION public.log_follow_up_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE changed_fields text[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.lead_activities (workspace_id, lead_id, actor_id, activity_type, details)
    VALUES (NEW.workspace_id, NEW.lead_id, auth.uid(), 'follow_up.created', jsonb_build_object('follow_up_id', NEW.id));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() = 1 THEN
      INSERT INTO public.lead_activities (workspace_id, lead_id, actor_id, activity_type)
      VALUES (OLD.workspace_id, OLD.lead_id, auth.uid(), 'follow_up.deleted');
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN
    INSERT INTO public.lead_activities (workspace_id, lead_id, actor_id, activity_type, details)
    VALUES (NEW.workspace_id, NEW.lead_id, auth.uid(),
      CASE WHEN NEW.completed_at IS NULL THEN 'follow_up.reopened' ELSE 'follow_up.completed' END,
      jsonb_build_object('follow_up_id', NEW.id));
  ELSE
    changed_fields := ARRAY[]::text[];
    IF NEW.title IS DISTINCT FROM OLD.title THEN changed_fields := array_append(changed_fields, 'title'); END IF;
    IF NEW.notes IS DISTINCT FROM OLD.notes THEN changed_fields := array_append(changed_fields, 'notes'); END IF;
    IF NEW.due_at IS DISTINCT FROM OLD.due_at THEN changed_fields := array_append(changed_fields, 'due_at'); END IF;
    IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN changed_fields := array_append(changed_fields, 'assigned_to'); END IF;
    IF NEW.lead_id IS DISTINCT FROM OLD.lead_id THEN changed_fields := array_append(changed_fields, 'lead_id'); END IF;
    IF cardinality(changed_fields) > 0 THEN
      INSERT INTO public.lead_activities (workspace_id, lead_id, actor_id, activity_type, details)
      VALUES (NEW.workspace_id, NEW.lead_id, auth.uid(), 'follow_up.updated',
        jsonb_build_object('follow_up_id', NEW.id, 'changed_fields', to_jsonb(changed_fields)));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.retry_automation_execution(_execution_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE run_row public.automation_executions%ROWTYPE;
DECLARE target_id uuid;
DECLARE target_workspace uuid;
DECLARE assigned_user uuid;
BEGIN
  SELECT * INTO run_row FROM public.automation_executions WHERE id = _execution_id FOR UPDATE;
  IF NOT FOUND OR NOT public.has_workspace_role(run_row.workspace_id, 'owner') THEN
    RAISE EXCEPTION 'Automation execution not found or unauthorized';
  END IF;
  IF run_row.outcome <> 'failed' OR run_row.rule_id IS NULL THEN
    RAISE EXCEPTION 'Only failed executions for existing rules can be retried';
  END IF;
  IF run_row.event_type LIKE 'lead.%' THEN
    -- Lead events are keyed by activity id; recover the lead from the activity row.
    SELECT l.id, l.workspace_id, l.assigned_to INTO target_id, target_workspace, assigned_user
      FROM public.lead_activities a JOIN public.leads l ON l.id = a.lead_id
      WHERE a.id = run_row.event_id;
  ELSE
    SELECT f.id, f.workspace_id, COALESCE(f.assigned_to, l.assigned_to)
      INTO target_id, target_workspace, assigned_user
      FROM public.lead_activities a
      JOIN public.follow_ups f ON (a.details->>'follow_up_id')::uuid = f.id
      JOIN public.leads l ON l.id = f.lead_id
      WHERE a.id = run_row.event_id;
  END IF;
  IF target_id IS NULL OR target_workspace <> run_row.workspace_id THEN
    RAISE EXCEPTION 'The source record no longer exists';
  END IF;
  PERFORM public.run_workspace_automation(
    run_row.workspace_id, run_row.event_id, run_row.event_type, target_id, assigned_user
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.retry_automation_execution(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retry_automation_execution(uuid) TO authenticated;
