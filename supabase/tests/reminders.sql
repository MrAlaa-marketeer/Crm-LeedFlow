-- LeadFlow Module D verification: due_follow_up_reminders,
-- escalate_overdue_follow_ups and run_reminder_sweep.
--
-- RUN: after ALL migrations, in a DISPOSABLE database only, as the postgres
-- (superuser) role — e.g. Supabase SQL Editor, or the PGlite harness that
-- applies the migration chain locally. The script runs inside one transaction
-- and ROLLS BACK at the end, so it creates no permanent data.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/reminders.sql
--
-- Every check RAISES an exception on failure (the script stops) and emits a
-- NOTICE on pass, so a silent pass is impossible. Checks that must run as a
-- specific caller (authenticated member / owner / service_role) switch role
-- with SET LOCAL role + request.jwt.claims, exactly as PostgREST does, and
-- switch back with RESET ROLE. Row verification after a role-switched call
-- is done by the superuser afterwards, because RLS hides rows from members.
--
-- Fixture ids are fixed UUIDs so the file is re-runnable in a fresh database.
-- auth.users inserts trigger handle_new_user() on a real Supabase project,
-- which creates an extra profile/workspace per fixture user — harmless, the
-- fixture inserts below use ON CONFLICT DO NOTHING.
begin;

create temp table if not exists test_fixtures (k text primary key, v uuid);
grant all on test_fixtures to anon, authenticated, service_role;

-- ============ FIXTURES (superuser) ============
do $$
declare
  ws_a uuid := '41111111-1111-1111-1111-111111111111';
  ws_b uuid := '42222222-2222-2222-2222-222222222222';
  u_owner uuid := '40000000-0000-0000-0000-000000000001';
  u_agent uuid := '40000000-0000-0000-0000-000000000002';
  u_agent2 uuid := '40000000-0000-0000-0000-000000000003';
  u_outsider uuid := '40000000-0000-0000-0000-000000000004';
  u_wsb uuid := '40000000-0000-0000-0000-000000000005';
  lead1 uuid; lead2 uuid; lead_arch uuid; lead_b uuid;
  fu_30h uuid; fu_2h uuid; fu_soon uuid; fu_later uuid; fu_done uuid;
  fu_arch uuid; fu_unassigned uuid; fu_b30h uuid;
