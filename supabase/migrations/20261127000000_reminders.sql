-- Module D: real reminders (in-app + pg_cron-ready).
--
-- What this migration does:
--  1. Reuses the existing in_app_notifications inbox (Phase 8) for reminder
--     notifications — no new notification table. It only extends that
--     table's event_type CHECK to admit 'follow_up.overdue' and
--     'follow_up.escalated', and adds a partial unique index so each
--     follow-up notifies each recipient at most once per event type.
--  2. due_follow_up_reminders(_workspace_id, _due_within_hours) — member
--     facing read: overdue + due-soon open follow-ups with lead + assignee.
--  3. escalate_overdue_follow_ups(_workspace_id) — writes one
--     'follow_up.escalated' inbox row per workspace owner for every open
--     follow-up overdue > 24h. Owners can call it for their own workspace;
--     pg_cron / service_role can call it with NULL to sweep all workspaces.
--  4. run_reminder_sweep() — the pg_cron entry point (server-only): writes
--     'follow_up.overdue' rows to each overdue follow-up's assignee, then
--     runs the >24h escalation. Returns a one-row summary.
--
-- What it does NOT do: no email, no WhatsApp, no push, no Edge Function.
-- Without the pg_cron job (see docs/reminders-setup.md) nothing is written
-- on a schedule — the in-app bell, the due-now banner and the escalation
-- list below still work, because they read follow_ups live.
-- Idempotent: CREATE OR REPLACE / IF NOT EXISTS throughout.

-- ===== 1. Admit reminder event types in the existing inbox =====
ALTER TABLE public.in_app_notifications
  DROP CONSTRAINT IF EXISTS in_app_notifications_event_type_check;
ALTER TABLE public.in_app_notifications
  ADD CONSTRAINT in_app_notifications_event_type_check
  CHECK (event_type IN (
    'lead.created', 'lead.status_changed', 'follow_up.created', 'follow_up.completed',
    'follow_up.overdue', 'follow_up.escalated'
  ));

-- One reminder row per (follow-up, recipient, event type). The existing
-- UNIQUE (rule_id, event_id, recipient_id) cannot dedupe reminder rows
-- because rule_id is NULL for them (NULLs are distinct in a unique index).
CREATE UNIQUE INDEX IF NOT EXISTS in_app_notifications_reminder_unique_idx
  ON public.in_app_notifications (event_id, recipient_id, event_type)
  WHERE event_type IN ('follow_up.overdue', 'follow_up.escalated');

