-- LeadFlow manager-role verification (Module B).
--
-- RUN: after ALL migrations, in a DISPOSABLE database only, as the postgres
-- (superuser) role — e.g. Supabase SQL Editor, or the PGlite harness that
-- applies the migration chain locally.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/manager_role.sql
--
-- The script runs inside one transaction and ROLLS BACK at the end, so it
-- creates no permanent data. Every check RAISES an exception on failure
-- (the script stops) and emits a NOTICE on pass, so a silent pass is
-- impossible. Checks that must run as a specific caller (owner / manager /
-- agent / outsider) switch role with SET LOCAL role + request.jwt.claims /
-- request.jwt.claim.sub, exactly as PostgREST does, and switch back with
-- RESET ROLE. Row verification after a role-switched call is done by the
-- superuser afterwards, because RLS hides rows from non-owners.
--
-- Fixture ids are fixed UUIDs so the file is re-runnable in a fresh database.
-- auth.users inserts trigger handle_new_user() on a real Supabase project,
-- which creates an extra profile/workspace per fixture user — harmless.
-- ws_a has exactly 3 members (owner + manager + agent): the starter plan
-- seat cap is 3, so no fourth member is added to ws_a.
begin;

-- ============ FIXTURES (superuser) ============
do $$
declare
  ws_a uuid := '11111111-1111-1111-1111-111111111111';
  ws_b uuid := '22222222-2222-2222-2222-222222222222';
  u_owner uuid := '10000000-0000-0000-0000-000000000001';
  u_mgr uuid := '10000000-0000-0000-0000-000000000002';
  u_agent uuid := '10000000-0000-0000-0000-000000000003';
  u_outsider uuid := '10000000-0000-0000-0000-000000000004';
  u_wsb uuid := '10000000-0000-0000-0000-000000000005';
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_user_meta_data)
  values
    (u_owner,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@test.local',    'x', now(), now(), now(), '{}'::jsonb),
    (u_mgr,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'manager@test.local',  'x', now(), now(), now(), '{}'::jsonb),
    (u_agent,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'agent@test.local',    'x', now(), now(), now(), '{}'::jsonb),
    (u_outsider,'00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'outsider@test.local','x', now(), now(), now(), '{}'::jsonb),
    (u_wsb,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'wsb@test.local',     'x', now(), now(), now(), '{}'::jsonb)
  on conflict (id) do nothing;

  insert into public.profiles (id, full_name, language)
  values (u_owner, 'Owner', 'en'), (u_mgr, 'Manager', 'en'), (u_agent, 'Agent', 'en'),
         (u_outsider, 'Outsider', 'en'), (u_wsb, 'WsB Member', 'en')
  on conflict (id) do nothing;

  insert into public.workspaces (id, name, created_by)
  values (ws_a, 'Test Agency A', u_owner), (ws_b, 'Test Agency B', u_wsb)
  on conflict (id) do nothing;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws_a, u_owner, 'owner'), (ws_a, u_mgr, 'manager'), (ws_a, u_agent, 'agent'),
         (ws_b, u_wsb, 'owner')
  on conflict (workspace_id, user_id) do nothing;

  create temp table if not exists manager_role_fixtures (k text primary key, v uuid);
  grant all on manager_role_fixtures to anon, authenticated, service_role;
  insert into manager_role_fixtures values
    ('ws_a', ws_a), ('ws_b', ws_b),
    ('u_owner', u_owner), ('u_mgr', u_mgr), ('u_agent', u_agent),
    ('u_outsider', u_outsider), ('u_wsb', u_wsb)
  on conflict (k) do update set v = excluded.v;
  raise notice 'PASS fixtures created (ws_a=%, ws_b=%)', ws_a, ws_b;
end $$;

-- ============ M1. Enum value exists ============
do $$
begin
  if not exists (select 1 from pg_enum
    where enumtypid = 'public.workspace_role'::regtype and enumlabel = 'manager') then
    raise exception 'FAIL M1 workspace_role has no manager value';
  end if;
  raise notice 'PASS M1 workspace_role enum contains manager';
end $$;

-- Helper: run the following DO block as a given fixture user.
-- (Each section sets role + JWT, runs its checks, then resets.)

-- ============ M2. Role-hierarchy helper ============
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"10000000-0000-0000-0000-000000000002"}', true);
do $$
declare
  ws_a uuid := (select v from manager_role_fixtures where k = 'ws_a');
