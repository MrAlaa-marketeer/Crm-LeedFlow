# Phase 7 — Reports and business analytics

## Implemented locally

- Added `/reports` and enabled its sidebar entry.
- Added date, employee, source, project, and status filters in Arabic/English and RTL/LTR.
- Added executive KPI cards, monthly cohort trends, current status/source charts, employee and linked-project tables, and filtered aggregate CSV export.
- Reports are computed in one workspace-scoped, `SECURITY INVOKER` RPC instead of loading all lead rows into the browser. RLS remains active, membership and filter IDs are checked, and agents are limited to their own assigned leads/follow-ups and metrics. Owners can filter by team member.
- Added composite indexes for the workspace/date and follow-up aggregation paths.
- Added parser/date-bound tests and empty/malformed response handling.

## Metric definitions

- The lead cohort is non-archived leads created in the selected local date range, where the end date is inclusive. The RPC receives the browser time zone and uses an exclusive next-day bound.
- Total/new/qualified/won/lost counts use that cohort and each lead's current status. Conversion is current `won` count divided by cohort size. Won/lost are not historical close events.
- Monthly charts group the same cohort by the browser's calendar month and display current status. The funnel is a current-status distribution; historical stage transition data is not used or implied.
- Follow-up totals belong to the selected lead cohort. Open means `completed_at IS NULL`; overdue means open with `due_at < now()`. Employee completion counts use `completed_at` within the selected dates.
- Employee lead counts use the current lead assignee. Completed follow-ups use the follow-up assignee. Unassigned leads are included in workspace KPIs but do not belong to an employee row.
- Project results include only leads with an explicit Phase 5 `interested_project_id` inventory link. Free-text project interests are not merged into inventory projects because that could double count similarly named records.
- The budget KPI sums known `budget_max` buyer budgets. It is shown as demand, never as booked revenue or sales pipeline value. Unit prices are not multiplied by lead counts. Response time is omitted because the schema records no reliable first-response timestamp.
- CSV export contains the filtered aggregate report tables, not contact-level PII.

## Database and migration status

`supabase/migrations/20261119000002_reports_analytics.sql` adds the report RPC and indexes. It depends on `20261119000000_real_estate_inventory.sql` for explicit project/unit links and should be applied after the Phase 5 and Phase 6 migrations. No remote migration was applied. Project targeting and remote schema state must be verified before migration, per the project instructions.

The analytics RPC enforces workspace membership, validates employee/project filters against that workspace, and limits agent results to their own assigned records. It uses `SECURITY INVOKER`; existing RLS policies continue to apply.

## Verification

- `bun run test`: 34 tests passed across 11 test files. The new tests cover empty/malformed report data, numeric conversion, and inclusive calendar date bounds.
- `bunx tsc --noEmit`: passed.
- Focused ESLint for the report route, analytics utilities/tests, sidebar, and translations: passed.
- `bun run build`: production build passed.
- The database RPC could not be executed in this workspace because no local Supabase/Postgres test server or CLI is configured. Its SQL is a migration draft, so production calculations and RLS still require database-level verification after applying the approved migration.
