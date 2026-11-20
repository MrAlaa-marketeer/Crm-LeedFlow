-- Run after all migrations in a disposable Supabase test database.
-- The workspace helper is intentionally used instead of trusting client filters.
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
do $$
declare ws_a uuid; ws_b uuid; lead_a uuid;
begin
  select id into ws_a from public.workspaces limit 1;
  select id into ws_b from public.workspaces where id <> ws_a limit 1;
  if ws_a is null or ws_b is null then raise notice 'Create two workspace fixtures before running deals isolation'; return; end if;
  select id into lead_a from public.leads where workspace_id = ws_a limit 1;
  if lead_a is null then raise notice 'Create a lead fixture before running deals isolation'; return; end if;
  insert into public.deals(workspace_id, lead_id, value_egp) values (ws_a, lead_a, 1);
  if exists (select 1 from public.deals where workspace_id = ws_b) then raise exception 'Cross-workspace deal visible'; end if;
  delete from public.deals where workspace_id = ws_a and lead_id = lead_a;
end $$;
rollback;
