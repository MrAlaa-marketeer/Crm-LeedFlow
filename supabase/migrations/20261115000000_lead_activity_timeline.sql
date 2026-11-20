-- LeadFlow activity timeline. Apply only after confirming the target Supabase project.
-- Activity is recorded by database triggers so client mutations cannot fabricate
-- or duplicate events. Existing rows are intentionally not backfilled.

CREATE TABLE public.lead_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  activity_type text NOT NULL CHECK (activity_type IN (
    'lead.created',
    'lead.updated',
    'lead.status_changed',
    'lead.archived',
    'lead.restored',
    'lead.deleted',
    'follow_up.created',
    'follow_up.updated',
    'follow_up.completed',
    'follow_up.reopened',
    'follow_up.deleted'
  )),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX lead_activities_lead_created_idx
  ON public.lead_activities (lead_id, created_at DESC, id DESC);
CREATE INDEX lead_activities_workspace_created_idx
  ON public.lead_activities (workspace_id, created_at DESC);

ALTER TABLE public.lead_activities ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.lead_activities TO authenticated;
GRANT ALL ON public.lead_activities TO service_role;

CREATE POLICY "Members read lead activities"
  ON public.lead_activities
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

CREATE OR REPLACE FUNCTION public.log_lead_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  changed_fields text[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.lead_activities (workspace_id, lead_id, actor_id, activity_type, details)
    VALUES (
      NEW.workspace_id, NEW.id, auth.uid(), 'lead.created',
      jsonb_build_object('status', NEW.status, 'source', NEW.source)
    );
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    -- Avoid emitting per-row delete events when a workspace is cascade-deleted.
    IF pg_trigger_depth() = 1 THEN
      INSERT INTO public.lead_activities (workspace_id, lead_id, actor_id, activity_type)
      VALUES (OLD.workspace_id, NULL, auth.uid(), 'lead.deleted');
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.lead_activities (workspace_id, lead_id, actor_id, activity_type, details)
    VALUES (
      NEW.workspace_id, NEW.id, auth.uid(), 'lead.status_changed',
      jsonb_build_object('from', OLD.status, 'to', NEW.status)
    );
  END IF;

  IF NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    INSERT INTO public.lead_activities (workspace_id, lead_id, actor_id, activity_type, details)
    VALUES (
      NEW.workspace_id, NEW.id, auth.uid(),
      CASE WHEN NEW.archived_at IS NULL THEN 'lead.restored' ELSE 'lead.archived' END,
      jsonb_build_object('archived_at', NEW.archived_at)
    );
  END IF;

  changed_fields := ARRAY[]::text[];
  IF NEW.full_name IS DISTINCT FROM OLD.full_name THEN changed_fields := array_append(changed_fields, 'full_name'); END IF;
  IF NEW.phone IS DISTINCT FROM OLD.phone THEN changed_fields := array_append(changed_fields, 'phone'); END IF;
  IF NEW.email IS DISTINCT FROM OLD.email THEN changed_fields := array_append(changed_fields, 'email'); END IF;
  IF NEW.source IS DISTINCT FROM OLD.source THEN changed_fields := array_append(changed_fields, 'source'); END IF;
  IF NEW.interested_project IS DISTINCT FROM OLD.interested_project THEN changed_fields := array_append(changed_fields, 'interested_project'); END IF;
  IF NEW.preferred_area IS DISTINCT FROM OLD.preferred_area THEN changed_fields := array_append(changed_fields, 'preferred_area'); END IF;
  IF NEW.budget_min IS DISTINCT FROM OLD.budget_min THEN changed_fields := array_append(changed_fields, 'budget_min'); END IF;
  IF NEW.budget_max IS DISTINCT FROM OLD.budget_max THEN changed_fields := array_append(changed_fields, 'budget_max'); END IF;
  IF NEW.notes IS DISTINCT FROM OLD.notes THEN changed_fields := array_append(changed_fields, 'notes'); END IF;
  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN changed_fields := array_append(changed_fields, 'assigned_to'); END IF;

  IF cardinality(changed_fields) > 0 THEN
    INSERT INTO public.lead_activities (workspace_id, lead_id, actor_id, activity_type, details)
    VALUES (
      NEW.workspace_id, NEW.id, auth.uid(), 'lead.updated',
      jsonb_build_object('changed_fields', to_jsonb(changed_fields))
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.log_lead_activity() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER leads_log_activity
  AFTER INSERT OR UPDATE OR DELETE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.log_lead_activity();

CREATE OR REPLACE FUNCTION public.log_follow_up_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  changed_fields text[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.lead_activities (workspace_id, lead_id, actor_id, activity_type)
    VALUES (NEW.workspace_id, NEW.lead_id, auth.uid(), 'follow_up.created');
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    -- Avoid synthetic delete events produced by lead/workspace cascades.
    IF pg_trigger_depth() = 1 THEN
      INSERT INTO public.lead_activities (workspace_id, lead_id, actor_id, activity_type)
      VALUES (OLD.workspace_id, OLD.lead_id, auth.uid(), 'follow_up.deleted');
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN
    INSERT INTO public.lead_activities (workspace_id, lead_id, actor_id, activity_type, details)
    VALUES (
      NEW.workspace_id, NEW.lead_id, auth.uid(),
      CASE WHEN NEW.completed_at IS NULL THEN 'follow_up.reopened' ELSE 'follow_up.completed' END,
      jsonb_build_object('follow_up_id', NEW.id)
    );
  ELSE
    changed_fields := ARRAY[]::text[];
    IF NEW.title IS DISTINCT FROM OLD.title THEN changed_fields := array_append(changed_fields, 'title'); END IF;
    IF NEW.notes IS DISTINCT FROM OLD.notes THEN changed_fields := array_append(changed_fields, 'notes'); END IF;
    IF NEW.due_at IS DISTINCT FROM OLD.due_at THEN changed_fields := array_append(changed_fields, 'due_at'); END IF;
    IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN changed_fields := array_append(changed_fields, 'assigned_to'); END IF;
    IF NEW.lead_id IS DISTINCT FROM OLD.lead_id THEN changed_fields := array_append(changed_fields, 'lead_id'); END IF;

    IF cardinality(changed_fields) > 0 THEN
      INSERT INTO public.lead_activities (workspace_id, lead_id, actor_id, activity_type, details)
      VALUES (
        NEW.workspace_id, NEW.lead_id, auth.uid(), 'follow_up.updated',
        jsonb_build_object('follow_up_id', NEW.id, 'changed_fields', to_jsonb(changed_fields))
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.log_follow_up_activity() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER follow_ups_log_activity
  AFTER INSERT OR UPDATE OR DELETE ON public.follow_ups
  FOR EACH ROW EXECUTE FUNCTION public.log_follow_up_activity();
