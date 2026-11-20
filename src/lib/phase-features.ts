export type LeadScoreBand = "hot" | "warm" | "cold";
export function scoreLead(input: {
  budget?: number | null;
  timelineDays?: number | null;
  responseMinutes?: number | null;
  interactions?: number;
}) {
  let score = 0;
  if (input.budget != null && input.budget > 0) score += 30;
  if (input.timelineDays != null)
    score += input.timelineDays <= 30 ? 25 : input.timelineDays <= 90 ? 15 : 5;
  if (input.responseMinutes != null)
    score += input.responseMinutes <= 5 ? 25 : input.responseMinutes <= 30 ? 10 : 0;
  score += Math.min(20, Math.max(0, input.interactions ?? 0) * 5);
  score = Math.min(100, score);
  return { score, band: (score >= 70 ? "hot" : score >= 40 ? "warm" : "cold") as LeadScoreBand };
}
export function matchUnit(
  lead: { budget?: number | null; preferredArea?: string | null; bedrooms?: number | null },
  unit: { price?: number | null; area?: string | null; bedrooms?: number | null },
) {
  let score = 0;
  if (lead.budget != null && unit.price != null)
    score +=
      unit.price <= lead.budget
        ? 40
        : Math.max(0, 40 - Math.round(((unit.price - lead.budget) / lead.budget) * 40));
  if (
    lead.preferredArea &&
    unit.area &&
    lead.preferredArea.trim().toLowerCase() === unit.area.trim().toLowerCase()
  )
    score += 35;
  if (lead.bedrooms != null && lead.bedrooms === unit.bedrooms) score += 25;
  return Math.max(0, Math.min(100, score));
}
export function monthlyInstallment(price: number, downPayment: number, years: number) {
  if (
    ![price, downPayment, years].every(Number.isFinite) ||
    price < 0 ||
    downPayment < 0 ||
    years <= 0 ||
    downPayment > price
  )
    throw new Error("invalid_installment");
  return Math.round(((price - downPayment) / (years * 12)) * 100) / 100;
}
export function revivalCandidates<
  T extends { id: string; updated_at: string; archived_at: string | null },
>(leads: T[], now = new Date(), days = 30): T[] {
  const cutoff = now.getTime() - days * 86400000;
  return leads.filter((lead) => !lead.archived_at && new Date(lead.updated_at).getTime() < cutoff);
}

/** Full days since a timestamp (negative when in the future). */
export function daysIdle(updatedAt: string, now = new Date()) {
  return Math.floor((now.getTime() - new Date(updatedAt).getTime()) / 86400000);
}

/**
 * Build the scoreLead() input from a lead row. Budget uses the max (falling
 * back to the min); timeline is the days until the next follow-up (0 when
 * overdue, null when none is scheduled); first response comes from the
 * lead-capture columns; interactions counts follow-ups + timeline events.
 */
export function deriveLeadScoreInput(
  lead: {
    budget_min?: number | null;
    budget_max?: number | null;
    next_follow_up_at?: string | null;
    first_response_minutes?: number | null;
  },
  interactions = 0,
  now = new Date(),
) {
  const timelineDays =
    lead.next_follow_up_at == null
      ? null
      : Math.max(
          0,
          Math.ceil((new Date(lead.next_follow_up_at).getTime() - now.getTime()) / 86400000),
        );
  return {
    budget: lead.budget_max ?? lead.budget_min ?? null,
    timelineDays,
    responseMinutes: lead.first_response_minutes ?? null,
    interactions,
  };
}

export type LeadSearchCriteria = {
  q: string;
  status: string;
  source: string;
  assignee: string;
  view: string;
};

/** Keep only the non-empty filters so saved criteria stay small and stable. */
export function buildSavedSearchCriteria(filters: LeadSearchCriteria) {
  const criteria: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (typeof value === "string" && value.trim() !== "") criteria[key] = value.trim();
  }
  return criteria;
}

/** Validate a saved_searches criteria blob back into lead-list filters. */
export function parseSavedSearchCriteria(raw: unknown): LeadSearchCriteria {
  const base: LeadSearchCriteria = { q: "", status: "", source: "", assignee: "", view: "active" };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(base) as Array<keyof LeadSearchCriteria>) {
    if (typeof record[key] === "string") base[key] = record[key] as string;
  }
  if (base.view !== "active" && base.view !== "archived") base.view = "active";
  return base;
}

/** Days until a rental ends (negative when already ended, null when open-ended). */
export function rentalDaysRemaining(endsOn: string | null | undefined, now = new Date()) {
  if (!endsOn) return null;
  const end = new Date(`${endsOn}T00:00:00`);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((end.getTime() - today.getTime()) / 86400000);
}

/** True when an active rental ends within `withinDays` (or already ended). */
export function isRentalEndingSoon(
  endsOn: string | null | undefined,
  status: string,
  now = new Date(),
  withinDays = 30,
) {
  if (status !== "active") return false;
  const remaining = rentalDaysRemaining(endsOn, now);
  return remaining != null && remaining <= withinDays;
}
