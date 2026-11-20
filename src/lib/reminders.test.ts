import { describe, expect, it } from "vitest";
import {
  REMINDER_DUE_SOON_HOURS,
  REMINDER_ESCALATION_HOURS,
  classifyFollowUp,
  isEscalated,
  nextFollowUp,
  overdueHours,
  summarizeReminders,
} from "./reminders";

const NOW = new Date("2026-11-20T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const hoursAhead = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

describe("classifyFollowUp", () => {
  it("marks past-due as overdue, near-future as due soon, far-future as upcoming", () => {
    expect(classifyFollowUp({ due_at: hoursAgo(1) }, NOW)).toBe("overdue");
    expect(classifyFollowUp({ due_at: hoursAhead(1) }, NOW)).toBe("due_soon");
    expect(classifyFollowUp({ due_at: hoursAhead(REMINDER_DUE_SOON_HOURS) }, NOW)).toBe("due_soon");
    expect(classifyFollowUp({ due_at: hoursAhead(REMINDER_DUE_SOON_HOURS + 1) }, NOW)).toBe(
      "upcoming",
    );
  });

  it("treats due exactly now as due soon, not overdue (matches SQL due_at < now())", () => {
    expect(classifyFollowUp({ due_at: NOW.toISOString() }, NOW)).toBe("due_soon");
  });

  it("treats completed follow-ups as completed whatever the due date was", () => {
    expect(classifyFollowUp({ due_at: hoursAgo(48), completed_at: hoursAgo(1) }, NOW)).toBe(
      "completed",
    );
  });
});

describe("overdueHours / isEscalated", () => {
  it("returns 0 for future due dates and counts whole overdue hours", () => {
    expect(overdueHours(hoursAhead(2), NOW)).toBe(0);
    expect(overdueHours(hoursAgo(1.5), NOW)).toBe(1.5);
    expect(overdueHours(hoursAgo(25), NOW)).toBe(25);
  });

  it("escalates at exactly 24h overdue, not before", () => {
    expect(isEscalated({ due_at: hoursAgo(REMINDER_ESCALATION_HOURS) }, NOW)).toBe(true);
    expect(isEscalated({ due_at: hoursAgo(23.99) }, NOW)).toBe(false);
    expect(isEscalated({ due_at: hoursAgo(72) }, NOW)).toBe(true);
  });

  it("never escalates completed or upcoming follow-ups", () => {
    expect(isEscalated({ due_at: hoursAgo(72), completed_at: hoursAgo(1) }, NOW)).toBe(false);
    expect(isEscalated({ due_at: hoursAhead(5) }, NOW)).toBe(false);
  });

  it("honours a custom escalation threshold", () => {
    expect(isEscalated({ due_at: hoursAgo(5) }, NOW, 4)).toBe(true);
    expect(isEscalated({ due_at: hoursAgo(5) }, NOW, 6)).toBe(false);
  });
});

describe("summarizeReminders", () => {
  it("counts each bucket and the escalated subset", () => {
    expect(
      summarizeReminders(
        [
          { due_at: hoursAgo(30) },
          { due_at: hoursAgo(2) },
          { due_at: hoursAhead(3) },
          { due_at: hoursAhead(72) },
          { due_at: hoursAgo(50), completed_at: hoursAgo(1) },
        ],
        NOW,
      ),
    ).toEqual({
      total: 5,
      open: 4,
      overdue: 2,
      dueSoon: 1,
      upcoming: 1,
      completed: 1,
      escalated: 1,
    });
  });

  it("returns zeros for an empty list", () => {
    expect(summarizeReminders([], NOW)).toEqual({
      total: 0,
      open: 0,
      overdue: 0,
      dueSoon: 0,
      upcoming: 0,
      completed: 0,
      escalated: 0,
    });
  });
});

describe("nextFollowUp", () => {
  it("returns the earliest open follow-up and ignores completed ones", () => {
    const items = [
      { id: "a", due_at: hoursAhead(10) },
      { id: "b", due_at: hoursAgo(2) },
      { id: "c", due_at: hoursAgo(50), completed_at: hoursAgo(1) },
      { id: "d", due_at: hoursAhead(1) },
    ];
    expect(nextFollowUp(items, NOW)?.id).toBe("b");
    expect(
      nextFollowUp(
        items.filter((i) => i.id !== "b"),
        NOW,
      )?.id,
    ).toBe("d");
  });

  it("returns null when nothing is open", () => {
    expect(nextFollowUp([], NOW)).toBeNull();
    expect(
      nextFollowUp([{ id: "x", due_at: hoursAgo(1), completed_at: hoursAgo(1) }], NOW),
    ).toBeNull();
  });
});

describe("reminder thresholds", () => {
  it("keeps the documented 24h due-soon window and 24h escalation threshold", () => {
    expect(REMINDER_DUE_SOON_HOURS).toBe(24);
    expect(REMINDER_ESCALATION_HOURS).toBe(24);
  });
});
