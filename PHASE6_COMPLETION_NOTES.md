# Phase 6 — Team management and role-based access

## Implemented locally

- Kept the existing `owner` / `agent` role model. No new roles or role-promotion UI were added; the current schema has one workspace owner and no safe ownership-transfer workflow.
- Enabled Team Management navigation at `/team`, including active route highlighting.
- Added a bilingual, RTL-aware team page for member profiles, agent invitations, removal, workload metrics, and recorded assignment changes.
- Invitations are sent through Supabase Auth Admin from a server-only function after verifying the caller's membership is `owner`. The invitation metadata carries an unguessable database invitation ID; the database trigger checks that ID, workspace invitation state, and exact invited email before assigning the user as an agent.
- Invitation-created members remain marked as awaiting email confirmation. The Auth confirmation trigger marks the invitation consumed. Owners can cancel an unconfirmed invitation; cancellation revokes it and removes the pending agent membership, clearing assignments safely.
- Removal and invitation cancellation are atomic, owner-checked database functions. They clear a removed agent's lead and follow-up assignments before removing membership. Authenticated clients have no direct invitation/member write grants.
- Added a trigger-backed `lead_assignment_history` table. It records only future actual assignment changes, including actor and timestamp. No history was fabricated for older assignments.
- Added workspace-scoped workload stats. Owners see member totals; agents receive only their own row. Stats use existing leads and follow-ups; no duplicate task or opportunity records are introduced.
- Added unit tests for the client permission helpers.

## Database migration status

`supabase/migrations/20261119000001_team_management.sql` is a local migration draft. It has **not** been applied to any remote Supabase project. Applying it requires verifying the intended Supabase project and reviewing/approving the migration. After applying, regenerate the Supabase database types using the project's established workflow.

The migration replaces `public.handle_new_user()` to support invitations while preserving the existing regular-signup behavior that creates a workspace owner. It adds invitation confirmation handling on `auth.users`, owner-only membership RPCs, workload stats, and RLS-protected assignment history.

## Supabase dashboard configuration still required

- In **Authentication → URL Configuration**, set **Site URL** to the deployed LeadFlow origin (or the local origin while testing). The invite flow intentionally uses Supabase's configured Site URL as its redirect fallback; no unverified redirect URL or environment variable was invented.
- Confirm that the invite email template points to Supabase's confirmation link and that the Site URL is permitted. If a custom `redirectTo` is later added, add that exact app URL to the Redirect URLs allowlist first.
- Configure a production email provider and test delivery/confirmation. The application code cannot confirm dashboard state or email delivery remotely.

## Permission model

| Operation                                      | Owner                                                                            | Agent                                                                            |
| ---------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Read workspace members and workspace records   | Yes                                                                              | Yes, subject to existing table RLS                                               |
| Invite an agent                                | Yes                                                                              | No                                                                               |
| Remove an agent / cancel an unconfirmed invite | Yes                                                                              | No                                                                               |
| Grant owner role                               | No UI or RPC; unsupported                                                        | No                                                                               |
| View team workload                             | All members                                                                      | Own metrics only                                                                 |
| Change lead assignment                         | Existing lead update policy, scoped by workspace and assignee membership trigger | Existing lead update policy, scoped by workspace and assignee membership trigger |

Existing role permissions on leads and follow-ups are preserved. In particular, the pre-existing policy allows workspace members to work on workspace leads; this phase does not silently narrow that behavior.

## Verification performed

- `bun run test`: 31 tests passed (including new role-helper tests).
- `bunx tsc --noEmit`: passed.
- `bun run build`: production build passed.
- SQL migration reviewed against the checked-in core schema. No remote migration was run because the requested workspace/project target was not verified and the project instructions require approval before remote application.

## Manual checks after migration

1. Sign in as the owner and open Team Management. Invite an unused email and confirm it appears as awaiting confirmation.
2. Before confirming the email, cancel the invitation; verify the invitee loses workspace membership and cannot access workspace data.
3. Send a fresh invite, confirm it, then sign in as the agent. Verify Team Management exposes no invite/remove actions and workload returns only that agent's row.
4. As owner, remove the agent. Verify their lead/follow-up assignments become unassigned and the agent can no longer query the workspace.
5. Reassign a lead and verify a real assignment event appears in Team Management and the lead timeline; confirm no older assignments appear as fabricated history.
6. Attempt the same invitation/removal RPCs as an agent and with another workspace ID; both must be rejected by database checks.