begin
  -- Caller is the manager: manager/agent yes, owner no.
  if not public.has_workspace_role_or_above(ws_a, 'manager') then raise exception 'FAIL M2 manager cannot see manager level'; end if;
  if not public.has_workspace_role_or_above(ws_a, 'agent') then raise exception 'FAIL M2 manager cannot see agent level'; end if;
  if public.has_workspace_role_or_above(ws_a, 'owner') then raise exception 'FAIL M2 manager passes owner level'; end if;
  raise notice 'PASS M2a helper as manager: manager/agent true, owner false';
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"10000000-0000-0000-0000-000000000003"}', true);
do $$
declare
  ws_a uuid := (select v from manager_role_fixtures where k = 'ws_a');
begin
  -- Caller is the agent: agent only.
  if not public.has_workspace_role_or_above(ws_a, 'agent') then raise exception 'FAIL M2 agent cannot see agent level'; end if;
  if public.has_workspace_role_or_above(ws_a, 'manager') then raise exception 'FAIL M2 agent passes manager level'; end if;
  if public.has_workspace_role_or_above(ws_a, 'owner') then raise exception 'FAIL M2 agent passes owner level'; end if;
  raise notice 'PASS M2b helper as agent: agent true, manager/owner false';
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"10000000-0000-0000-0000-000000000001"}', true);
do $$
declare
  ws_a uuid := (select v from manager_role_fixtures where k = 'ws_a');
begin
  -- Caller is the owner: all levels.
  if not public.has_workspace_role_or_above(ws_a, 'owner') then raise exception 'FAIL M2 owner fails owner level'; end if;
  if not public.has_workspace_role_or_above(ws_a, 'manager') then raise exception 'FAIL M2 owner fails manager level'; end if;
  if not public.has_workspace_role_or_above(ws_a, 'agent') then raise exception 'FAIL M2 owner fails agent level'; end if;
  raise notice 'PASS M2c helper as owner: all levels true';
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"10000000-0000-0000-0000-000000000004"}', true);
do $$
declare
  ws_a uuid := (select v from manager_role_fixtures where k = 'ws_a');
begin
  -- Caller is an outsider (not a member): nothing.
  if public.has_workspace_role_or_above(ws_a, 'agent') then raise exception 'FAIL M2 outsider passes agent level'; end if;
  raise notice 'PASS M2d helper as outsider: all levels false';
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '', true);

-- ============ M3. Owner role changes agent <-> manager ============
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"10000000-0000-0000-0000-000000000001"}', true);
do $$
declare
  ws_a uuid := (select v from manager_role_fixtures where k = 'ws_a');
  u_agent uuid := (select v from manager_role_fixtures where k = 'u_agent');
  r public.workspace_role;
begin
  perform public.change_workspace_member_role(ws_a, u_agent, 'manager');
  select role into r from public.workspace_members where workspace_id = ws_a and user_id = u_agent;
  if r is distinct from 'manager' then raise exception 'FAIL M3 promote to manager did not stick (role=%)', r; end if;
  perform public.change_workspace_member_role(ws_a, u_agent, 'agent');
  select role into r from public.workspace_members where workspace_id = ws_a and user_id = u_agent;
  if r is distinct from 'agent' then raise exception 'FAIL M3 demote to agent did not stick (role=%)', r; end if;
  raise notice 'PASS M3 owner changes agent <-> manager and back';
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '', true);

-- ============ M4. Role-change rejections ============
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"10000000-0000-0000-0000-000000000001"}', true);
do $$
declare
  ws_a uuid := (select v from manager_role_fixtures where k = 'ws_a');
  ws_b uuid := (select v from manager_role_fixtures where k = 'ws_b');
  u_owner uuid := (select v from manager_role_fixtures where k = 'u_owner');
  u_agent uuid := (select v from manager_role_fixtures where k = 'u_agent');
  u_wsb uuid := (select v from manager_role_fixtures where k = 'u_wsb');
