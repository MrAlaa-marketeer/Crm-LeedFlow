-- LeadFlow critical-fixes verification: anon capture_lead + first response + deals.
--
-- RUN: after ALL migrations, in a DISPOSABLE database only, as the postgres
-- (superuser) role — e.g. Supabase SQL Editor, or the PGlite harness that
-- applies the migration chain locally. The script runs inside one transaction
-- and ROLLS BACK at the end, so it creates no permanent data.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/critical_fixes_anon.sql
--
-- Every check RAISES an exception on failure (the script stops) and emits a
-- NOTICE on pass, so a silent pass is impossible. Checks that must run as a
-- specific caller (anon / authenticated member / service_role) switch role with
-- SET LOCAL role + request.jwt.claims, exactly as PostgREST does, and switch
-- back with RESET ROLE. Row verification after a role-switched call is done by
-- the superuser afterwards, because RLS hides rows from anon.
--
-- Fixture ids are fixed UUIDs so the file is re-runnable in a fresh database.
-- auth.users inserts trigger handle_new_user() on a real Supabase project,
-- which creates an extra profile/workspace per fixture user — harmless, the
-- fixture inserts below use ON CONFLICT DO NOTHING.
begin;

create temp table if not exists anon_capture_results (
  label text primary key,
  lead_id uuid,
  err text
);
create temp table if not exists test_fixtures (k text primary key, v uuid);
-- Role-switched sections run as anon / authenticated / service_role in the
-- same session, so the temp tables they share need explicit grants.
grant all on anon_capture_results to anon, authenticated, service_role;
grant all on test_fixtures to anon, authenticated, service_role;

-- ============ FIXTURES (superuser) ============
do $$
declare
  ws_a uuid := '11111111-1111-1111-1111-111111111111';
  ws_b uuid := '22222222-2222-2222-2222-222222222222';
  ws_c uuid := '33333333-3333-3333-3333-333333333333';
  u_owner uuid := '10000000-0000-0000-0000-000000000001';
  u_agent uuid := '10000000-0000-0000-0000-000000000002';
  u_agent2 uuid := '10000000-0000-0000-0000-000000000003';
  u_outsider uuid := '10000000-0000-0000-0000-000000000004';
  u_wsb uuid := '10000000-0000-0000-0000-000000000005';
  proj uuid := '30000000-0000-0000-0000-000000000001';
  p1 uuid := '30000000-0000-0000-0000-000000000011';
  p2 uuid := '30000000-0000-0000-0000-000000000012';
  p3 uuid := '30000000-0000-0000-0000-000000000013';
  lead1 uuid;
  fu1 uuid;
