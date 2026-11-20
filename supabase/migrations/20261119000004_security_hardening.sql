-- Restrict membership checks to the caller's own workspace. Service-role writes
-- remain supported because that credential already bypasses RLS by design.
CREATE OR REPLACE FUNCTION public.is_user_in_workspace(_user_id uuid, _workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members
    WHERE workspace_id = _workspace_id
      AND user_id = _user_id
      AND (auth.role() = 'service_role' OR public.is_workspace_member(_workspace_id))
  )
$$;

-- Pin all application SECURITY DEFINER routines. Their bodies use qualified
-- public/auth objects and pg_catalog built-ins only.
ALTER FUNCTION public.is_workspace_member(uuid) SET search_path = pg_catalog;
ALTER FUNCTION public.has_workspace_role(uuid, public.workspace_role) SET search_path = pg_catalog;
ALTER FUNCTION public.is_user_in_workspace(uuid, uuid) SET search_path = pg_catalog;
ALTER FUNCTION public.shares_workspace_with(uuid) SET search_path = pg_catalog;
ALTER FUNCTION public.follow_ups_before_write() SET search_path = pg_catalog;
ALTER FUNCTION public.sync_lead_next_follow_up(uuid) SET search_path = pg_catalog;
ALTER FUNCTION public.follow_ups_after_write() SET search_path = pg_catalog;
ALTER FUNCTION public.handle_new_user() SET search_path = pg_catalog;
ALTER FUNCTION public.log_lead_activity() SET search_path = pg_catalog;
ALTER FUNCTION public.log_follow_up_activity() SET search_path = pg_catalog;
ALTER FUNCTION public.guard_inventory_write() SET search_path = pg_catalog;
ALTER FUNCTION public.validate_lead_inventory_links() SET search_path = pg_catalog;
ALTER FUNCTION public.log_lead_inventory_link_activity() SET search_path = pg_catalog;
ALTER FUNCTION public.log_lead_assignment() SET search_path = pg_catalog;
ALTER FUNCTION public.remove_workspace_member(uuid, uuid) SET search_path = pg_catalog;
ALTER FUNCTION public.cancel_workspace_invitation(uuid, uuid) SET search_path = pg_catalog;
ALTER FUNCTION public.mark_workspace_invitation_confirmed() SET search_path = pg_catalog;
ALTER FUNCTION public.assign_unassigned_lead_round_robin() SET search_path = pg_catalog;
ALTER FUNCTION public.run_workspace_automation(uuid, uuid, text, uuid, uuid) SET search_path = pg_catalog;
ALTER FUNCTION public.process_lead_automation_event() SET search_path = pg_catalog;
ALTER FUNCTION public.process_follow_up_automation_event() SET search_path = pg_catalog;
ALTER FUNCTION public.retry_automation_execution(uuid) SET search_path = pg_catalog;