begin
  -- Fixture follow-ups are created under a service_role JWT: the
  -- pre-existing follow_ups_before_write() judges the assignee via
  -- is_user_in_workspace(), which passes for service_role callers.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_user_meta_data)
  values
    (u_owner,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-r@test.local',  'x', now(), now(), now(), '{}'::jsonb),
    (u_agent,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'agent-r@test.local',  'x', now(), now(), now(), '{}'::jsonb),
    (u_agent2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'agent2-r@test.local', 'x', now(), now(), now(), '{}'::jsonb),
    (u_outsider,'00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'outsider-r@test.local','x', now(), now(), now(), '{}'::jsonb),
    (u_wsb,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'wsb-r@test.local',   'x', now(), now(), now(), '{}'::jsonb)
  on conflict (id) do nothing;

  insert into public.profiles (id, full_name, language)
  values (u_owner, 'Owner R', 'en'), (u_agent, 'Agent R', 'en'), (u_agent2, 'Agent2 R', 'en'),
         (u_outsider, 'Outsider R', 'en'), (u_wsb, 'WsB R', 'en')
  on conflict (id) do nothing;

  insert into public.workspaces (id, name, created_by)
  values (ws_a, 'Reminders Agency A', u_owner), (ws_b, 'Reminders Agency B', u_wsb)
  on conflict (id) do nothing;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws_a, u_owner, 'owner'), (ws_a, u_agent, 'agent'), (ws_a, u_agent2, 'agent'),
         (ws_b, u_wsb, 'owner')
  on conflict (workspace_id, user_id) do nothing;

  insert into public.leads (workspace_id, full_name, phone, source, assigned_to)
  values (ws_a, 'Lead One', '+201011111111', 'website', u_agent),
         (ws_a, 'Lead Two', '+201022222222', 'website', u_agent2),
         (ws_a, 'Lead Archived', '+201033333333', 'website', u_agent),
         (ws_b, 'Lead Bee', '+201044444444', 'website', u_wsb);
  -- Resolve ids by phone (a multi-row INSERT ... RETURNING INTO a scalar
  -- would fail, so no RETURNING clause above).
  select id into lead1 from public.leads where phone = '+201011111111' and workspace_id = ws_a;
  select id into lead2 from public.leads where phone = '+201022222222' and workspace_id = ws_a;
  select id into lead_arch from public.leads where phone = '+201033333333' and workspace_id = ws_a;
  select id into lead_b from public.leads where phone = '+201044444444' and workspace_id = ws_b;
  update public.leads set archived_at = now() where id = lead_arch;

  insert into public.follow_ups (workspace_id, lead_id, title, due_at, assigned_to)
  values
    (ws_a, lead1, 'Overdue 30h', now() - interval '30 hours', u_agent),
    (ws_a, lead1, 'Overdue 2h', now() - interval '2 hours', u_agent),
    (ws_a, lead2, 'Due in 3h', now() + interval '3 hours', u_agent2),
    (ws_a, lead2, 'Due in 72h', now() + interval '72 hours', u_agent2),
    (ws_a, lead1, 'Done long ago', now() - interval '50 hours', u_agent),
    (ws_a, lead_arch, 'Overdue on archived lead', now() - interval '30 hours', u_agent),
    (ws_a, lead1, 'Overdue 30h unassigned', now() - interval '30 hours', null),
    (ws_b, lead_b, 'WsB overdue 30h', now() - interval '30 hours', u_wsb);
  update public.follow_ups set completed_at = now() - interval '1 hour'
    where title = 'Done long ago' and workspace_id = ws_a;

  select id into fu_30h from public.follow_ups where title = 'Overdue 30h' and workspace_id = ws_a;
  select id into fu_2h from public.follow_ups where title = 'Overdue 2h' and workspace_id = ws_a;
  select id into fu_soon from public.follow_ups where title = 'Due in 3h' and workspace_id = ws_a;
  select id into fu_later from public.follow_ups where title = 'Due in 72h' and workspace_id = ws_a;
  select id into fu_done from public.follow_ups where title = 'Done long ago' and workspace_id = ws_a;
  select id into fu_arch from public.follow_ups where title = 'Overdue on archived lead' and workspace_id = ws_a;
  select id into fu_unassigned from public.follow_ups where title = 'Overdue 30h unassigned' and workspace_id = ws_a;
  select id into fu_b30h from public.follow_ups where title = 'WsB overdue 30h' and workspace_id = ws_b;

  insert into test_fixtures (k, v) values
    ('ws_a', ws_a), ('ws_b', ws_b),
    ('u_owner', u_owner), ('u_agent', u_agent), ('u_agent2', u_agent2),
    ('u_outsider', u_outsider), ('u_wsb', u_wsb),
    ('lead1', lead1), ('lead2', lead2), ('lead_arch', lead_arch), ('lead_b', lead_b),
    ('fu_30h', fu_30h), ('fu_2h', fu_2h), ('fu_soon', fu_soon), ('fu_later', fu_later),
    ('fu_done', fu_done), ('fu_arch', fu_arch), ('fu_unassigned', fu_unassigned),
    ('fu_b30h', fu_b30h)
  on conflict (k) do update set v = excluded.v;
  raise notice 'PASS F fixtures created (fu_30h=%, fu_b30h=%)', fu_30h, fu_b30h;
end $$;

-- ============ R1. due_follow_up_reminders as a member ============
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"40000000-0000-0000-0000-000000000002"}', true);
do $$
declare
  ws_a uuid := (select v from test_fixtures where k = 'ws_a');
  fu_30h uuid := (select v from test_fixtures where k = 'fu_30h');
  fu_2h uuid := (select v from test_fixtures where k = 'fu_2h');
  fu_soon uuid := (select v from test_fixtures where k = 'fu_soon');
  n int; r record;
