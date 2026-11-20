import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { billingDb } from "./client";
import {
  billingDisplayStatus,
  methods,
  type BillingAudit,
  type Company,
  type License,
  type Payment,
} from "./model";

const uuid = z.string().uuid();
const bucket = "payment-receipts";
const imageTypes = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
const manual = () => (process.env["PAYMENT_PROVIDER"] ?? "manual") === "manual";
// TODO Paymob: verify webhook signatures and the expected amount/currency, then call the
// same atomic confirmation operation using an idempotent provider reference.
function destinations() {
  return {
    instapay: process.env["PAYMENT_INSTAPAY"]?.trim() || "",
    vodafone_cash: process.env["PAYMENT_VODAFONE_CASH"]?.trim() || "",
    bank_transfer: process.env["PAYMENT_BANK_DETAILS"]?.trim() || "",
  };
}

async function isPlatformOwner(userId: string, token: unknown) {
  // Use immutable, server-configured Auth IDs, never tenant roles or editable metadata.
  return (
    token === "authenticated" &&
    (process.env["BILLING_OWNER_IDS"] ?? "")
      .split(",")
      .map((id) => id.trim().toLowerCase())
      .includes(userId.toLowerCase())
  );
}

export const billingSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => ({
    manual: manual(),
    destinations: destinations(),
    platformOwner: await isPlatformOwner(context.userId, context.claims.role),
  }));

const paymentInput = z.object({
  company: uuid,
  plan: z.enum(["starter", "pro", "business"]),
  term: z.enum(["monthly", "annual"]),
  method: z.enum(methods),
  reference: z.string().trim().min(3).max(120),
});

export const submitPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((raw: unknown) => {
    if (!(raw instanceof FormData)) throw new Error("Invalid payment form");
    paymentInput.parse(Object.fromEntries(raw));
    return raw;
  })
  .handler(async ({ data, context }) => {
    const input = paymentInput.parse(Object.fromEntries(data));
    if (!manual() || !destinations()[input.method]) throw new Error("Payment method unavailable");
    const { data: owner, error: roleError } = await context.supabase.rpc("has_workspace_role", {
      _workspace_id: input.company,
      _role: "owner",
    });
    if (roleError || owner !== true) throw new Error("Access denied");
    const file = data.get("receipt");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const id = crypto.randomUUID();
    const storage = supabaseAdmin.storage.from(bucket);
    let path: string | null = null;
    if (file instanceof File && file.size) {
      const ext = imageTypes[file.type as keyof typeof imageTypes];
      if (!ext || file.size > 5 * 1024 * 1024) throw new Error("Unsupported receipt");
      const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
      const signature = (offset: number, value: number[]) =>
        value.every((b, i) => bytes[i + offset] === b);
      if (
        !(ext === "jpg"
          ? signature(0, [255, 216, 255])
          : ext === "png"
            ? signature(0, [137, 80, 78, 71, 13, 10, 26, 10])
            : signature(0, [82, 73, 70, 70]) && signature(8, [87, 69, 66, 80]))
      )
        throw new Error("Invalid receipt");
      path = `${input.company}/${id}.${ext}`;
      const { error } = await storage.upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw new Error("Could not upload receipt");
    }
    const { error } = await billingDb(supabaseAdmin).from("payments").insert({
      id,
      company_id: input.company,
      plan: input.plan,
      term: input.term,
      method: input.method,
      transaction_ref: input.reference,
      screenshot_url: path,
    });
    if (error) {
      if (path) await storage.remove([path]);
      return { status: error.code === "23505" ? "duplicate" : "failed" } as const;
    }
    return { status: "saved" } as const;
  });

const action = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("create"),
      name: z.string().trim().min(1).max(120),
      email: z.string().trim().email().max(255),
    }),
    z.object({ kind: z.literal("license"), id: uuid, devices: z.number().int().min(1).max(20) }),
    z.object({
      kind: z.enum(["revoke", "confirm", "reject", "suspend", "reactivate", "receipt"]),
      id: uuid,
    }),
    z.object({
      kind: z.literal("extend"),
      id: uuid,
      months: z.union([z.literal(1), z.literal(3), z.literal(12)]),
    }),
  ])
  .and(z.object({ note: z.string().trim().max(500).optional() }));
export type BillingAction = z.input<typeof action>;

