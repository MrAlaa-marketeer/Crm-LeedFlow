import { normalizePhone } from "./phone";

export function validateCapture(input: {
  name: string;
  phone: string;
  budget: string;
  preferredArea: string;
  project: string;
  honeypot: string;
}) {
  const errors: string[] = [];
  if (!input.name.trim()) errors.push("nameRequired");
  const phone = normalizePhone(input.phone);
  if (!phone.ok) errors.push("phoneInvalid");
  const budget = input.budget.trim() ? Number(input.budget.replace(/[, ]/g, "")) : null;
  if (budget != null && (!Number.isFinite(budget) || budget < 0)) errors.push("budgetInvalid");
  if (input.honeypot.trim()) errors.push("spam");
  return { errors, phone: phone.ok ? phone.e164 : null, budget };
}

export function firstResponseMinutes(
  createdAt: string | Date,
  respondedAt?: string | Date | null,
  now = new Date(),
) {
  const end = respondedAt ? new Date(respondedAt) : now;
  const start = new Date(createdAt);
  return Math.max(0, Math.round(((end.getTime() - start.getTime()) / 60000) * 100) / 100);
}

export function averageResponseMinutes(values: Array<number | null | undefined>) {
  const valid = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  return valid.length
    ? Math.round((valid.reduce((sum, value) => sum + value, 0) / valid.length) * 100) / 100
    : null;
}

export function nextRoundRobinAgent(agentIds: readonly string[], lastAssigned: string | null) {
  if (!agentIds.length) return null;
  const current = lastAssigned ? agentIds.indexOf(lastAssigned) : -1;
  return agentIds[(current + 1) % agentIds.length] ?? null;
}
