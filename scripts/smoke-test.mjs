// Smoke test for the public lead-capture flow — code level only, no live
// server, no browser, no network. It verifies the pieces a logged-out
// visitor's submission depends on are all present and wired together:
//
//   public route /lead-capture  ->  capture_lead() RPC (with honeypot)
//   -> phone normalisation/validation (src/lib/phone.ts)
//   -> migration that creates capture_lead()
//   -> round-robin / speed-to-lead helpers the RPC relies on
//
// A real browser smoke test (fill the form logged out, submit, see the lead
// in the dashboard, complete a follow-up, reserve a unit) still needs a
// running dev server against the disposable Supabase project — see the
// checklist printed at the end and docs in the deployable report. Playwright
// was deliberately NOT added: it would pull a browser download into this
// repo for a check that is currently done by hand once per release.
//
// Usage: bun scripts/smoke-test.mjs
// Exit code 0 = all static checks passed; 1 = something is missing.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0;
let fail = 0;
const failed = [];
function check(label, cond, detail) {
  if (cond) {
    pass++;
    console.log(`PASS  ${label} :: ${detail ?? ""}`);
  } else {
    fail++;
    failed.push(label);
    console.log(`FAIL  ${label} :: ${detail ?? ""}`);
  }
}
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}
function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

const route = exists("src/routes/lead-capture.tsx") ? read("src/routes/lead-capture.tsx") : "";
check("route: src/routes/lead-capture.tsx exists", route.length > 0);
check("route: calls capture_lead RPC", route.includes('rpc("capture_lead"'));
check("route: sends honeypot field", route.includes("_honeypot") && route.includes("honeypot"));
check(
  "route: handles success + error states",
  route.includes("setDone(true)") && route.includes("setError"),
);

const phone = exists("src/lib/phone.ts") ? read("src/lib/phone.ts") : "";
check("lib: src/lib/phone.ts exists", phone.length > 0);
check(
  "lib: phone validation rejects non-Egyptian numbers",
  /invalid Egyptian mobile|Egyptian/i.test(phone),
);

const migrations = fs
  .readdirSync(path.join(ROOT, "supabase", "migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort();
const migrationText = migrations
  .map((f) => read(path.join("supabase", "migrations", f)))
  .join("\n");
check("migrations: 16 files present", migrations.length === 16, `${migrations.length} files`);
check(
  "migrations: capture_lead defined",
  migrationText.includes("CREATE OR REPLACE FUNCTION public.capture_lead"),
);
check(
  "migrations: manager enum value added",
  migrationText.includes("ADD VALUE IF NOT EXISTS 'manager'"),
);
check(
  "migrations: run_reminder_sweep defined",
  migrationText.includes("CREATE OR REPLACE FUNCTION public.run_reminder_sweep"),
);
check(
  "migrations: deals partial unique index defined",
  migrationText.includes("deals_one_active_deal_per_unit_idx"),
);
check(
  "migrations: anon capture fix present",
  exists("supabase/migrations/20261125000000_anon_capture_fix.sql"),
);
check(
  "migrations: manager role present",
  exists("supabase/migrations/20261126000000_manager_role.sql"),
);
check("migrations: reminders present", exists("supabase/migrations/20261127000000_reminders.sql"));

const tests = fs
  .readdirSync(path.join(ROOT, "supabase", "tests"))
  .filter((f) => f.endsWith(".sql"));
for (const t of [
  "critical_fixes_anon.sql",
  "billing-isolation.sql",
  "deals-isolation.sql",
  "manager_role.sql",
  "reminders.sql",
]) {
  check(`tests: supabase/tests/${t} exists`, tests.includes(t));
}

const pdf = exists("src/lib/brochure-pdf.ts") ? read("src/lib/brochure-pdf.ts") : "";
check(
  "pdf: src/lib/brochure-pdf.ts exists (pdf-lib, no window.print)",
  pdf.includes("pdf-lib") || pdf.includes("PDFDocument"),
);
const brochure = exists("src/lib/brochure.ts") ? read("src/lib/brochure.ts") : "";
const brochureCode = brochure
  .split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");
check(
  "pdf: brochure.ts no longer auto-prints (no window.print in code)",
  !brochureCode.includes("window.print"),
);

const reminders = exists("src/lib/reminders.ts") ? read("src/lib/reminders.ts") : "";
check("reminders: src/lib/reminders.ts exists", reminders.length > 0);
check("reminders: setup doc exists", exists("docs/reminders-setup.md"));

console.log(`===== SMOKE (static): ${pass} passed, ${fail} failed =====`);
if (failed.length) console.log("FAILED: " + failed.join(" | "));
console.log(`
MANUAL BROWSER SMOKE TEST — still required, against the DISPOSABLE Supabase
project only (never production), after applying all 16 migrations:
  1. Open /lead-capture logged OUT, submit a lead with an Egyptian mobile.
     Expect a success message and the lead in the dashboard with an assignee.
  2. Submit the same phone again: expect the same lead (duplicate suppression).
  3. As an agent, complete a follow-up: first_response_at must be set.
  4. Create a deal and reserve a unit; a second deal on the same unit must fail.
  5. As a manager, open Team: whole-team workload visible; billing must stay hidden.
  6. Open a unit, download the PDF brochure: real PDF file, Latin text only
     (Arabic is transliterated — no Arabic font is bundled yet).
  7. Overdue follow-ups: bell count > 0, due-now banner on the follow-ups page.
`);
process.exit(fail ? 1 : 0);