begin
  -- The pre-existing follow_ups_before_write() still judges the assignee via
  -- is_user_in_workspace(), i.e. via the caller, so fixture follow-ups are
  -- created under a service_role JWT, exactly as the app's server would.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_user_meta_data)
  values
    (u_owner,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@test.local',  'x', now(), now(), now(), '{}'::jsonb),
    (u_agent,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'agent@test.local',  'x', now(), now(), now(), '{}'::jsonb),
    (u_agent2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'agent2@test.local', 'x', now(), now(), now(), '{}'::jsonb),
    (u_outsider,'00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'outsider@test.local','x', now(), now(), now(), '{}'::jsonb),
    (u_wsb,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'wsb@test.local',   'x', now(), now(), now(), '{}'::jsonb)
  on conflict (id) do nothing;

  insert into public.profiles (id, full_name, language)
  values (u_owner, 'Owner', 'en'), (u_agent, 'Agent', 'en'), (u_agent2, 'Agent 2', 'en'),
         (u_outsider, 'Outsider', 'en'), (u_wsb, 'WsB Member', 'en')
  on conflict (id) do nothing;

  insert into public.workspaces (id, name, created_by)
  values (ws_a, 'Test Agency A', u_owner), (ws_b, 'Test Agency B', u_wsb),
         (ws_c, 'Member-less Agency', u_owner)
  on conflict (id) do nothing;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws_a, u_owner, 'owner'), (ws_a, u_agent, 'agent'), (ws_a, u_agent2, 'agent'),
         (ws_b, u_wsb, 'owner')
  on conflict (workspace_id, user_id) do nothing;

  insert into public.projects (id, workspace_id, name)
  values (proj, ws_a, 'Test Project')
  on conflict (id, workspace_id) do nothing;

  insert into public.properties (id, workspace_id, project_id, unit_code, property_type, price, availability)
  values (p1, ws_a, proj, 'U-1', 'apartment', 1000000, 'available'),
         (p2, ws_a, proj, 'U-2', 'apartment', 2000000, 'available'),
         (p3, ws_a, proj, 'U-3', 'apartment', 3000000, 'available')
  on conflict (id, workspace_id) do nothing;

  insert into public.leads (workspace_id, full_name, phone, source, assigned_to)
  values (ws_a, 'First Response Lead', '+201000000001', 'website', u_agent)
  returning id into lead1;
  insert into public.follow_ups (workspace_id, lead_id, title, due_at, assigned_to)
  values (ws_a, lead1, 'Call back', now() + interval '1 day', u_agent)
  returning id into fu1;

  -- stash fixture ids for the later sections
  insert into test_fixtures values
    ('ws_a', ws_a), ('ws_b', ws_b), ('ws_c', ws_c),
    ('u_owner', u_owner), ('u_agent', u_agent), ('u_agent2', u_agent2),
    ('u_outsider', u_outsider), ('u_wsb', u_wsb),
    ('proj', proj), ('p1', p1), ('p2', p2), ('p3', p3),
    ('lead1', lead1), ('fu1', fu1)
  on conflict (k) do update set v = excluded.v;
  raise notice 'PASS F fixtures created (lead1=%, fu1=%)', lead1, fu1;
end $$;

-- ============ A. ANON CAPTURE (public-form path) ============
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
declare
  ws_a uuid := (select v from test_fixtures where k = 'ws_a');
  ws_b uuid := (select v from test_fixtures where k = 'ws_b');
  ws_c uuid := (select v from test_fixtures where k = 'ws_c');
  id1 uuid; id2 uuid; id3 uuid; i int; got uuid; err text;
begin
  -- A1: anon capture succeeds
  begin
    id1 := public.capture_lead(ws_a, 'Anon Visitor', '+201012345678');
    if id1 is null then raise exception 'capture returned null'; end if;
    insert into anon_capture_results values ('anon_capture', id1, null)
      on conflict (label) do update set lead_id = excluded.lead_id;
    raise notice 'PASS A1 anon capture succeeds id=%', id1;
  exception when others then
    insert into anon_capture_results values ('anon_capture', null, sqlerrm)
      on conflict (label) do update set err = excluded.err;
    raise exception 'FAIL A1 anon capture: %', sqlerrm;
  end;

  -- A2: non-Egyptian number rejected
  begin
    got := public.capture_lead(ws_a, 'Bad Phone', '+441234567890');
    raise exception 'FAIL A2 non-Egyptian number was accepted id=%', got;
  exception when others then
    if sqlerrm not like '%invalid Egyptian mobile%' then
      raise exception 'FAIL A2 wrong error for non-Egyptian number: %', sqlerrm;
    end if;
    raise notice 'PASS A2 non-Egyptian number rejected';
  end;

  -- A3: honeypot rejected
  begin
    got := public.capture_lead(ws_a, 'Bot', '+201012345699', null, null, null, 'website', 'spam');
    raise exception 'FAIL A3 honeypot was accepted id=%', got;
  exception when others then
    if sqlerrm not like '%invalid request%' then
      raise exception 'FAIL A3 wrong error for honeypot: %', sqlerrm;
    end if;
    raise notice 'PASS A3 honeypot rejected';
  end;

  -- A4: duplicate same phone within 24h returns the same lead (both formats).
  -- Row-count verification is done by the superuser afterwards (RLS hides
  -- rows from anon, so a COUNT here would always read 0).
  id2 := public.capture_lead(ws_a, 'Anon Visitor Again', '+201012345681');
  got := public.capture_lead(ws_a, 'Anon Visitor Again', '01012345681');
  if got is distinct from id2 then
    raise exception 'FAIL A4 duplicate in local format created a new lead % (expected %)', got, id2;
  end if;
  insert into anon_capture_results values ('anon_duplicate', id2, null)
    on conflict (label) do update set lead_id = excluded.lead_id;
  raise notice 'PASS A4 duplicate suppression returns same lead id=%', id2;

  -- A5: rate limit — 6 calls for a fresh phone, 6th must fail
  for i in 1..5 loop
    got := public.capture_lead(ws_a, 'Rate Test', '+201012345682');
  end loop;
  begin
    got := public.capture_lead(ws_a, 'Rate Test', '+201012345682');
    raise exception 'FAIL A5 6th call in an hour was accepted id=%', got;
  exception when others then
    if sqlerrm not like '%rate limit exceeded%' then
      raise exception 'FAIL A5 wrong error on 6th call: %', sqlerrm;
    end if;
    raise notice 'PASS A5 6th call rate-limited';
  end;

  -- A6: anon capture in a member-less workspace succeeds with NULL assignee
  id3 := public.capture_lead(ws_c, 'No Members Yet', '+201012345683');
  insert into anon_capture_results values ('anon_memberless', id3, null)
    on conflict (label) do update set lead_id = excluded.lead_id;
  raise notice 'PASS A6 anon capture in member-less workspace id=%', id3;

  -- A7: same phone in another workspace creates a different lead
  got := public.capture_lead(ws_b, 'Other Workspace', '+201012345678');
  if got = id1 then
    raise exception 'FAIL A7 same phone in ws_b returned the ws_a lead';
  end if;
  raise notice 'PASS A7 same phone in ws_b creates a separate lead id=%', got;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- verify the anon-created rows as superuser (RLS hides them from anon)
do $$
declare
  ws_a uuid := (select v from test_fixtures where k = 'ws_a');
  ws_c uuid := (select v from test_fixtures where k = 'ws_c');
  id1 uuid := (select lead_id from anon_capture_results where label = 'anon_capture');
  id3 uuid := (select lead_id from anon_capture_results where label = 'anon_memberless');
  r record;
begin
  select * into r from public.leads where id = id1;
  if r.phone <> '+201012345678' then
    raise exception 'FAIL A1 stored phone is % (expected +201012345678)', r.phone;
  end if;
  if r.assigned_to is null then
    raise exception 'FAIL A1 anon lead was not assigned to anyone';
  end if;
  if not exists (select 1 from public.workspace_members wm
                 where wm.workspace_id = ws_a and wm.user_id = r.assigned_to) then
    raise exception 'FAIL A1 anon lead assignee % is not a member of ws_a', r.assigned_to;
  end if;
  raise notice 'PASS A1 stored lead phone=% assigned_to=% (member of ws_a)', r.phone, r.assigned_to;

  select * into r from public.leads where id = id3;
  if r.workspace_id <> ws_c or r.assigned_to is not null then
    raise exception 'FAIL A6 member-less capture: workspace=% assigned_to=%', r.workspace_id, r.assigned_to;
  end if;
  raise notice 'PASS A6 member-less lead has NULL assignee as expected';

  -- A4 (continued): exactly one lead row for the duplicated phone in ws_a
  if (select count(*) from public.leads l
      where l.workspace_id = ws_a
        and regexp_replace(l.phone, '[^0-9]', '', 'g') in ('201012345681', '01012345681')) <> 1 then
    raise exception 'FAIL A4 duplicate suppression created more than one lead row';
  end if;
  raise notice 'PASS A4 exactly one lead row for the duplicated phone';
end $$;

-- ============ B. AUTHENTICATED MEMBER ============
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from test_fixtures where k = 'u_agent'), 'role', 'authenticated')::text, true);
do $$
declare
  ws_a uuid := (select v from test_fixtures where k = 'ws_a');
  u_outsider uuid := (select v from test_fixtures where k = 'u_outsider');
  u_wsb uuid := (select v from test_fixtures where k = 'u_wsb');
  u_agent uuid := (select v from test_fixtures where k = 'u_agent');
  id1 uuid; got uuid;