begin
  -- R1a: default 24h window returns overdue + due-soon, with lead + assignee.
  select count(*) into n from public.due_follow_up_reminders(ws_a);
  if n <> 4 then
    raise exception 'FAIL R1a expected 4 reminders (30h, 2h, 3h, unassigned 30h), got %', n;
  end if;
  select * into r from public.due_follow_up_reminders(ws_a) where follow_up_id = fu_30h;
  if r.status <> 'overdue' or r.lead_name <> 'Lead One' or r.assignee_name <> 'Agent R'
     or r.overdue_hours < 29 or r.overdue_hours > 31 then
    raise exception 'FAIL R1a 30h row wrong: status=% lead=% assignee=% hours=%',
      r.status, r.lead_name, r.assignee_name, r.overdue_hours;
  end if;
  select * into r from public.due_follow_up_reminders(ws_a) where follow_up_id = fu_soon;
  if r.status <> 'due_soon' or r.overdue_hours <> 0 then
    raise exception 'FAIL R1a due-soon row wrong: status=% hours=%', r.status, r.overdue_hours;
  end if;
  raise notice 'PASS R1a member read: 4 rows, overdue/due_soon + lead + assignee correct';

  -- R1b: completed and archived-lead follow-ups are excluded even with a
  -- wide window; the +72h follow-up is "upcoming" under the default 24h
  -- window (see R1a's count of 4) but correctly appears as due_soon once
  -- the window covers it.
  if exists (select 1 from public.due_follow_up_reminders(ws_a, 24 * 30)
             where follow_up_id in ((select v from test_fixtures where k = 'fu_done'),
                                    (select v from test_fixtures where k = 'fu_arch'))) then
    raise exception 'FAIL R1b completed/archived-lead follow-up leaked into reminders';
  end if;
  select * into r from public.due_follow_up_reminders(ws_a, 24 * 30)
    where follow_up_id = (select v from test_fixtures where k = 'fu_later');
  if r.status <> 'due_soon' then
    raise exception 'FAIL R1b +72h row should be due_soon under a 30d window, got %', r.status;
  end if;
  raise notice 'PASS R1b completed/archived-lead excluded; wide window admits +72h as due_soon';

  -- R1c: a 1h window keeps overdue rows but drops the +3h due-soon row.
  select count(*) into n from public.due_follow_up_reminders(ws_a, 1);
  if n <> 3 then
    raise exception 'FAIL R1c expected 3 reminders with a 1h window, got %', n;
  end if;
  if exists (select 1 from public.due_follow_up_reminders(ws_a, 1) where follow_up_id = fu_soon) then
    raise exception 'FAIL R1c +3h row leaked into a 1h window';
  end if;
  raise notice 'PASS R1c _due_within_hours window respected';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- ============ R2. due_follow_up_reminders as a non-member ============
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"40000000-0000-0000-0000-000000000004"}', true);
do $$
declare
  ws_a uuid := (select v from test_fixtures where k = 'ws_a');
  n int;
begin
  begin
    select count(*) into n from public.due_follow_up_reminders(ws_a);
    raise exception 'FAIL R2 outsider read succeeded (% rows)', n;
  exception when others then
    if sqlerrm not like '%Not a member of this workspace%' then
      raise exception 'FAIL R2 wrong error for outsider: %', sqlerrm;
    end if;
    raise notice 'PASS R2 outsider blocked from due_follow_up_reminders';
  end;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- ============ R3. escalate: agent blocked, owner works, idempotent ============
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"40000000-0000-0000-0000-000000000002"}', true);
do $$
declare
  ws_a uuid := (select v from test_fixtures where k = 'ws_a');
  n int;
begin
  begin
    select count(*) into n from public.escalate_overdue_follow_ups(ws_a);
    raise exception 'FAIL R3a agent escalation succeeded (% rows)', n;
  exception when others then
    if sqlerrm not like '%Only a workspace owner%' then
      raise exception 'FAIL R3a wrong error for agent escalation: %', sqlerrm;
    end if;
    raise notice 'PASS R3a agent cannot run escalation';
  end;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"40000000-0000-0000-0000-000000000001"}', true);
do $$
declare
  ws_a uuid := (select v from test_fixtures where k = 'ws_a');
  n int; created int;
