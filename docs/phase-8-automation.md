# Phase 8 — Workflow automation and notifications

## What is implemented

- Workspace-owner-managed rules for lead creation/status changes and follow-up creation/completion.
- In-app notifications to the assigned workspace member, with a per-member in-app preference and read/unread state.
- Round-robin assignment for new leads submitted without an assignee. Explicitly assigned leads remain unchanged. Eligible recipients are current `agent` members of that workspace; selection is serialized by locking the rule row.
- Execution history with succeeded/skipped/failed outcomes. Event IDs come from the real `lead_activities` rows; unique constraints make event execution idempotent. Owners can retry recorded failures.
- Database RLS and security-definer RPC checks keep rules/history owner-only and notifications/preferences recipient-scoped.
- Arabic and English UI, following the current RTL/LTR provider.

## Limits in this deployment

The inspected project has no deployed Edge Functions, `pg_cron` job, queue worker, or email provider configuration. Therefore this phase does **not** send email and does **not** dispatch scheduled pre-due or overdue reminders/escalations. Existing follow-up pages still show due and overdue work when opened; that is not a scheduled notification. The new triggers handle only the listed database events, synchronously and transactionally.

## Apply and configure

1. Review and apply `supabase/migrations/20261119000003_workflow_automation_notifications.sql` to the verified LeadFlow Supabase project. It has not been applied by this change.
2. Regenerate Supabase client types using the project's normal Supabase type-generation command after the migration is applied. The project currently has no checked-in Supabase CLI/type-generation script; the automation route uses a local type overlay and does not modify generated types.
3. In LeadFlow, open **Automation & notifications** as workspace owner and add the desired event rules. To use round-robin from the lead form, leave the assignee as **Unassigned**; rule actions do not override an explicit selection.
4. To enable scheduled reminders later, first provision a verified backend scheduler and a server-side worker that claims reminders idempotently, respects workspace preferences/timezones, records failures, and retries safely. Supabase documents [Cron jobs](https://supabase.com/docs/guides/cron) and [scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions) through Cron and `pg_net`; confirm availability and any plan costs in the actual project before enabling it. Keep all invocation credentials in Supabase Vault or function secrets, never browser environment variables.
5. Email delivery needs a provider decision, credentials stored server-side, templates, unsubscribe/preferences, retry limits, and delivery logging. No provider was added or contacted.

## Verification

The current repository has no local Postgres/Supabase instance or SQL test harness. Apply this migration first in a disposable Supabase project and verify: owner/agent RLS, multiple status changes on one lead, concurrent round-robin lead inserts, notifications with preferences on/off, rule disable/delete behavior, retries for failed executions, and cross-workspace denial. Do not infer remote database state from this local migration file.