begin
  -- B1: member capture succeeds
  id1 := public.capture_lead(ws_a, 'Member Capture', '+201012345684');
  if id1 is null then raise exception 'FAIL B1 member capture returned null'; end if;
  raise notice 'PASS B1 member capture succeeds id=%', id1;

  -- B2: direct insert assigned to a non-member is still rejected
  begin
    insert into public.leads (workspace_id, full_name, phone, source, assigned_to)
    values (ws_a, 'Bad Assignee', '+201000000090', 'website', u_outsider);
    raise exception 'FAIL B2 insert with non-member assignee was accepted';
  exception when others then
    if sqlerrm not like '%Assigned agent must belong to this workspace%' then
      raise exception 'FAIL B2 wrong error for non-member assignee: %', sqlerrm;
    end if;
    raise notice 'PASS B2 direct insert with non-member assignee rejected';
  end;

  -- B3: direct insert assigned to a member of ANOTHER workspace is rejected
  begin
    insert into public.leads (workspace_id, full_name, phone, source, assigned_to)
    values (ws_a, 'Cross Workspace', '+201000000091', 'website', u_wsb);
    raise exception 'FAIL B3 insert with cross-workspace assignee was accepted';
  exception when others then
    if sqlerrm not like '%Assigned agent must belong to this workspace%' then
      raise exception 'FAIL B3 wrong error for cross-workspace assignee: %', sqlerrm;
    end if;
    raise notice 'PASS B3 direct insert with cross-workspace assignee rejected';
  end;

  -- B4: direct insert assigned to a member of this workspace succeeds
  insert into public.leads (workspace_id, full_name, phone, source, assigned_to)
  values (ws_a, 'Good Assignee', '+201000000092', 'website', u_agent)
  returning id into got;
  raise notice 'PASS B4 direct insert with member assignee succeeds id=%', got;

  -- B5: reassigning an existing lead to a non-member is rejected
  begin
    update public.leads set assigned_to = u_outsider where id = got;
    raise exception 'FAIL B5 update reassigning to non-member was accepted';
  exception when others then
    if sqlerrm not like '%Assigned agent must belong to this workspace%' then
      raise exception 'FAIL B5 wrong error on reassign to non-member: %', sqlerrm;
    end if;
    raise notice 'PASS B5 update reassigning to non-member rejected';
  end;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- ============ C. SERVICE_ROLE CAPTURE ============
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$
declare
  ws_a uuid := (select v from test_fixtures where k = 'ws_a');
  id1 uuid;