begin
  -- R3b: owner escalation returns only the >24h rows (2 in ws_a), with counts.
  select count(*), coalesce(sum(notifications_created), 0) into n, created
    from public.escalate_overdue_follow_ups(ws_a);
  if n <> 2 then
    raise exception 'FAIL R3b expected 2 escalated follow-ups in ws_a, got %', n;
  end if;
  if created <> 2 then
    raise exception 'FAIL R3b expected 2 owner notifications created, got %', created;
  end if;
  raise notice 'PASS R3b owner escalation: 2 follow-ups, 2 notifications';

  -- R3c: second run returns the same rows but creates nothing (idempotent).
  select coalesce(sum(notifications_created), 0) into created
    from public.escalate_overdue_follow_ups(ws_a);
  if created <> 0 then
    raise exception 'FAIL R3c second escalation created % duplicate notifications', created;
  end if;
  raise notice 'PASS R3c escalation is idempotent (0 new on re-run)';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- verify the escalated inbox rows as superuser (RLS hides them from members)
do $$
declare
  ws_a uuid := (select v from test_fixtures where k = 'ws_a');
  u_owner uuid := (select v from test_fixtures where k = 'u_owner');
  fu_30h uuid := (select v from test_fixtures where k = 'fu_30h');
  fu_unassigned uuid := (select v from test_fixtures where k = 'fu_unassigned');
  fu_2h uuid := (select v from test_fixtures where k = 'fu_2h');
  n int;
begin
  select count(*) into n from public.in_app_notifications
    where workspace_id = ws_a and recipient_id = u_owner
      and event_type = 'follow_up.escalated'
      and entity_id in (fu_30h, fu_unassigned);
  if n <> 2 then
    raise exception 'FAIL R3d expected 2 escalated inbox rows for ws_a owner, got %', n;
  end if;
  if exists (select 1 from public.in_app_notifications where entity_id = fu_2h
             and event_type = 'follow_up.escalated') then
    raise exception 'FAIL R3d 2h-overdue follow-up was escalated (threshold is 24h)';
  end if;
  raise notice 'PASS R3d escalated inbox rows exist for >24h only';
end $$;

-- ============ R4. run_reminder_sweep: authenticated blocked, service_role works ============
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"40000000-0000-0000-0000-000000000001"}', true);
do $$
declare
  r record;
begin
  begin
    select * into r from public.run_reminder_sweep();
    raise exception 'FAIL R4a authenticated sweep succeeded';
  exception when others then
    -- EXECUTE is revoked from authenticated, so Postgres blocks the call
    -- before the function's own server-only check runs. Either denial is
    -- the correct outcome; the revoke is the enforcement.
    if sqlerrm not like '%permission denied for function%' then
      raise exception 'FAIL R4a wrong error for authenticated sweep: %', sqlerrm;
    end if;
    raise notice 'PASS R4a authenticated caller cannot run the sweep (EXECUTE revoked)';
  end;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$
declare
  r record;
