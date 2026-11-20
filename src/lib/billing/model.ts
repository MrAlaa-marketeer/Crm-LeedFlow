export const plans = {
  starter: { name: "Starter", monthly: 699, users: 3 },
  pro: { name: "Pro", monthly: 1499, users: 10 },
  business: { name: "Business", monthly: 2999, users: null },
} as const;
export type Plan = keyof typeof plans;
export const methods = ["instapay", "vodafone_cash", "bank_transfer"] as const;
export type Method = (typeof methods)[number];
export type Term = "monthly" | "annual";
export type BillingStatus = "trial" | "active" | "expired" | "suspended";
export const deviceCaps = { starter: 3, pro: 10, business: 20 } as const;
export type BillingDisplayStatus = BillingStatus | "paid_needs_reactivation";
export function billingDisplayStatus(
  subscription: NonNullable<Company["subscriptions"]>,
  now: number,
): BillingDisplayStatus {
  if (subscription.status === "suspended") {
    return subscription.paid_needs_reactivation ? "paid_needs_reactivation" : "suspended";
  }
  return Date.parse(subscription.expires_at) <= now ? "expired" : subscription.status;
}
export const price = (plan: Plan, term: Term) => plans[plan].monthly * (term === "annual" ? 10 : 1);
export type Access = {
  companyId: string;
  plan: Plan;
  maxUsers: number | null;
  status: BillingStatus;
  expiresAt: string;
  allowed: boolean;
  owner: boolean;
  needsLicense: boolean;
};
export type Payment = {
  id: string;
  company_id: string;
  plan: Plan;
  term: Term;
  amount_egp: number;
  method: Method;
  transaction_ref: string;
  screenshot_url: string | null;
  status: "pending" | "confirmed" | "rejected";
  created_at: string;
};
export type Company = {
  id: string;
  name: string;
  owner_email: string;
  subscriptions: {
    plan: Plan;
    status: BillingStatus;
    expires_at: string;
    paid_needs_reactivation: boolean;
  } | null;
  displayStatus: BillingDisplayStatus | null;
};
export type License = {
  id: string;
  company_id: string;
  key_suffix: string;
  max_devices: number;
  status: "active" | "revoked";
};
export type BillingAudit = {
  id: string;
  created_at: string;
  admin_id: string;
  action: string;
  company_id: string;
  reason: string;
  old_status: string | null;
  new_status: string;
};