begin
  begin
    perform public.change_workspace_member_role(ws_a, u_agent, 'owner');
    raise exception 'FAIL M4a change to owner was accepted';
  exception when others then
    if sqlerrm not like '%agent and manager%' then raise exception 'FAIL M4a wrong error: %', sqlerrm; end if;
    raise notice 'PASS M4a owner cannot change a member to owner';
  end;
  begin
    perform public.change_workspace_member_role(ws_a, u_owner, 'manager');
    raise exception 'FAIL M4b owner changed their own role';
  exception when others then
    if sqlerrm not like '%cannot change their own role%' then raise exception 'FAIL M4b wrong error: %', sqlerrm; end if;
    raise notice 'PASS M4b owner cannot change their own role';
  end;
  begin
    perform public.change_workspace_member_role(ws_a, u_wsb, 'manager');
    raise exception 'FAIL M4c cross-workspace member was changed';
  exception when others then
    if sqlerrm not like '%not found%' then raise exception 'FAIL M4c wrong error: %', sqlerrm; end if;
    raise notice 'PASS M4c member of another workspace is not found';
  end;
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"10000000-0000-0000-0000-000000000002"}', true);
do $$
declare
  ws_a uuid := (select v from manager_role_fixtures where k = 'ws_a');
  u_agent uuid := (select v from manager_role_fixtures where k = 'u_agent');
begin
  begin
    perform public.change_workspace_member_role(ws_a, u_agent, 'manager');
    raise exception 'FAIL M4d manager changed a role';
  exception when others then
    if sqlerrm not like '%Only the workspace owner can change member roles%' then raise exception 'FAIL M4d wrong error: %', sqlerrm; end if;
    raise notice 'PASS M4d manager cannot change roles';
  end;
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '', true);

-- ============ M5. Guard trigger blocks owner promotion/demotion ============
do $$
declare
  ws_a uuid := (select v from manager_role_fixtures where k = 'ws_a');
  u_owner uuid := (select v from manager_role_fixtures where k = 'u_owner');
  u_agent uuid := (select v from manager_role_fixtures where k = 'u_agent');
begin
  begin
    update public.workspace_members set role = 'owner' where workspace_id = ws_a and user_id = u_agent;
    raise exception 'FAIL M5a direct UPDATE to owner was accepted';
  exception when others then
    if sqlerrm not like '%Ownership cannot be changed%' then raise exception 'FAIL M5a wrong error: %', sqlerrm; end if;
    raise notice 'PASS M5a guard trigger blocks direct promotion to owner';
  end;
  begin
    update public.workspace_members set role = 'agent' where workspace_id = ws_a and user_id = u_owner;
    raise exception 'FAIL M5b direct UPDATE demoting the owner was accepted';
  exception when others then
    if sqlerrm not like '%Ownership cannot be changed%' then raise exception 'FAIL M5b wrong error: %', sqlerrm; end if;
    raise notice 'PASS M5b guard trigger blocks demoting the owner';
  end;
end $$;

-- ============ M6. Team workload visibility ============
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"10000000-0000-0000-0000-000000000002"}', true);
do $$
declare
  ws_a uuid := (select v from manager_role_fixtures where k = 'ws_a');
  n int;
begin
  select count(*) into n from public.team_dashboard_stats(ws_a);
  if n <> 3 then raise exception 'FAIL M6a manager sees % team rows (expected 3)', n; end if;
  raise notice 'PASS M6a manager sees the whole team in team_dashboard_stats';
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"10000000-0000-0000-0000-000000000003"}', true);
do $$
declare
  ws_a uuid := (select v from manager_role_fixtures where k = 'ws_a');
  n int;
begin
  select count(*) into n from public.team_dashboard_stats(ws_a);
  if n <> 1 then raise exception 'FAIL M6b agent sees % team rows (expected 1)', n; end if;
  raise notice 'PASS M6b agent still sees only themselves in team_dashboard_stats';
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '', true);

