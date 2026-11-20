# LeadFlow Phase 3 — Sales Pipeline

## Implementation

- Reused `leads.status` and the existing seven-value `lead_status` enum. No opportunity table or database migration was added.
- Expanded `/pipeline` into an RTL-aware Kanban board and a table view. Both show lead name, phone, project, budget, assignee, next follow-up, and the current stage. Won/lost cards surface the existing lead notes as outcome context and link to the full profile and activity timeline.
- Stage changes use the existing Supabase update operation. The UI waits for the write to succeed, reports errors, and invalidates lead, pipeline, follow-up, reminder, statistics, and activity queries. No optimistic change is made, so rollback is not needed.
- Filters cover employee/unassigned, source, project text, lead name/phone, and created-date range. Search is debounced.
- Stage totals are exact count queries under the same workspace and filter constraints. The board/list loads 500 records at a time and offers progressive loading for larger result sets; totals and win rate still reflect every matching record.
- Win rate is calculated as won divided by won plus lost. It stays unavailable until there is at least one closed outcome.
- Arabic and English labels are included; existing `dir` and logical CSS conventions support RTL/LTR.

## Authorization and database

The application uses the existing workspace-scoped `leads` records. The checked-in core migration enables RLS and restricts lead updates to workspace members; the before-write trigger prevents moving a lead between workspaces. Stage writes remain subject to those existing Supabase rules. Status changes continue to be recorded by the existing lead activity trigger. No database change was needed for this phase.

The user confirmed the database migration is already applied to the intended Supabase project. This local pass did not modify the remote database.

## Verification

- `bunx tsc --noEmit`: passed.
- `bun run test`: passed, 7 files and 25 tests.
- `bun run build`: passed, including the production client, SSR, and Cloudflare Nitro bundles.
- ESLint on the five changed TypeScript files: passed.
- The project-wide lint command still reports pre-existing formatting problems outside this phase; the changed Phase 3 files were formatted and lint clean.