-- ===== 2. Member-facing read: overdue + due-soon follow-ups =====
CREATE OR REPLACE FUNCTION public.due_follow_up_reminders(
  _workspace_id uuid,
  _due_within_hours integer DEFAULT 24
)
RETURNS TABLE (
  follow_up_id uuid,
  lead_id uuid,
  lead_name text,
  lead_phone text,
  follow_up_title text,
  due_at timestamptz,
  assigned_to uuid,
  assignee_name text,
  status text,
  overdue_hours numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NOT public.is_workspace_member(_workspace_id) THEN
    RAISE EXCEPTION 'Not a member of this workspace';
  END IF;
  RETURN QUERY
  SELECT
    f.id,
    f.lead_id,
    l.full_name,
    l.phone,
    f.title,
    f.due_at,
    f.assigned_to,
    p.full_name,
    CASE WHEN f.due_at < now() THEN 'overdue' ELSE 'due_soon' END,
    CASE WHEN f.due_at < now()
      THEN round(extract(epoch FROM (now() - f.due_at)) / 3600, 2)
      ELSE 0
    END
  FROM public.follow_ups f
  JOIN public.leads l ON l.id = f.lead_id
  LEFT JOIN public.profiles p ON p.id = f.assigned_to
  WHERE f.workspace_id = _workspace_id
    AND f.completed_at IS NULL
    AND l.archived_at IS NULL
    AND f.due_at <= now() + (COALESCE(NULLIF(_due_within_hours, 0), 24) * interval '1 hour')
  ORDER BY f.due_at ASC;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.due_follow_up_reminders(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.due_follow_up_reminders(uuid, integer) TO authenticated;

-- ===== 3. Escalation: open follow-ups overdue > 24h -> owners' inbox =====
CREATE OR REPLACE FUNCTION public.escalate_overdue_follow_ups(_workspace_id uuid DEFAULT NULL)
RETURNS TABLE (
  workspace_id uuid,
  follow_up_id uuid,
  lead_id uuid,
  assigned_to uuid,
  overdue_hours numeric,
  notifications_created integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  r record;
  owner_id uuid;
  created_count integer;
BEGIN
  -- Authenticated callers must be an owner of the workspace they name.
  -- service_role / postgres (pg_cron) may pass NULL to sweep all workspaces.
  IF auth.role() = 'authenticated' THEN
    IF _workspace_id IS NULL OR NOT public.has_workspace_role(_workspace_id, 'owner') THEN
      RAISE EXCEPTION 'Only a workspace owner can run escalation for a workspace';
    END IF;
  ELSIF auth.role() NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'Escalation is server-only (pg_cron / service_role) or workspace-owner only';
  END IF;

  FOR r IN
    SELECT f.id, f.workspace_id, f.lead_id, f.assigned_to, f.due_at
    FROM public.follow_ups f
    JOIN public.leads l ON l.id = f.lead_id
    WHERE f.completed_at IS NULL
      AND l.archived_at IS NULL
      AND f.due_at < now() - interval '24 hours'
      AND (_workspace_id IS NULL OR f.workspace_id = _workspace_id)
    ORDER BY f.due_at ASC
  LOOP
    created_count := 0;
    FOR owner_id IN
      SELECT wm.user_id FROM public.workspace_members wm
      WHERE wm.workspace_id = r.workspace_id AND wm.role = 'owner'
    LOOP
      -- Respect the owner's in-app opt-out, same as run_workspace_automation.
      IF COALESCE(
        (SELECT p.in_app_enabled FROM public.notification_preferences p
          WHERE p.workspace_id = r.workspace_id AND p.user_id = owner_id),
        true) THEN
        INSERT INTO public.in_app_notifications
          (workspace_id, recipient_id, rule_id, event_id, event_type, entity_id)
        VALUES (r.workspace_id, owner_id, NULL, r.id, 'follow_up.escalated', r.id)
        ON CONFLICT (event_id, recipient_id, event_type)
          WHERE event_type IN ('follow_up.overdue', 'follow_up.escalated')
          DO NOTHING;
        IF FOUND THEN
          created_count := created_count + 1;
        END IF;
      END IF;
    END LOOP;
    -- RETURNS TABLE functions take no RETURN NEXT argument: assign the OUT
    -- columns, then emit the row.
    workspace_id := r.workspace_id;
    follow_up_id := r.id;
    lead_id := r.lead_id;
    assigned_to := r.assigned_to;
    overdue_hours := round(extract(epoch FROM (now() - r.due_at)) / 3600, 2);
    notifications_created := created_count;
    RETURN NEXT;
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.escalate_overdue_follow_ups(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.escalate_overdue_follow_ups(uuid) TO authenticated, service_role;

-- ===== 4. pg_cron entry point: overdue notice + >24h escalation =====
CREATE OR REPLACE FUNCTION public.run_reminder_sweep()
RETURNS TABLE (
  overdue_notified integer,
  escalated_follow_ups integer,
  escalation_notifications_created integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  r record;
  notify_user uuid;
  overdue_count integer := 0;
  esc_rows integer := 0;
  esc_created integer := 0;
  esc record;
BEGIN
  -- Server-only: pg_cron runs as postgres; service_role may call it too.
  -- Authenticated users cannot sweep all workspaces — owners use
  -- escalate_overdue_follow_ups(_workspace_id) for their own workspace.
  IF auth.role() NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'run_reminder_sweep is server-only (pg_cron / service_role)';
  END IF;

  -- (a) Overdue notice: one 'follow_up.overdue' inbox row per overdue
  -- follow-up, to its assignee (falling back to the lead's assignee).
  -- A follow-up with neither gets no overdue row; owners still see it via
  -- the escalation step once it passes 24h.
  FOR r IN
    SELECT f.id, f.workspace_id, COALESCE(f.assigned_to, l.assigned_to) AS notify_to
    FROM public.follow_ups f
    JOIN public.leads l ON l.id = f.lead_id
    WHERE f.completed_at IS NULL
      AND l.archived_at IS NULL
      AND f.due_at < now()
  LOOP
    notify_user := r.notify_to;
    IF notify_user IS NOT NULL AND COALESCE(
      (SELECT p.in_app_enabled FROM public.notification_preferences p
        WHERE p.workspace_id = r.workspace_id AND p.user_id = notify_user),
      true) THEN
      INSERT INTO public.in_app_notifications
        (workspace_id, recipient_id, rule_id, event_id, event_type, entity_id)
      VALUES (r.workspace_id, notify_user, NULL, r.id, 'follow_up.overdue', r.id)
      ON CONFLICT (event_id, recipient_id, event_type)
        WHERE event_type IN ('follow_up.overdue', 'follow_up.escalated')
        DO NOTHING;
      IF FOUND THEN
        overdue_count := overdue_count + 1;
      END IF;
    END IF;
  END LOOP;

  -- (b) >24h escalation to workspace owners.
  FOR esc IN SELECT * FROM public.escalate_overdue_follow_ups(NULL) LOOP
    esc_rows := esc_rows + 1;
    esc_created := esc_created + esc.notifications_created;
  END LOOP;

  overdue_notified := overdue_count;
  escalated_follow_ups := esc_rows;
  escalation_notifications_created := esc_created;
  RETURN NEXT;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.run_reminder_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_reminder_sweep() TO service_role;