begin
  id1 := public.capture_lead(ws_a, 'Service Capture', '+201012345685');
  if id1 is null then raise exception 'FAIL C1 service_role capture returned null'; end if;
  raise notice 'PASS C1 service_role capture succeeds id=%', id1;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- ============ D. ANON DIRECT INSERT STILL BLOCKED ============
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
declare
  ws_a uuid := (select v from test_fixtures where k = 'ws_a');
begin
  begin
    insert into public.leads (workspace_id, full_name, phone, source)
    values (ws_a, 'Anon Direct', '+201000000093', 'website');
    raise exception 'FAIL D1 anon direct insert was accepted — trigger change opened a hole';
  exception when others then
    if sqlerrm not like '%permission denied%' and sqlerrm not like '%row-level security%' then
      raise exception 'FAIL D1 anon direct insert failed with unexpected error: %', sqlerrm;
    end if;
    raise notice 'PASS D1 anon direct insert still blocked (%)', sqlerrm;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- ============ E. FIRST RESPONSE (superuser; triggers are what is tested) ============
-- follow_ups_before_write() still uses the caller-based is_user_in_workspace(),
-- so this section runs under a service_role JWT (as the app server would).
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$
declare
  ws_a uuid := (select v from test_fixtures where k = 'ws_a');
  lead1 uuid := (select v from test_fixtures where k = 'lead1');
  fu1 uuid := (select v from test_fixtures where k = 'fu1');
  u_agent uuid := (select v from test_fixtures where k = 'u_agent');
  l2 uuid; l3 uuid; l4 uuid; t1 timestamptz; t2 timestamptz;