-- ============ M7. Manager works with leads/deals/follow-ups, cannot delete leads/deals ============
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"10000000-0000-0000-0000-000000000002"}', true);
do $$
declare
  ws_a uuid := (select v from manager_role_fixtures where k = 'ws_a');
  u_agent uuid := (select v from manager_role_fixtures where k = 'u_agent');
  lead_id uuid; deal_id uuid; fu_id uuid; n int;
begin
  insert into public.leads (workspace_id, full_name, phone, status)
  values (ws_a, 'Manager Lead', '+201000000201', 'new') returning id into lead_id;
  -- Manager reassigns the lead to the agent (team assignment).
  update public.leads set assigned_to = u_agent where id = lead_id;
  if not found then raise exception 'FAIL M7 manager could not reassign a lead'; end if;
  raise notice 'PASS M7a manager creates and reassigns a lead id=%', lead_id;

  insert into public.deals (workspace_id, lead_id, value_egp, stage)
  values (ws_a, lead_id, 100000, 'reserved') returning id into deal_id;
  update public.deals set value_egp = 120000 where id = deal_id;
  if not found then raise exception 'FAIL M7 manager could not update a deal'; end if;
  raise notice 'PASS M7b manager creates and updates a deal id=%', deal_id;

  insert into public.follow_ups (workspace_id, lead_id, title, due_at, assigned_to)
  values (ws_a, lead_id, 'Call back', now() + interval '1 day', u_agent) returning id into fu_id;
  -- Follow-up delete is member-wide, so a manager may delete one.
  delete from public.follow_ups where id = fu_id;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL M7 follow-up delete by manager removed % rows (expected 1)', n; end if;
  raise notice 'PASS M7c manager creates and deletes a follow-up';

  -- Lead + deal deletes stay owner-only: RLS silently deletes 0 rows.
  delete from public.deals where id = deal_id;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL M7 manager deleted a deal (% rows)', n; end if;
  delete from public.leads where id = lead_id;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL M7 manager deleted a lead (% rows)', n; end if;
  raise notice 'PASS M7d manager cannot delete leads or deals';

  insert into manager_role_fixtures values ('lead1', lead_id), ('deal1', deal_id)
  on conflict (k) do update set v = excluded.v;
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '', true);

-- Owner can still delete the M7 lead/deal (verifies M7 rows exist, then cleans up).
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"10000000-0000-0000-0000-000000000001"}', true);
do $$
declare
  lead_id uuid := (select v from manager_role_fixtures where k = 'lead1');
  n int;
begin
  delete from public.deals where id = (select v from manager_role_fixtures where k = 'deal1');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL M7e owner could not delete the deal (% rows)', n; end if;
  delete from public.leads where id = lead_id;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL M7e owner could not delete the lead (% rows)', n; end if;
  raise notice 'PASS M7e owner can still delete leads and deals';
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '', true);

-- ============ M8. Workspace settings: manager reads, only owner writes ============
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"10000000-0000-0000-0000-000000000002"}', true);
do $$
declare
  ws_a uuid := (select v from manager_role_fixtures where k = 'ws_a');
begin
  begin
    insert into public.workspace_settings (workspace_id, notification_preferences)
    values (ws_a, '{"new_lead": false}'::jsonb);
    raise exception 'FAIL M8a manager wrote workspace_settings';
  exception when others then
    if sqlerrm not like '%row-level security%' then raise exception 'FAIL M8a wrong error: %', sqlerrm; end if;
    raise notice 'PASS M8a manager cannot write workspace_settings (RLS WITH CHECK owner)';
  end;
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"10000000-0000-0000-0000-000000000001"}', true);
do $$
declare
  ws_a uuid := (select v from manager_role_fixtures where k = 'ws_a');
begin
  insert into public.workspace_settings (workspace_id, notification_preferences)
  values (ws_a, '{"new_lead": false, "deal_won": true}'::jsonb)
  on conflict (workspace_id) do update set notification_preferences = excluded.notification_preferences;
  raise notice 'PASS M8b owner writes workspace_settings notification_preferences';
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '', true);

do $$
declare
  ws_a uuid := (select v from manager_role_fixtures where k = 'ws_a');
  prefs jsonb;
