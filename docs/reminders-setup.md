# Reminders — setup guide (Module D)

LeadFlow reminders work in two layers. **Layer 1 works with zero setup.**
Layer 2 (scheduled inbox notifications) needs the one-time dashboard steps
below. Nothing here sends email, WhatsApp, SMS or push notifications — there
is no email provider, WhatsApp Business API or Edge Function in this module,
and none is required.

## Layer 1 — works today, no setup

These read `follow_ups` live every time the app loads (refreshed every
60 seconds and on window focus):

- **Notification bell** (top bar, all pages): count of open follow-ups with
  `due_at <= now` in the current workspace (archived leads excluded).
  Clicking it opens the follow-ups page. Completing a follow-up clears it
  from the count. The sidebar Follow-ups item shows the same count as a
  badge (a red dot when the sidebar is collapsed).
- **Due-now banner** (top of the follow-ups page): overdue + due-within-24h
  follow-ups across the whole workspace, with the first 3 overdue items
  inline and a shortcut to the Overdue filter.
- **Escalation list** (Automation page, owners only): open follow-ups
  overdue **more than 24 hours**, with lead, assignee and overdue hours.
  This list is live — it does not mean a message was sent.

If you do nothing else, this layer is the whole feature: whoever opens the
app sees what is overdue. What you do **not** get without Layer 2: nobody
is notified while the app is closed, and no `in_app_notifications` rows are
created on a schedule.

## Layer 2 — scheduled check (pg_cron)

The migration `20261127000000_reminders.sql` adds three functions:

| Function                                                                        | Who can call it                                                                                  | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `due_follow_up_reminders(_workspace_id uuid, _due_within_hours int DEFAULT 24)` | any workspace member (their own workspace only)                                                  | Returns overdue + due-soon open follow-ups with lead + assignee. Read-only.                                                                                                                                                                                                                                                                                                                                                                                                               |
| `escalate_overdue_follow_ups(_workspace_id uuid DEFAULT NULL)`                  | workspace **owner** for their workspace; `service_role` / `postgres` for all workspaces (`NULL`) | Writes one `follow_up.escalated` row per workspace owner into `in_app_notifications` for every open follow-up overdue > 24h. Idempotent — re-running creates nothing new.                                                                                                                                                                                                                                                                                                                 |
| `run_reminder_sweep()`                                                          | `service_role` / `postgres` only (this is what pg_cron calls)                                    | (a) Writes one `follow_up.overdue` row to the assignee of every open overdue follow-up; (b) runs the > 24h escalation above. Returns one summary row `(overdue_notified, escalated_follow_ups, escalation_notifications_created)`. Respects each recipient's in-app opt-out (`notification_preferences.in_app_enabled`); an unassigned follow-up notifies its lead's assignee, and only one with no assignee anywhere gets no overdue row (owners still see it via escalation after 24h). |

### Steps (Supabase dashboard, disposable/test project first)

1. Apply all migrations to the project (including
   `20261127000000_reminders.sql`), then verify manually in the **SQL
   Editor** (it runs as `postgres`, so the sweep is allowed there):
   ```sql
   select * from public.run_reminder_sweep();
   ```
   Expect one row, e.g. `(overdue_notified, escalated_follow_ups,
escalation_notifications_created) = (2, 1, 1)`. Run it again: the
   counts must drop to `(0, 1, 0)` — the same follow-ups are still
   escalated, but no duplicate inbox rows are created. Check the inbox:
   ```sql
   select event_type, entity_id, recipient_id, created_at
   from public.in_app_notifications
   where event_type in ('follow_up.overdue', 'follow_up.escalated')
   order by created_at desc limit 20;
   ```
2. Enable the scheduler: **Dashboard → Database → Extensions → `pg_cron`
   → Enable**. (If the toggle is unavailable on your plan, skip to
   "If pg_cron is unavailable" below — Layer 1 still works.)
3. Create the job in the **SQL Editor**:
   ```sql
   select cron.schedule(
     'leadflow-reminder-sweep',
     '*/30 * * * *',
     $$select public.run_reminder_sweep();$$
   );
   ```
   This runs the sweep every 30 minutes, in UTC. Change `'*/30 * * * *'`
   to `'0 * * * *'` for hourly, or `'0 7 * * *'` for once daily at 07:00 UTC.
   No project ref, URL or secret is needed in this SQL — the job runs
   inside the database as `postgres`.
4. Confirm the job exists and has run:
   ```sql
   select jobid, jobname, schedule, active from cron.job;
   select * from cron.job_run_details
   where jobname = 'leadflow-reminder-sweep'
   order by start_time desc limit 5;
   ```
   A `failed` run lists its `return_message` — paste it back for review.
5. To stop it later:
   ```sql
   select cron.unschedule('leadflow-reminder-sweep');
   ```

### If pg_cron is unavailable on the free plan

- **Manual (no setup):** an owner opens **Automation → Overdue follow-up
  escalation → "Notify owners now"**. That calls
  `escalate_overdue_follow_ups` for the current workspace only — owners get
  the > 24h escalation rows in their inbox. It does **not** create the
  `follow_up.overdue` assignee rows; assignees still see their overdue work
  via the bell and the banner.
- **Or run the sweep by hand:** in the SQL Editor, `select *
from public.run_reminder_sweep();` whenever you want (e.g. each morning).
  Same effect as the cron job, one run at a time.
- **Or schedule an Edge Function (not shipped):** a future Edge Function
  could call `run_reminder_sweep()` with the project's `service_role` key
  stored as a Function secret, scheduled via Dashboard → Edge Functions →
  the function's schedule. Its URL would be
  `https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/<function-name>` —
  replace `<YOUR_PROJECT_REF>` with the project ref from
  Dashboard → Project Settings → General. Do **not** put the
  `service_role` key in the app, in the browser, or in any client-side
  code. This module ships no such function; the cron job above is the
  recommended path.

## What is (and is not) automated

- Automated after the cron steps: assignees get a `follow_up.overdue`
  inbox row when a follow-up becomes overdue; owners get a
  `follow_up.escalated` inbox row once it passes 24h overdue. Each
  follow-up notifies each recipient at most once per event type.
- **Not** automated: email, WhatsApp, SMS, push, Google Calendar events,
  or any message outside LeadFlow. The Automation page's notification
  inbox is in-app only, and the bell count is computed from `follow_ups`,
  not from the inbox table.
- A follow-up that is completed, deleted, or whose lead is archived stops
  being reminded/escalated on the next sweep. Notifications already in an
  inbox stay there (read/unread) — the sweep never deletes rows.
- A workspace with no `owner` member receives no escalation rows.
  (There is no Manager role in this codebase; owners are the escalation
  recipients.)

## Tests

- `src/lib/reminders.test.ts` — classification, 24h escalation boundary,
  summary counts, next-follow-up selection.
- `supabase/tests/reminders.sql` — transactional, rolls back: member read
  - window, outsider blocked, agent blocked from escalation, owner
    escalation + idempotency, sweep as `service_role` + idempotency,
    opt-out respected, reminder event types admitted by the inbox CHECK.
    Run it in a disposable database only, after all migrations.