export const listBilling = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((raw: unknown) => z.number().int().min(0).max(100000).parse(raw))
  .handler(async ({ data: page, context }) => {
    if (!(await isPlatformOwner(context.userId, context.claims.role)))
      throw new Error("Access denied");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = billingDb(supabaseAdmin);
    const [companies, payments] = await Promise.all([
      db
        .from("companies")
        .select(
          "id,name,owner_email,subscriptions(plan,status,expires_at,paid_needs_reactivation)",
          { count: "exact" },
        )
        .order("created_at", { ascending: false })
        .order("id")
        .range(page * 25, page * 25 + 24),
      db
        .from("payments")
        .select("*", { count: "exact" })
        .eq("status", "pending")
        .order("created_at")
        .order("id")
        .range(page * 25, page * 25 + 24),
    ]);
    if (companies.error || payments.error) throw new Error("Could not load billing");
    const ids = companies.data.map((company) => company.id);
    const keys = ids.length
      ? await db
          .from("license_keys")
          .select("id,company_id,key_suffix,max_devices,status")
          .eq("status", "active")
          .in("company_id", ids)
      : { data: [], error: null };
    if (keys.error) throw new Error("Could not load licenses");
    const now = Date.now();
    return {
      companies: (companies.data as unknown as Omit<Company, "displayStatus">[]).map((company) => ({
        ...company,
        displayStatus: company.subscriptions
          ? billingDisplayStatus(company.subscriptions, now)
          : null,
      })),
      payments: payments.data as Payment[],
      licenses: keys.data as License[],
      total: Math.max(companies.count ?? 0, payments.count ?? 0),
    };
  });

const auditInput = z.object({
  company: uuid.optional(),
  page: z.number().int().min(0).max(100000),
});
export const listBillingAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((raw: z.input<typeof auditInput>) => auditInput.parse(raw))
  .handler(async ({ data, context }) => {
    if (!(await isPlatformOwner(context.userId, context.claims.role)))
      throw new Error("Access denied");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const query = billingDb(supabaseAdmin)
      .from("billing_audit")
      .select("id,created_at,admin_id,action,company_id,reason,old_status,new_status", {
        count: "exact",
      });
    if (data.company) query.eq("company_id", data.company);
    const rows = await query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(data.page * 25, data.page * 25 + 24);
    if (rows.error) throw new Error("Could not load billing audit");
    return { entries: rows.data as BillingAudit[], total: rows.count ?? 0 };
  });

export const manageBilling = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((raw: BillingAction) => action.parse(raw))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ url?: string; code?: string; paidNeedsReactivation?: boolean }> => {
      if (!(await isPlatformOwner(context.userId, context.claims.role)))
        throw new Error("Access denied");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const db = billingDb(supabaseAdmin);
      if (data.kind === "create") {
        // The existing Auth signup trigger creates the workspace, owner and trial.
        const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(
          data.email.toLowerCase(),
          {
            data: { agency_name: data.name },
          },
        );
        if (error) throw new Error("Could not invite the company owner");
      } else if (data.kind === "license") {
        const { createLicense } = await import("./license.server");
        const { setResponseHeader } = await import("@tanstack/react-start/server");
        setResponseHeader("Cache-Control", "no-store");
        const { code, digest, suffix } = createLicense();
        const { error } = await db.rpc("billing_admin_action", {
          action: "license_issue",
          target: data.id,
          actor: context.userId,
          note: data.note ?? null,
          digest_hex: digest,
          suffix,
          devices: data.devices,
        });
        if (error) throw new Error("Could not issue license");
        return { code };
      } else if (data.kind === "receipt") {
        const { data: payment, error } = await db
          .from("payments")
          .select("screenshot_url")
          .eq("id", data.id)
          .single();
        if (error || !payment.screenshot_url) throw new Error("Receipt unavailable");
        const signed = await supabaseAdmin.storage
          .from(bucket)
          .createSignedUrl(payment.screenshot_url, 60);
        if (signed.error) throw new Error("Receipt unavailable");
        return { url: signed.data.signedUrl };
      } else {
        const { data: paidNeedsReactivation, error } = await db.rpc("billing_admin_action", {
          action: data.kind === "revoke" ? "license_revoke" : data.kind,
          target: data.id,
          actor: context.userId,
          note: data.note ?? null,
          months: data.kind === "extend" ? data.months : null,
        });
        if (error) throw new Error("Billing action failed");
        return { paidNeedsReactivation: data.kind === "confirm" && paidNeedsReactivation === true };
      }
      return {};
    },
  );
