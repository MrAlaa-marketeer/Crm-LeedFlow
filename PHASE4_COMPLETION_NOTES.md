# LeadFlow Phase 4 — Tasks, Calendar & Follow-up Operations

## Implementation

- Reused the existing `public.follow_ups` records for tasks. The table already stores title, notes, due time, completion state, assignee, lead, and workspace. No duplicate tasks table or schema migration was added.
- Added a workspace-protected `/follow-ups` page, enabled its sidebar entry, and added My Tasks / Team Tasks views plus open, overdue, due-today, upcoming, and completed filters.
- Added daily, weekly, and monthly calendar views with previous/next/today navigation. Calendar ranges and date labels use the browser's local timezone; month view displays due items and provides a selected-day task list.
- Follow-ups can be created, edited, assigned to a workspace member, completed, reopened, and deleted after confirmation. The existing form prevents duplicate submit while saving and all success paths invalidate the related lead/follow-up/reminder/activity query keys.
- Existing lead details continue to show their linked follow-ups. Task rows link back to the related lead and now display assignee information.
- No priority column exists in the schema, so priority controls were not added. Reminders remain in-app only; no background scheduler or delivery channel is claimed.

## Workspace and time handling

Queries include the current workspace id and are also subject to existing RLS. Assignment options come from the workspace roster, and the existing `follow_ups_before_write` database trigger sets the follow-up workspace from its lead and rejects assignees outside that workspace. `lead_id` is required by the existing schema, so tasks remain connected to a lead.

## Verification

- `bunx tsc --noEmit`: passed.
- `bun run test`: passed, 8 files and 27 tests, including local date/week/month boundary tests.
- ESLint on all eight changed TypeScript files: passed.
- `bun run build`: passed for production client, SSR, and Cloudflare Nitro output.
- No remote database changes were applied; this phase required none.
