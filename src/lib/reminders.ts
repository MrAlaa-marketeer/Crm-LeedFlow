/**
 * In-app reminder classification (Module D).
 *
 * Pure functions only — no Supabase, no I/O — so the same rules can be unit
 * tested here and mirrored in SQL (see
 * supabase/migrations/20261127000000_reminders.sql). The SQL functions are
 * the source of truth for persisted escalation; these helpers drive the
 * in-app bell, the due-now banner and the escalation list.
 *
 * Rules:
 * - A follow-up is "overdue" when due_at is strictly before now.
 * - Otherwise it is "due_soon" when due_at falls within
 *   REMINDER_DUE_SOON_HOURS of now, else "upcoming".
 * - A completed follow-up is "completed" whatever its due date was.
 * - A follow-up is escalated when it has been overdue for at least
 *   REMINDER_ESCALATION_HOURS (24h by default). Escalation never sends
 *   email/WhatsApp; it only surfaces the item to workspace owners in-app
 *   (automation page) and, once the pg_cron sweep is enabled, writes a
 *   `follow_up.escalated` row into in_app_notifications.
 */

export const REMINDER_DUE_SOON_HOURS = 24;
export const REMINDER_ESCALATION_HOURS = 24;

export type ReminderStatus = "overdue" | "due_soon" | "upcoming" | "completed";

export interface ReminderItem {
  id: string;
  due_at: string;
  completed_at?: string | null;
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Classify one follow-up at a given moment (defaults to now). */
export function classifyFollowUp(
  item: Pick<ReminderItem, "due_at" | "completed_at">,
  now: Date | string = new Date(),
): ReminderStatus {
  if (item.completed_at) return "completed";
  const due = toDate(item.due_at);
  const at = toDate(now);
  if (due.getTime() < at.getTime()) return "overdue";
  const dueSoonUntil = at.getTime() + REMINDER_DUE_SOON_HOURS * 3_600_000;
  return due.getTime() <= dueSoonUntil ? "due_soon" : "upcoming";
}

/** Whole hours (2dp) a follow-up has been overdue; 0 when not overdue. */
export function overdueHours(dueAt: string | Date, now: Date | string = new Date()): number {
  const diffMs = toDate(now).getTime() - toDate(dueAt).getTime();
  return diffMs <= 0 ? 0 : round2(diffMs / 3_600_000);
}

/**
 * True when an open follow-up has been overdue for at least `thresholdHours`
 * (default 24). Completed follow-ups are never escalated.
 */
export function isEscalated(
  item: Pick<ReminderItem, "due_at" | "completed_at">,
  now: Date | string = new Date(),
  thresholdHours: number = REMINDER_ESCALATION_HOURS,
): boolean {
  if (item.completed_at) return false;
  return overdueHours(item.due_at, now) >= thresholdHours;
}

export interface ReminderSummary {
  total: number;
  open: number;
  overdue: number;
  dueSoon: number;
  upcoming: number;
  completed: number;
  /** Open follow-ups overdue >= REMINDER_ESCALATION_HOURS. */
  escalated: number;
}

/** Count a list of follow-ups by status at a given moment. */
export function summarizeReminders(
  items: readonly Pick<ReminderItem, "due_at" | "completed_at">[],
  now: Date | string = new Date(),
): ReminderSummary {
  const summary: ReminderSummary = {
    total: items.length,
    open: 0,
    overdue: 0,
    dueSoon: 0,
    upcoming: 0,
    completed: 0,
    escalated: 0,
  };
  for (const item of items) {
    const status = classifyFollowUp(item, now);
    if (status === "completed") {
      summary.completed += 1;
      continue;
    }
    summary.open += 1;
    if (status === "overdue") {
      summary.overdue += 1;
      if (isEscalated(item, now)) summary.escalated += 1;
    } else if (status === "due_soon") {
      summary.dueSoon += 1;
    } else {
      summary.upcoming += 1;
    }
  }
  return summary;
}

/**
 * Earliest open follow-up (the per-lead "next follow-up" indicator).
 * Returns null when there is no open follow-up. Completed items are ignored.
 */
export function nextFollowUp<T extends ReminderItem>(
  items: readonly T[],
  _now: Date | string = new Date(),
): T | null {
  let best: T | null = null;
  for (const item of items) {
    if (item.completed_at) continue;
    if (!best || toDate(item.due_at).getTime() < toDate(best.due_at).getTime()) best = item;
  }
  return best;
}