begin
  select notification_preferences into prefs from public.workspace_settings where workspace_id = ws_a;
  if prefs ->> 'new_lead' is distinct from 'false' then raise exception 'FAIL M8c stored prefs mismatch: %', prefs; end if;
  raise notice 'PASS M8c notification_preferences stored as %', prefs;
end $$;

-- ============ M9. Billing untouched: payments stay owner-only ============
do $$
declare
  ws_a uuid := (select v from manager_role_fixtures where k = 'ws_a');
begin
  insert into public.payments (company_id, plan, term, method, transaction_ref)
  values (ws_a, 'starter', 'monthly', 'instapay', 'MGR-TEST-001');
  raise notice 'PASS M9 fixture payment inserted';
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"10000000-0000-0000-0000-000000000002"}', true);
do $$
declare
  ws_a uuid := (select v from manager_role_fixtures where k = 'ws_a');
  n int;
begin
  select count(*) into n from public.payments where company_id = ws_a;
  if n <> 0 then raise exception 'FAIL M9a manager sees % payments (expected 0)', n; end if;
  raise notice 'PASS M9a manager sees no payments';
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"10000000-0000-0000-0000-000000000001"}', true);
do $$
declare
  ws_a uuid := (select v from manager_role_fixtures where k = 'ws_a');
  n int;
begin
  select count(*) into n from public.payments where company_id = ws_a;
  if n <> 1 then raise exception 'FAIL M9b owner sees % payments (expected 1)', n; end if;
  raise notice 'PASS M9b owner still sees payments';
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '', true);

-- ============ M10. Demo data: manager cannot remove, owner can ============
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"10000000-0000-0000-0000-000000000002"}', true);
do $$
declare
  ws_a uuid := (select v from manager_role_fixtures where k = 'ws_a');
begin
  begin
    perform public.remove_demo_data(ws_a);
    raise exception 'FAIL M10a manager removed demo data';
  exception when others then
    if sqlerrm not like '%Only the workspace owner can remove demo data%' then raise exception 'FAIL M10a wrong error: %', sqlerrm; end if;
    raise notice 'PASS M10a manager cannot remove demo data';
  end;
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"10000000-0000-0000-0000-000000000001"}', true);
do $$
declare
  ws_a uuid := (select v from manager_role_fixtures where k = 'ws_a');
  loaded int; removed int; n int;
begin
  loaded := public.load_demo_data(ws_a);
  if loaded <> 12 then raise exception 'FAIL M10b load_demo_data returned % (expected 12)', loaded; end if;
  select count(*) into n from public.leads where workspace_id = ws_a and is_demo;
  if n <> 12 then raise exception 'FAIL M10b % demo leads present (expected 12)', n; end if;
  removed := public.remove_demo_data(ws_a);
  if removed <> 12 then raise exception 'FAIL M10b remove_demo_data returned % (expected 12)', removed; end if;
  select count(*) into n from public.leads where workspace_id = ws_a and is_demo;
  if n <> 0 then raise exception 'FAIL M10b % demo leads remain', n; end if;
  raise notice 'PASS M10b owner loads (12) and removes (12) demo data';
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '', true);

-- ============ M11. Manager cannot delete the workspace ============
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"10000000-0000-0000-0000-000000000002"}', true);
do $$
declare
  ws_a uuid := (select v from manager_role_fixtures where k = 'ws_a');
  n int;
begin
  -- workspaces has no DELETE grant at all for authenticated (only SELECT,
  -- UPDATE), so the delete is refused with insufficient_privilege; either
  -- outcome proves the workspace cannot be deleted by a manager.
  begin
    delete from public.workspaces where id = ws_a;
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAIL M11 manager deleted the workspace'; end if;
    raise notice 'PASS M11 manager cannot delete the workspace (0 rows deleted)';
  exception when insufficient_privilege then
    raise notice 'PASS M11 manager cannot delete the workspace (no DELETE grant: %)', sqlerrm;
  end;
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '', true);

do $$
declare
  ws_a uuid := (select v from manager_role_fixtures where k = 'ws_a');
begin
  if not exists (select 1 from public.workspaces where id = ws_a) then
    raise exception 'FAIL M11 workspace is gone';
  end if;
  raise notice 'ALL MANAGER-ROLE CHECKS PASSED';
end $$;

rollback;
