// CI migration + SQL-test runner (PGlite, local only — never touches a remote project).
//
// What it does:
//   1. Applies every file in supabase/migrations/ in order to a fresh
//      in-memory PGlite database, on top of the harness stubs in
//      scripts/pglite-stubs.sql (auth/storage schemas, jwt-claims-based
//      auth.uid()/auth.role(), roles anon/authenticated/service_role, and an
//      extensions.digest stub). The stubs exist only because PGlite is not
//      Supabase; they mirror what Supabase provides in production.
//   2. Checks key objects the migrations must create (manager enum value,
//      capture_lead, run_reminder_sweep, the deals partial unique index).
//   3. Runs every shipped SQL test file in supabase/tests/ against a fresh
//      migrated database, with the per-file setup each file needs:
//        - critical_fixes_anon.sql: signup trigger dropped (fixtures insert
//          profiles/workspaces directly); expects 30 PASS notices.
//        - billing-isolation.sql: signup trigger KEPT — the file relies on
//          handle_new_user() creating companies from auth.users inserts.
//          It raises on failure and rolls back; it emits no PASS notices.
//        - manager_role.sql: expects 29 PASS notices + ALL MANAGER-ROLE
//          CHECKS PASSED.
//        - reminders.sql: expects 17 PASS notices.
//        - deals-isolation.sql: needs fixtures AND the JWT user
//          00000000-0000-0000-0000-000000000001 as a member of both
//          workspaces (the file runs its fixture SELECTs as that
//          authenticated user, so RLS hides anything it is not a member
//          of). It raises on cross-workspace visibility; it emits no PASS
//          notices, so a run with no exception and no "Create two workspace
//          fixtures" early-return notice is a pass.
//
// Usage: bun scripts/ci-migrations.mjs   (also: bun run test:sql)
// Exit code 0 = everything passed; 1 = something failed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");
const TESTS = path.join(ROOT, "supabase", "tests");
const STUBS = fs.readFileSync(path.join(ROOT, "scripts", "pglite-stubs.sql"), "utf8");

let pass = 0;
let fail = 0;
const failed = [];
function ok(label, detail) {
  pass++;
  console.log(`PASS  ${label} :: ${detail ?? ""}`);
}
function bad(label, detail) {
  fail++;
  failed.push(label);
  console.log(`FAIL  ${label} :: ${detail ?? ""}`);
}

async function freshDb(keepTrigger) {
  const db = new PGlite();
  await db.waitReady;
  await db.exec(STUBS);
  const files = fs
    .readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  let nOk = 0;
  let firstError = null;
  for (const f of files) {
    try {
      await db.exec(fs.readFileSync(path.join(MIGRATIONS, f), "utf8"));
      nOk++;
    } catch (e) {
      console.log(`MIG FAIL ${f} :: ${e.message}`);
      firstError ??= e.message;
    }
  }
  console.log(`MIGRATION CHAIN: ${nOk}/${files.length}`);
  if (nOk === files.length) ok("migration-chain", `${nOk}/${files.length} apply`);
  else bad("migration-chain", `${nOk}/${files.length}, first error: ${firstError}`);
  if (!keepTrigger) {
    await db.exec(`DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;`);
  }
  return db;
}

async function runTestFile(db, file) {
  const sql = fs.readFileSync(path.join(TESTS, file), "utf8");
  const notices = [];
  let err = null;
  try {
    await db.exec(sql, { onNotice: (n) => notices.push(n.message) });
  } catch (e) {
    err = e.message;
  }
  const passes = notices.filter((m) => m.startsWith("PASS"));
  const earlyReturn = notices.some((m) => m.startsWith("Create two workspace fixtures"));
  console.log(
    `TEST ${file}: exception=${err ? JSON.stringify(err) : "none"} PASS-notices=${passes.length}`,
  );
  return { passes: passes.length, err, earlyReturn };
}