begin
  -- E1: completing a follow-up succeeds and sets first_response_at
  update public.follow_ups set completed_at = now() where id = fu1;
  select first_response_at into t1 from public.leads where id = lead1;
  if t1 is null then raise exception 'FAIL E1 follow-up completion did not set first_response_at'; end if;
  raise notice 'PASS E1 follow-up completion sets first_response_at=%', t1;

  -- E2: WhatsApp activity sets it; a second one does not overwrite it
  insert into public.leads (workspace_id, full_name, phone, source, assigned_to)
  values (ws_a, 'WA Lead', '+201000000101', 'website', u_agent) returning id into l2;
  insert into public.lead_activities (workspace_id, lead_id, actor_id, activity_type)
  values (ws_a, l2, u_agent, 'lead.response_whatsapp');
  select first_response_at into t1 from public.leads where id = l2;
  if t1 is null then raise exception 'FAIL E2 WhatsApp activity did not set first_response_at'; end if;
  insert into public.lead_activities (workspace_id, lead_id, actor_id, activity_type)
  values (ws_a, l2, u_agent, 'lead.response_whatsapp');
  select first_response_at into t2 from public.leads where id = l2;
  if t2 is distinct from t1 then raise exception 'FAIL E2 second WhatsApp overwrote first_response_at'; end if;
  raise notice 'PASS E2 WhatsApp sets first_response_at and second response does not overwrite it';

  -- E3: call activity sets it
  insert into public.leads (workspace_id, full_name, phone, source, assigned_to)
  values (ws_a, 'Call Lead', '+201000000102', 'website', u_agent) returning id into l3;
  insert into public.lead_activities (workspace_id, lead_id, actor_id, activity_type)
  values (ws_a, l3, u_agent, 'lead.response_call');
  select first_response_at into t1 from public.leads where id = l3;
  if t1 is null then raise exception 'FAIL E3 call activity did not set first_response_at'; end if;
  raise notice 'PASS E3 call activity sets first_response_at';

  -- E4: non-response activity does not set it
  insert into public.leads (workspace_id, full_name, phone, source, assigned_to)
  values (ws_a, 'Quiet Lead', '+201000000103', 'website', u_agent) returning id into l4;
  insert into public.lead_activities (workspace_id, lead_id, actor_id, activity_type)
  values (ws_a, l4, u_agent, 'lead.updated');
  select first_response_at into t1 from public.leads where id = l4;
  if t1 is not null then raise exception 'FAIL E4 non-response activity set first_response_at'; end if;
  raise notice 'PASS E4 non-response activity does not set first_response_at';
end $$;

-- ============ F. DEALS DOUBLE-SALE (superuser) ============
do $$
declare
  ws_a uuid := (select v from test_fixtures where k = 'ws_a');
  p1 uuid := (select v from test_fixtures where k = 'p1');
  p2 uuid := (select v from test_fixtures where k = 'p2');
  p3 uuid := (select v from test_fixtures where k = 'p3');
  lead1 uuid := (select v from test_fixtures where k = 'lead1');
  d1 uuid; d2 uuid; avail text;
