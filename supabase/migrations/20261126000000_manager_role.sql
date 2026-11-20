-- Module B: Manager role + Settings completion.
--
-- Adds a 'manager' workspace role between owner and agent:
--   owner   — everything, including billing, workspace delete, role changes,
--              and removing the owner (unchanged, owner-only).
--   manager — reads/updates workspace members (roster), leads, deals and
--              follow-ups in their workspace and manages team assignments
--              (lead reassignment, team workload visibility). CANNOT delete
--              the workspace, change billing, revoke/remove the owner, or
--              change any member's role to owner (or change roles at all:
--              role changes stay owner-only, see change_workspace_member_role).
--   agent   — unchanged: works with workspace leads/follow-ups, sees only
--              their own rows in team_dashboard_stats / reports.
--
-- POLICY AUDIT (checked before writing this migration; no existing policy
-- text is changed except where listed):
--   * workspace_members — SELECT is already member-wide ("Members read
--     workspace roster"); there is NO authenticated UPDATE/DELETE policy,
--     so direct client writes were already blocked. Role changes go only
--     through the SECURITY DEFINER RPC below. No policy change.
--   * leads / deals — read/create/update are already member-wide, so a
--     manager could already do them; DELETE stays owner-only ("Owners
--     delete leads" / "Owners delete deals"). No policy change.
--   * follow_ups — read/create/update/delete are already member-wide.
--     No policy change.
--   * properties / projects (inventory) — read/create/update member-wide,
--     DELETE owner-only. No policy change.
--   * workspaces — UPDATE owner-only, no DELETE policy at all (nobody can
--     delete a workspace through the API). No policy change.
--   * workspace_settings — SELECT member-wide, WITH CHECK owner-only.
--     No policy change (manager reads settings, owner writes them).
--   * subscriptions / payments / license_keys (billing) — UNTOUCHED.
--     payment_read stays owner-only. No policy change.
--   * automation_rules / automation_executions — owner-only. No change.
--   * workspace_invitations — SELECT owner-only; invitations stay
--     agent-only (role CHECK constraint). No policy change.
--   The ONLY access widening in this migration is team_dashboard_stats:
--   a manager now sees the whole team's workload (was owner-or-self).
--   Reports RPCs still show agents/managers only their own rows; widening
--   reports for managers is a follow-up, not done here.
--
-- ENUM NOTE: ALTER TYPE ... ADD VALUE cannot run inside an explicit
-- transaction block. It is the first statement of this file and must be
-- applied without wrapping the file in BEGIN/COMMIT (Supabase `db push`,
-- `psql -f`, and the PGlite per-file harness all run it standalone).
-- IF NOT EXISTS makes a re-run safe. A second, subtler rule also applies:
-- a value added by ADD VALUE cannot be USED as an enum datum until its
-- transaction commits (error 55P04), so no statement in this file
-- constructs a 'manager' workspace_role value: the hierarchy helper takes
-- TEXT and every role comparison here is done on role::text. Only later
-- transactions (application code, later migrations, the SQL test) may use
-- 'manager' as an enum value.

-- ===== 1. New enum value =====
ALTER TYPE public.workspace_role ADD VALUE IF NOT EXISTS 'manager';

-- ===== 2. Role-hierarchy helper =====
-- Takes the minimum role as TEXT (not the enum): the 'manager' enum value
-- added above is not usable as a workspace_role datum until the transaction
-- that added it commits, so this file must never construct it. Comparing
-- role::text keeps every statement in this file safe to run in the same
-- transaction as the ADD VALUE.
-- has_workspace_role_or_above(ws, 'owner')   = caller is owner
-- has_workspace_role_or_above(ws, 'manager') = caller is owner or manager
-- has_workspace_role_or_above(ws, 'agent')   = caller is any member
CREATE OR REPLACE FUNCTION public.has_workspace_role_or_above(_workspace_id uuid, _role text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = _workspace_id AND user_id = auth.uid()
      AND CASE _role
        WHEN 'owner' THEN role::text = 'owner'
        WHEN 'manager' THEN role::text IN ('owner', 'manager')
        WHEN 'agent' THEN role::text IN ('owner', 'manager', 'agent')
        ELSE false
      END
  )
$$;
REVOKE EXECUTE ON FUNCTION public.has_workspace_role_or_above(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_workspace_role_or_above(uuid, text) TO authenticated;

-- ===== 3. Team workload: managers see the whole team (was owner-or-self) =====
-- Identical to 20261119000001_team_management.sql except the
-- visible_members filter now uses has_workspace_role_or_above(..., 'manager').
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
      AND (public.has_workspace_role_or_above(_workspace_id, 'manager') OR wm.user_id = auth.uid())
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

-- ===== 4. Owner-only role changes: agent <-> manager only =====
-- Ownership transfer is deliberately NOT implemented here: there is no
-- code path that sets any member's role to 'owner', and the guard trigger
-- in section 5 blocks it even for service_role. Transferring ownership
-- needs a separate, reviewed design (sole-owner check, billing owner
-- email, audit trail) and is documented as blocked.
CREATE OR REPLACE FUNCTION public.change_workspace_member_role(_workspace_id uuid, _user_id uuid, _new_role public.workspace_role)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE target_role public.workspace_role;
BEGIN
  IF NOT public.has_workspace_role(_workspace_id, 'owner') THEN
    RAISE EXCEPTION 'Only the workspace owner can change member roles';
  END IF;
  IF _new_role::text NOT IN ('agent', 'manager') THEN
    RAISE EXCEPTION 'Members can only be changed between agent and manager';
  END IF;
  IF _user_id = auth.uid() THEN
    RAISE EXCEPTION 'The owner cannot change their own role';
  END IF;
  SELECT role INTO target_role FROM public.workspace_members
    WHERE workspace_id = _workspace_id AND user_id = _user_id FOR UPDATE;
  IF target_role IS NULL THEN RAISE EXCEPTION 'Workspace member not found'; END IF;
  IF target_role::text = 'owner' THEN RAISE EXCEPTION 'The workspace owner role cannot be changed'; END IF;
  -- Same entitlement gate as remove_workspace_member / cancel_workspace_invitation.
  IF NOT public.billing_crm_open(_workspace_id) THEN RAISE EXCEPTION 'CRM access unavailable'; END IF;
  UPDATE public.workspace_members SET role = _new_role
    WHERE workspace_id = _workspace_id AND user_id = _user_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.change_workspace_member_role(uuid, uuid, public.workspace_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_workspace_member_role(uuid, uuid, public.workspace_role) TO authenticated;

-- ===== 5. Guard: no UPDATE may create an owner or demote one =====
-- Defence in depth for the blocked ownership transfer: even a future
-- UPDATE policy or a service_role caller cannot promote a member to owner
-- or demote the owner by updating workspace_members.role. Ownership can
-- only ever change through a dedicated transfer flow (not implemented).
CREATE OR REPLACE FUNCTION public.workspace_members_role_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF OLD.role::text = 'owner' OR NEW.role::text = 'owner' THEN
    RAISE EXCEPTION 'Ownership cannot be changed by updating a member role';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS workspace_members_role_guard ON public.workspace_members;
CREATE TRIGGER workspace_members_role_guard BEFORE UPDATE OF role ON public.workspace_members
  FOR EACH ROW EXECUTE FUNCTION public.workspace_members_role_guard();
