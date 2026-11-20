import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { createClient } from "@supabase/supabase-js";

const envFile = new URL("../.env", import.meta.url);
const project = "https://aqbyzhldccymcumftayv.supabase.co";
const email = "admin@leadflow.test";
const uidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const ownerLine = /^[\t ]*(?:export[\t ]+)?BILLING_OWNER_IDS[\t ]*=[^\r\n]*/gm;
let stage = "Read project .env";

function client(key) {
  return createClient(project, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (key.startsWith("sb_") && headers.get("Authorization") === "Bearer " + key) {
          headers.delete("Authorization");
        }
        return fetch(input, { ...init, headers, redirect: "error" });
      },
    },
  });
}

async function run() {
  const original = await readFile(envFile, "utf8");
  const config = parseEnv(original);
  const serviceKey = config.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceKey || serviceKey.startsWith("<")) {
    console.error(
      "Add SUPABASE_SERVICE_ROLE_KEY to .env from Supabase Dashboard > Settings > API > Secret keys.",
    );
    return false;
  }
  const publishableKey = config.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (
    config.VITE_SUPABASE_URL?.trim() !== project ||
    !publishableKey ||
    publishableKey.startsWith("<")
  ) {
    console.error(
      "Set VITE_SUPABASE_URL to the intended test project and VITE_SUPABASE_PUBLISHABLE_KEY in .env.",
    );
    return false;
  }
  const existingLines = [...original.matchAll(ownerLine)];
  if (
    existingLines.length > 1 ||
    (config.BILLING_OWNER_IDS !== undefined && existingLines.length !== 1)
  ) {
    console.error(
      "Use a single-line BILLING_OWNER_IDS assignment in .env before running this script.",
    );
    return false;
  }
  if (!process.argv.includes("--confirm-disposable")) {
    console.error(
      "Confirm that the target has no real customer data, then pass --confirm-disposable.",
    );
    return false;
  }

  const admin = client(serviceKey);
  stage = "Look up test user";
  let user;
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) return failure(error);
    user = data.users.find((entry) => entry.email?.toLowerCase() === email);
    if (user || !data.nextPage) break;
    if (data.nextPage <= page) throw new Error();
    page = data.nextPage;
  }

  const reused = Boolean(user);
  const rotate = reused && process.argv.includes("--rotate-existing-test-password");
  let password = reused && !rotate ? config.LEADFLOW_TEST_ADMIN_PASSWORD : undefined;
  let generated = false;
  if (!reused || rotate) {
    password = randomBytes(24).toString("base64url") + "aA9!";
    generated = true;
    stage = rotate ? "Rotate existing test user password" : "Create test user";
    const fields = { password, email_confirm: true, user_metadata: { name: "LeadFlow Admin" } };
    const result = user
      ? await admin.auth.admin.updateUserById(user.id, fields)
      : await admin.auth.admin.createUser({ email, ...fields });
    if (result.error) return failure(result.error);
    user = result.data.user;
  }
  if (!user || !uidPattern.test(user.id)) throw new Error();

  try {
    if (password) {
      stage = "Verify publishable-key sign-in";
      const publicClient = client(publishableKey);
      const { data, error } = await publicClient.auth.signInWithPassword({ email, password });
      if (error || data.user?.id !== user.id) return failure(error);
      await publicClient.auth.signOut({ scope: "local" });
    }
    stage = "Update BILLING_OWNER_IDS in .env";
    const current = await readFile(envFile, "utf8");
    if (current !== original) {
      console.error(
        "The .env file changed while the script was running. No local changes were written.",
      );
      return false;
    }
    const newline = original.match(/\r\n|\n|\r/)?.[0] ?? "\n";
    const assignment = "BILLING_OWNER_IDS=" + user.id;
    const updated = existingLines.length
      ? original.replace(ownerLine, assignment)
      : original + (original && !/[\r\n]$/.test(original) ? newline : "") + assignment + newline;
    const parsed = parseEnv(updated);
    if (
      parsed.BILLING_OWNER_IDS !== user.id ||
      Object.keys({ ...config, ...parsed }).some(
        (key) => key !== "BILLING_OWNER_IDS" && parsed[key] !== config[key],
      )
    ) {
      console.error("Could not safely replace BILLING_OWNER_IDS. No local changes were written.");
      return false;
    }
    if (updated !== original) await writeFile(envFile, updated, "utf8");
    console.log(
      JSON.stringify({
        account: reused ? "reused" : "created",
        email,
        ...(generated ? { password } : {}),
        uid: user.id,
        verified: Boolean(password),
        billingOwnerIdsUpdated: true,
      }),
    );
    return true;
  } finally {
    if (generated && stage !== "Update BILLING_OWNER_IDS in .env") {
      console.error(
        "A password may have been set remotely. If verification failed, rerun with --rotate-existing-test-password after fixing the issue.",
      );
    }
  }
}

function failure(error) {
  const status = Number.isInteger(error?.status) ? " (HTTP " + error.status + ")" : "";
  console.error(stage + " failed" + status + ".");
  return false;
}

try {
  if (!(await run())) process.exitCode = 1;
} catch {
  failure();
  process.exitCode = 1;
}