async function objectChecks(db) {
  const q = async (sql) => (await db.query(sql)).rows[0];
  const mgr = await q(
    `SELECT count(*)::int AS n FROM pg_enum WHERE enumtypid = 'public.workspace_role'::regtype AND enumlabel = 'manager'`,
  );
  if (mgr.n === 1) ok("object: workspace_role has manager", "pg_enum contains 'manager'");
  else bad("object: workspace_role has manager", `count=${mgr.n}`);
  for (const fn of ["capture_lead", "run_reminder_sweep", "escalate_overdue_follow_ups"]) {
    const r = await q(
      `SELECT count(*)::int AS n FROM pg_proc WHERE proname = '${fn}' AND pronamespace = 'public'::regnamespace`,
    );
    if (r.n >= 1) ok(`object: function ${fn} exists`, `${r.n} overload(s)`);
    else bad(`object: function ${fn} exists`, "not found");
  }
  const idx = await q(
    `SELECT indisunique AS u FROM pg_index WHERE indexrelid = 'public.deals_one_active_deal_per_unit_idx'::regclass`,
  );
  if (idx?.u === true) ok("object: deals partial unique index exists", "indisunique=true");
  else bad("object: deals partial unique index exists", "missing or not unique");
}

async function dealsFixtures(db) {
  const owner1 = "90000000-0000-0000-0000-000000000001";
  const owner2 = "90000000-0000-0000-0000-000000000002";
  const jwtUser = "00000000-0000-0000-0000-000000000001";
  const wsA = "91111111-1111-1111-1111-111111111111";
  const wsB = "92222222-2222-2222-2222-222222222222";
  const inst = "00000000-0000-0000-0000-000000000000";
  for (const [id, email] of [
    [owner1, "o@test.local"],
    [owner2, "o2@test.local"],
    [jwtUser, "jwtuser@test.local"],
  ]) {
    await db.query(
      `INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data) VALUES ($1,$2,'authenticated','authenticated',$3,'x',now(),now(),now(),'{}'::jsonb) ON CONFLICT (id) DO NOTHING`,
      [id, inst, email],
    );
  }
  await db.query(
    `INSERT INTO public.profiles (id, full_name, language) VALUES ($1,'O','en'),($2,'O2','en'),($3,'JWT User','en') ON CONFLICT (id) DO NOTHING`,
    [owner1, owner2, jwtUser],
  );
  await db.query(
    `INSERT INTO public.workspaces (id, name, created_by) VALUES ($1,'A',$2),($3,'B',$4) ON CONFLICT (id) DO NOTHING`,
    [wsA, owner1, wsB, owner2],
  );
  await db.query(
    `INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'owner'),($3,$4,'owner'),($1,$5,'agent'),($3,$5,'agent') ON CONFLICT (workspace_id, user_id) DO NOTHING`,
    [wsA, owner1, wsB, owner2, jwtUser],
  );
  await db.query(
    `INSERT INTO public.leads (workspace_id, full_name, phone, source, assigned_to) VALUES ($1,'L1','+201000000001','website',$2),($3,'L2','+201000000002','website',$4) ON CONFLICT DO NOTHING`,
    [wsA, owner1, wsB, jwtUser],
  );
}

let db = await freshDb(false);
await objectChecks(db);
let r = await runTestFile(db, "critical_fixes_anon.sql");
if (!r.err && r.passes === 30) ok("critical_fixes_anon.sql", "30/30 PASS notices");
else bad("critical_fixes_anon.sql", `passes=${r.passes} err=${r.err}`);
await db.close();

db = await freshDb(true); // billing-isolation needs the signup trigger
r = await runTestFile(db, "billing-isolation.sql");
if (!r.err) ok("billing-isolation.sql", "no exception (assertions inside the file passed)");
else bad("billing-isolation.sql", r.err);
await db.close();

db = await freshDb(false);
r = await runTestFile(db, "manager_role.sql");
if (!r.err && r.passes === 29) ok("manager_role.sql", "29/29 PASS notices");
else bad("manager_role.sql", `passes=${r.passes} err=${r.err}`);
await db.close();

db = await freshDb(false);
r = await runTestFile(db, "reminders.sql");
if (!r.err && r.passes === 17) ok("reminders.sql", "17/17 PASS notices");
else bad("reminders.sql", `passes=${r.passes} err=${r.err}`);
await db.close();

db = await freshDb(false);
await dealsFixtures(db);
r = await runTestFile(db, "deals-isolation.sql");
if (!r.err && !r.earlyReturn)
  ok("deals-isolation.sql", "no exception, fixtures exercised (no early return)");
else bad("deals-isolation.sql", `err=${r.err} earlyReturn=${r.earlyReturn}`);
await db.close();

console.log(`===== TOTAL: ${pass} passed, ${fail} failed =====`);
if (failed.length) console.log("FAILED: " + failed.join(" | "));
process.exit(fail ? 1 : 0);
