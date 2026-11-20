import type { Database } from "@/integrations/supabase/types";
import type { DictKey } from "./i18n-dict";

export type Lead = Database["public"]["Tables"]["leads"]["Row"];
export type LeadInsert = Database["public"]["Tables"]["leads"]["Insert"];
export type FollowUp = Database["public"]["Tables"]["follow_ups"]["Row"];
export type LeadStatus = Database["public"]["Enums"]["lead_status"];
export type LeadSource = Database["public"]["Enums"]["lead_source"];
export type WorkspaceRole = Database["public"]["Enums"]["workspace_role"];

export const LEAD_STATUSES: LeadStatus[] = [
  "new",
  "contacted",
  "qualified",
  "meeting",
  "negotiation",
  "won",
  "lost",
];
export const LEAD_SOURCES: LeadSource[] = [
  "facebook",
  "instagram",
  "whatsapp",
  "referral",
  "website",
  "other",
];

export const statusKey = (s: LeadStatus) => `status_${s}` as DictKey;
export const sourceKey = (s: LeadSource) => `source_${s}` as DictKey;

/** Tailwind classes per status — all backed by design tokens in styles.css. */
export const STATUS_STYLES: Record<LeadStatus, { badge: string; dot: string; column: string }> = {
  new: {
    badge: "bg-status-new-soft text-status-new",
    dot: "bg-status-new",
    column: "border-t-status-new",
  },
  contacted: {
    badge: "bg-status-contacted-soft text-status-contacted",
    dot: "bg-status-contacted",
    column: "border-t-status-contacted",
  },
  qualified: {
    badge: "bg-status-qualified-soft text-status-qualified",
    dot: "bg-status-qualified",
    column: "border-t-status-qualified",
  },
  meeting: {
    badge: "bg-status-meeting-soft text-status-meeting",
    dot: "bg-status-meeting",
    column: "border-t-status-meeting",
  },
  negotiation: {
    badge: "bg-status-negotiation-soft text-status-negotiation",
    dot: "bg-status-negotiation",
    column: "border-t-status-negotiation",
  },
  won: {
    badge: "bg-status-won-soft text-status-won",
    dot: "bg-status-won",
    column: "border-t-status-won",
  },
  lost: {
    badge: "bg-status-lost-soft text-status-lost",
    dot: "bg-status-lost",
    column: "border-t-status-lost",
  },
};

export function formatMoney(value: number | null | undefined, locale: string): string {
  if (value == null) return "";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EGP",
    notation: value >= 100000 ? "compact" : "standard",
    maximumFractionDigits: value >= 100000 ? 1 : 0,
  }).format(value);
}

export function formatBudget(min: number | null, max: number | null, locale: string): string {
  if (min == null && max == null) return "";
  if (min != null && max != null)
    return `${formatMoney(min, locale)} – ${formatMoney(max, locale)}`;
  if (min != null) return `≥ ${formatMoney(min, locale)}`;
  return `≤ ${formatMoney(max, locale)}`;
}

export function formatDateTime(iso: string | null | undefined, locale: string): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function formatDate(
  iso: string | Date | null | undefined,
  locale: string,
  withYear = true,
): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  }).format(typeof iso === "string" ? new Date(iso) : iso);
}

/** <input type="datetime-local"> helpers (browser local time). */
export function toLocalInput(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function dayBounds(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

export type DueBucket = "overdue" | "today" | "upcoming";
export function dueBucket(dueIso: string, now = new Date()): DueBucket {
  const { start, end } = dayBounds(now);
  const due = new Date(dueIso);
  if (due < start) return "overdue";
  if (due < end) return "today";
  return "upcoming";
}

/** Parses a user-typed amount (Latin or Arabic digits, commas). Returns undefined for blank, NaN for invalid. */
export function parseAmount(input: string | null | undefined): number | undefined {
  if (input == null) return undefined;
  const s = String(input)
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[,\s\u066C]/g, "")
    .replace(/egp|ج\.?م\.?|جنيه/gi, "")
    .trim();
  if (!s) return undefined;
  if (!/^\d+(\.\d+)?$/.test(s)) return Number.NaN;
  return Math.round(Number(s));
}

export function sanitizeSearch(q: string): string {
  // PostgREST .or() syntax uses commas/parentheses; strip them and wildcard chars.
  return q
    .replace(/[,()%*\\]/g, " ")
    .trim()
    .slice(0, 80);
}

export function friendlyError(err: unknown): string | null {
  if (!err) return null;
  const msg =
    typeof err === "object" && err && "message" in err
      ? String((err as { message: unknown }).message)
      : String(err);
  return msg;
}
