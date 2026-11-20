// @vitest-environment node
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createLicense, LICENSE_RANDOM_BYTES } from "./license.server";
import { billingDisplayStatus } from "./model";

const db = new PGlite();
const user = "10000000-0000-0000-0000-000000000099";
const device = "40000000-0000-0000-0000-000000000099";
const legacy = "LEAD-ABCD-0019";
let company: string;

beforeAll(async () => {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE SCHEMA storage;
    GRANT USAGE ON SCHEMA auth TO public;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb,email_confirmed_at timestamptz);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role' $$;
    CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    CREATE PUBLICATION supabase_realtime;
  `);
  const directory = new URL("../../../supabase/migrations/", import.meta.url);
  for (const file of (await readdir(directory)).filter((f) => f.endsWith(".sql")).sort()) {
    if (file === "20261120000000_billing_security_fix.sql") {
      await db.query("INSERT INTO auth.users(id,email) VALUES ($1,'legacy-license@example.test')", [
        user,
      ]);
      const result = await db.query<{ id: string }>(
        "SELECT id FROM public.companies WHERE owner_email='legacy-license@example.test'",
      );
      company = result.rows[0]!.id;
      await db.query(
        "INSERT INTO public.license_keys(company_id,key,max_devices) VALUES ($1,$2,1000)",
        [company, legacy],
      );
    }
    await db.exec(await readFile(new URL(file, directory), "utf8"));
  }
}, 20_000);

afterAll(() => db.close());

it("generates seven groups from 140 unbiased bits and produces a SHA-256 digest", () => {
  const keys = Array.from({ length: 128 }, createLicense);
  expect(LICENSE_RANDOM_BYTES * 5).toBeGreaterThanOrEqual(128);
  expect(new Set(keys.map((key) => key.code)).size).toBe(keys.length);
  for (const { code, digest, suffix } of keys) {
    expect(code).toMatch(/^LEAD(?:-[A-HJ-NP-Z2-9]{4}){7}$/);
    expect(digest).toBe(createHash("sha256").update(code).digest("hex"));
    expect(suffix).toBe(code.slice(-4));
  }
});

it("migrates legacy keys without retaining plaintext and applies the plan cap", async () => {
  const result = await db.query(
    "SELECT encode(key_hash,'hex') AS hash,key_suffix,max_devices FROM public.license_keys WHERE company_id=$1",
    [company],
  );
  expect(result.rows).toEqual([
    {
      hash: createHash("sha256").update(legacy).digest("hex"),
      key_suffix: "0019",
      max_devices: 3,
    },
  ]);
  await expect(db.query("SELECT key FROM public.license_keys")).rejects.toThrow(/does not exist/);
});

it("locks the device and account on the fifth failure across distinct guesses, then permits legacy activation after expiry", async () => {
  const activate = async (code: string, installation = device) =>
    (
      await db.query<{ allowed: boolean }>("SELECT public.billing_activate($1,$2,$3) AS allowed", [
        company,
        code,
        installation,
      ])
    ).rows[0]?.allowed;
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("SET ROLE authenticated");
  try {
    for (let i = 0; i < 4; i++) expect(await activate("invalid-key-" + i)).toBe(false);
    await db.exec("RESET ROLE");
    expect(
      (
        await db.query(
          "SELECT failed_count,locked_until FROM public.billing_activation_attempts ORDER BY scope",
        )
      ).rows,
    ).toEqual([
      { failed_count: 4, locked_until: null },
      { failed_count: 4, locked_until: null },
    ]);
    await db.exec("SET ROLE authenticated");
    expect(await activate("invalid-key-5")).toBe(false);
    expect(await activate(legacy)).toBe(false);
    expect(await activate(legacy, "40000000-0000-0000-0000-000000000098")).toBe(false);
    await db.exec("RESET ROLE");
    expect(
      (
        await db.query(
          "SELECT count(*)::int AS count FROM public.billing_activation_attempts WHERE failed_count=5 AND locked_until=last_attempt+interval '15 minutes'",
        )
      ).rows,
    ).toEqual([{ count: 2 }]);
    await db.exec(
      "UPDATE public.billing_activation_attempts SET last_attempt=now()-interval '16 minutes', locked_until=now()-interval '1 minute'",
    );
    await db.exec("SET ROLE authenticated");
    expect(await activate(legacy)).toBe(true);
  } finally {
    await db.exec("RESET ROLE");
    await db.query("SELECT set_config('request.jwt.claim.sub','',false)");
  }
});

it("records admin actions atomically and preserves suspension after payment", async () => {
  const sql = await readFile(
    new URL("../../../supabase/tests/billing-isolation.sql", import.meta.url),
    "utf8",
  );
  await expect(db.exec(sql)).resolves.toBeDefined();
});

it("derives expiry and distinguishes a payment awaiting reactivation", () => {
  const subscription = {
    plan: "starter",
    status: "active",
    expires_at: "2026-11-20T00:00:00Z",
    paid_needs_reactivation: false,
  } as const;
  const now = Date.parse(subscription.expires_at);
  expect(billingDisplayStatus(subscription, now - 1)).toBe("active");
  expect(billingDisplayStatus(subscription, now)).toBe("expired");
  expect(billingDisplayStatus({ ...subscription, status: "suspended" }, now)).toBe("suspended");
  expect(
    billingDisplayStatus(
      { ...subscription, status: "suspended", paid_needs_reactivation: true },
      now,
    ),
  ).toBe("paid_needs_reactivation");
});