begin
  -- F0: the partial unique index exists
  if not exists (select 1 from pg_indexes
                 where schemaname = 'public'
                   and indexname = 'deals_one_active_deal_per_unit_idx') then
    raise exception 'FAIL F0 partial unique index deals_one_active_deal_per_unit_idx is missing';
  end if;
  -- the trigger still judges the ASSIGNEE directly, not the caller
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'leads_before_write' and p.prosecdef) then
    raise exception 'FAIL F0 leads_before_write is not SECURITY DEFINER';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'is_user_in_workspace'
                   and pg_get_functiondef(p.oid) like '%auth.role()%') then
    raise exception 'FAIL F0 is_user_in_workspace lost its caller check — hardening was weakened';
  end if;
  raise notice 'PASS F0 index exists, leads_before_write is SECURITY DEFINER, is_user_in_workspace unchanged';

  -- F1: deal 1 reserves U-1
  insert into public.deals (workspace_id, lead_id, property_id, unit_id, value_egp, stage)
  values (ws_a, lead1, p1, p1, 1000000, 'reserved') returning id into d1;
  select availability into avail from public.properties where id = p1;
  if avail <> 'reserved' then raise exception 'FAIL F1 unit not reserved, availability=%', avail; end if;
  raise notice 'PASS F1 deal 1 reserves U-1 id=%', d1;

  -- F2: deal 2 reserving the same unit must fail (index and/or trigger guard)
  begin
    insert into public.deals (workspace_id, lead_id, property_id, unit_id, value_egp, stage)
    values (ws_a, lead1, p1, p1, 1000000, 'reserved');
    raise exception 'FAIL F2 second reserve on U-1 was accepted';
  exception when others then
    if sqlerrm not like '%Unit already has an active or won deal%'
       and sqlerrm not like '%deals_one_active_deal_per_unit_idx%'
       and sqlerrm not like '%duplicate key value%' then
      raise exception 'FAIL F2 wrong error on second reserve: %', sqlerrm;
    end if;
    raise notice 'PASS F2 second reserve on U-1 fails (%)', sqlerrm;
  end;

  -- F3: deal 1 reserved -> won, unit sold
  update public.deals set stage = 'won' where id = d1;
  select availability into avail from public.properties where id = p1;
  if avail <> 'sold' then raise exception 'FAIL F3 unit not sold after won, availability=%', avail; end if;
  raise notice 'PASS F3 deal 1 won, unit sold';

  -- F4: a lost deal on the sold unit does not release it
  insert into public.deals (workspace_id, lead_id, property_id, unit_id, value_egp, stage)
  values (ws_a, lead1, p1, p1, 1000000, 'lost');
  select availability into avail from public.properties where id = p1;
  if avail <> 'sold' then raise exception 'FAIL F4 lost deal released a sold unit, availability=%', avail; end if;
  raise notice 'PASS F4 lost deal on sold unit does not release it';

  -- F5: sole deal on U-2 reserved then lost releases the unit
  insert into public.deals (workspace_id, lead_id, property_id, unit_id, value_egp, stage)
  values (ws_a, lead1, p2, p2, 2000000, 'reserved') returning id into d2;
  update public.deals set stage = 'lost' where id = d2;
  select availability into avail from public.properties where id = p2;
  if avail <> 'available' then raise exception 'FAIL F5 sole lost deal did not release unit, availability=%', avail; end if;
  raise notice 'PASS F5 sole deal lost releases unit to available';

  -- F6: deals on different units succeed in parallel
  insert into public.deals (workspace_id, lead_id, property_id, unit_id, value_egp, stage)
  values (ws_a, lead1, p2, p2, 2000000, 'reserved'),
         (ws_a, lead1, p3, p3, 3000000, 'reserved');
  raise notice 'PASS F6 deals on different units succeed';

  -- F7: unit-less deal succeeds
  insert into public.deals (workspace_id, lead_id, value_egp, stage)
  values (ws_a, lead1, 500000, 'reserved');
  raise notice 'PASS F7 unit-less deal succeeds';
end $$;

do $$ begin raise notice 'ALL CRITICAL-FIXES CHECKS PASSED'; end $$;
rollback;
