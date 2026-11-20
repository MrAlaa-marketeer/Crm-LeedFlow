-- Fix the anonymous public lead-capture path (v4 Bug 1, PARTIAL) and add the
-- partial unique index for Bug 3 (Deals double-sale) as defence-in-depth.
--
-- BUG 1 — WHY capture_lead() FAILED FOR ANON
-- capture_lead() is SECURITY DEFINER and round-robin-assigns a workspace member,
-- but the pre-existing leads_before_write() trigger called
-- public.is_user_in_workspace(assignee, workspace_id), which returns true only
-- when the CALLER is service_role or a workspace member (auth.uid()). An
-- anonymous visitor is neither, so every anon capture that assigned an agent
-- failed with 'Assigned agent must belong to this workspace' — even though the
-- assignee genuinely was a member. In v3 this was masked by the ambiguous
-- phone_hash error, which fired before the INSERT.
--
-- FIX — JUDGE THE ASSIGNEE, NOT THE CALLER
-- leads_before_write() is now SECURITY DEFINER and checks the assignee's
-- membership directly against public.workspace_members (a fact in the table),
-- with no auth.uid()/auth.role() test. public.is_user_in_workspace() is
-- deliberately NOT changed: it still gates caller-membership for the
-- authenticated-only callers that use it (reports, workflow, follow-ups).
-- This does NOT open a hole for direct writes:
--   * anon has no INSERT grant on public.leads and RLS is enabled, so a direct
--     anon INSERT is still rejected (permission denied / RLS);
--   * an authenticated non-member still cannot insert a lead at all, because
--     the "Members create leads" RLS policy requires is_workspace_member();
--   * an authenticated member still cannot assign a lead to a non-member or to
--     a member of another workspace — the direct membership check rejects it.
-- The only anon path into leads remains capture_lead(), which validates the
-- workspace, the Egyptian mobile format, the honeypot and the rate limit
-- before inserting. All other behaviour of leads_before_write() (workspace
-- immutability, status_changed_at, updated_at) is unchanged.
CREATE OR REPLACE FUNCTION public.leads_before_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
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
  IF NEW.assigned_to IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = NEW.workspace_id
      AND wm.user_id = NEW.assigned_to
  ) THEN
    RAISE EXCEPTION 'Assigned agent must belong to this workspace';
  END IF;
  RETURN NEW;
END;
$$;
-- The trigger itself (created by 20261114000000) stays attached; CREATE OR
-- REPLACE only swaps the function body. Re-assert the attachment so a
-- partially-applied earlier state cannot leave the trigger dangling.
DROP TRIGGER IF EXISTS leads_before_write ON public.leads;
CREATE TRIGGER leads_before_write BEFORE INSERT OR UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.leads_before_write();

-- BUG 3 — DEFENCE-IN-DEPTH: PARTIAL UNIQUE INDEX
-- The trigger guard from 20261124000000 already rejects a second reserved/won
-- deal on the same unit, but a trigger can be disabled or dropped. This index
-- makes "one active/won deal per unit" hold at the storage level as well.
-- deals.unit_id and deals.property_id are kept in sync by the
-- sync_deal_unit_alias() trigger (20261123000000), so coalesce() covers both
-- spellings of the same unit; unit-less deals (coalesce IS NULL) are excluded
-- and may coexist freely. 'lost'/'cancelled' deals are excluded, so losing a
-- deal still frees the unit for a later deal.
CREATE UNIQUE INDEX IF NOT EXISTS deals_one_active_deal_per_unit_idx
  ON public.deals (workspace_id, coalesce(unit_id, property_id))
  WHERE stage IN ('reserved', 'won')
    AND coalesce(unit_id, property_id) IS NOT NULL;
