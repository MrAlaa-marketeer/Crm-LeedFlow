// Client-side mirror of the workspace role hierarchy enforced in the
// database (supabase/migrations/20261126000000_manager_role.sql).
// The database is the authority: RLS policies, the
// change_workspace_member_role() RPC and the workspace_members_role_guard
// trigger enforce these rules server-side. These helpers only decide what
// the UI shows; a caller that bypasses them still hits the DB checks.
export type TeamRole = "owner" | "manager" | "agent";

const ROLE_RANK: Record<TeamRole, number> = { owner: 3, manager: 2, agent: 1 };

export function roleRank(role: TeamRole): number {
  return ROLE_RANK[role];
}

/** Owner or manager: can see the whole team and manage lead assignments. */
export function isManagerOrAbove(role: TeamRole): boolean {
  return role === "owner" || role === "manager";
}

/** Team administration (invites, removals, role changes) stays owner-only. */
export function canManageTeam(role: TeamRole): boolean {
  return role === "owner";
}

/** Whole-team workload overview: owner and manager; agents see only themselves. */
export function canViewTeamWorkload(role: TeamRole): boolean {
  return isManagerOrAbove(role);
}

/** Reassigning leads / follow-ups to another member: owner and manager. */
export function canManageAssignments(role: TeamRole): boolean {
  return isManagerOrAbove(role);
}

export function canRemoveMember(
  actorRole: TeamRole,
  actorId: string,
  targetRole: TeamRole,
  targetId: string,
): boolean {
  return canManageTeam(actorRole) && actorId !== targetId && targetRole !== "owner";
}

/**
 * Owner-only role changes, agent <-> manager only.
 * Ownership transfer is NOT supported: `newRole` can never be "owner",
 * the owner cannot change their own role, and an owner's role cannot be
 * changed. The DB RPC + guard trigger enforce the same rules.
 */
export function canChangeMemberRole(
  actorRole: TeamRole,
  actorId: string,
  targetRole: TeamRole,
  targetId: string,
  newRole: TeamRole,
): boolean {
  if (actorRole !== "owner") return false;
  if (actorId === targetId) return false;
  if (targetRole === "owner") return false;
  return newRole === "agent" || newRole === "manager";
}

/** Billing changes stay owner-only (DB: payment_read policy, billing RPCs). */
export function canManageBilling(role: TeamRole): boolean {
  return role === "owner";
}

/** Workspace deletion/rename stays owner-only (DB: workspaces policies). */
export function canDeleteWorkspace(role: TeamRole): boolean {
  return role === "owner";
}