begin
  -- R4b: first sweep notifies 4 overdue assignees (ws_a 30h + 2h, ws_b 30h,
  -- and the unassigned 30h follow-up via its lead's assignee), escalates 3
  -- follow-ups (>24h in both workspaces), creates 1 new escalation row
  -- (ws_b owner; ws_a owner was already notified in R3).
  select * into r from public.run_reminder_sweep();
  if r.overdue_notified <> 4 then
    raise exception 'FAIL R4b expected overdue_notified=4, got %', r.overdue_notified;
  end if;
  if r.escalated_follow_ups <> 3 then
    raise exception 'FAIL R4b expected escalated_follow_ups=3, got %', r.escalated_follow_ups;
  end if;
  if r.escalation_notifications_created <> 1 then
    raise exception 'FAIL R4b expected escalation_notifications_created=1, got %',
      r.escalation_notifications_created;
  end if;
  raise notice 'PASS R4b first sweep: overdue_notified=4 escalated=3 new_escalations=1';

  -- R4c: second sweep creates nothing (idempotent).
  select * into r from public.run_reminder_sweep();
  if r.overdue_notified <> 0 or r.escalated_follow_ups <> 3
     or r.escalation_notifications_created <> 0 then
    raise exception 'FAIL R4c second sweep not idempotent: overdue=% esc=% created=%',
      r.overdue_notified, r.escalated_follow_ups, r.escalation_notifications_created;
  end if;
  raise notice 'PASS R4c second sweep creates nothing new';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- verify sweep inbox rows as superuser
do $$
declare
  fu_30h uuid := (select v from test_fixtures where k = 'fu_30h');
  fu_2h uuid := (select v from test_fixtures where k = 'fu_2h');
  fu_b30h uuid := (select v from test_fixtures where k = 'fu_b30h');
  fu_done uuid := (select v from test_fixtures where k = 'fu_done');
  fu_arch uuid := (select v from test_fixtures where k = 'fu_arch');
  fu_unassigned uuid := (select v from test_fixtures where k = 'fu_unassigned');
  n int;
begin
  select count(*) into n from public.in_app_notifications
    where event_type = 'follow_up.overdue'
      and entity_id in (fu_30h, fu_2h, fu_b30h, fu_unassigned);
  if n <> 4 then
    raise exception 'FAIL R4d expected 4 overdue inbox rows, got %', n;
  end if;
  -- An unassigned follow-up notifies its lead's assignee (see R4b), but
  -- completed and archived-lead follow-ups get no row at all.
  if exists (select 1 from public.in_app_notifications
             where entity_id in (fu_done, fu_arch)
               and event_type = 'follow_up.overdue') then
    raise exception 'FAIL R4d completed/archived follow-up got an overdue row';
  end if;
  raise notice 'PASS R4d overdue inbox rows correct; completed/archived skipped';
end $$;

-- ============ R5. notification opt-out is respected ============
do $$
declare
  ws_b uuid := (select v from test_fixtures where k = 'ws_b');
  u_wsb uuid := (select v from test_fixtures where k = 'u_wsb');
  lead_b uuid := (select v from test_fixtures where k = 'lead_b');
  fu_new uuid;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into public.notification_preferences (workspace_id, user_id, in_app_enabled)
  values (ws_b, u_wsb, false)
  on conflict (workspace_id, user_id) do update set in_app_enabled = false;
  insert into public.follow_ups (workspace_id, lead_id, title, due_at, assigned_to)
  values (ws_b, lead_b, 'WsB overdue 5h opted out', now() - interval '5 hours', u_wsb)
  returning id into fu_new;
  insert into test_fixtures (k, v) values ('fu_optout', fu_new)
  on conflict (k) do update set v = excluded.v;
  raise notice 'PASS R5a opt-out fixture created (fu=%)', fu_new;
end $$;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$
declare
  r record;
begin
  select * into r from public.run_reminder_sweep();
  if r.overdue_notified <> 0 then
    raise exception 'FAIL R5b opted-out user was notified (overdue_notified=%)', r.overdue_notified;
  end if;
  raise notice 'PASS R5b sweep skips opted-out recipients';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

do $$
declare
  fu_optout uuid := (select v from test_fixtures where k = 'fu_optout');
  n int;
begin
  select count(*) into n from public.in_app_notifications where entity_id = fu_optout;
  if n <> 0 then
    raise exception 'FAIL R5c % notification rows exist for opted-out follow-up', n;
  end if;
  raise notice 'PASS R5c no inbox row for opted-out follow-up';
end $$;

-- ============ R6. reminder event types are admitted by the inbox CHECK ============
do $$
declare
  ws_a uuid := (select v from test_fixtures where k = 'ws_a');
  u_owner uuid := (select v from test_fixtures where k = 'u_owner');
  fu_30h uuid := (select v from test_fixtures where k = 'fu_30h');
begin
  -- The partial unique index dedupes: re-inserting the same escalation is a
  -- no-op, not an error.
  insert into public.in_app_notifications
    (workspace_id, recipient_id, rule_id, event_id, event_type, entity_id)
  values (ws_a, u_owner, null, fu_30h, 'follow_up.escalated', fu_30h)
  on conflict (event_id, recipient_id, event_type)
    where event_type in ('follow_up.overdue', 'follow_up.escalated') do nothing;
  raise notice 'PASS R6 reminder event types admitted and deduped by partial unique index';
end $$;

rollback;
