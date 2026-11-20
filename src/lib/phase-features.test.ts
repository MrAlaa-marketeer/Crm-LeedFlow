import { describe, expect, it } from "vitest";
import {
  buildSavedSearchCriteria,
  daysIdle,
  deriveLeadScoreInput,
  isRentalEndingSoon,
  matchUnit,
  monthlyInstallment,
  parseSavedSearchCriteria,
  rentalDaysRemaining,
  revivalCandidates,
  scoreLead,
} from "./phase-features";
describe("lead scoring and matching", () => {
  it("classifies hot, warm and cold leads", () => {
    expect(
      scoreLead({ budget: 1, timelineDays: 10, responseMinutes: 2, interactions: 4 }).band,
    ).toBe("hot");
    expect(scoreLead({ budget: 1, timelineDays: 90, interactions: 1 }).band).toBe("warm");
    expect(scoreLead({}).band).toBe("cold");
  });
  it("scores units and calculates installments", () => {
    expect(
      matchUnit(
        { budget: 1000000, preferredArea: "New Cairo", bedrooms: 2 },
        { price: 1000000, area: "New Cairo", bedrooms: 2 },
      ),
    ).toBe(100);
    expect(monthlyInstallment(1200000, 200000, 5)).toBe(16666.67);
  });
  it("finds inactive leads for revival", () => {
    const now = new Date("2026-11-20T00:00:00Z");
    expect(
      revivalCandidates([{ id: "a", updated_at: "2026-10-01T00:00:00Z", archived_at: null }], now),
    ).toHaveLength(1);
  });
  it("derives a score input from a lead row", () => {
    const now = new Date("2026-11-20T12:00:00Z");
    const input = deriveLeadScoreInput(
      {
        budget_min: 500000,
        budget_max: 1000000,
        next_follow_up_at: "2026-11-25T12:00:00Z",
        first_response_minutes: 3,
      },
      2,
      now,
    );
    expect(input).toEqual({
      budget: 1000000,
      timelineDays: 5,
      responseMinutes: 3,
      interactions: 2,
    });
    expect(scoreLead(input).band).toBe("hot");
    // No follow-up scheduled and no budget: cold, timeline stays null.
    expect(
      deriveLeadScoreInput({ budget_min: null, budget_max: null, next_follow_up_at: null }, 0, now),
    ).toEqual({ budget: null, timelineDays: null, responseMinutes: null, interactions: 0 });
    // Overdue follow-up counts as 0 days (most urgent), never negative.
    expect(
      deriveLeadScoreInput({ next_follow_up_at: "2026-11-01T12:00:00Z" }, 0, now).timelineDays,
    ).toBe(0);
  });
  it("counts idle days for revival", () => {
    expect(daysIdle("2026-10-01T00:00:00Z", new Date("2026-11-20T00:00:00Z"))).toBe(50);
  });
  it("round-trips saved-search criteria", () => {
    const criteria = buildSavedSearchCriteria({
      q: "  ahmed ",
      status: "new",
      source: "",
      assignee: "",
      view: "active",
    });
    expect(criteria).toEqual({ q: "ahmed", status: "new", view: "active" });
    expect(parseSavedSearchCriteria(criteria)).toEqual({
      q: "ahmed",
      status: "new",
      source: "",
      assignee: "",
      view: "active",
    });
    expect(parseSavedSearchCriteria({ view: "bogus", status: 42 })).toEqual({
      q: "",
      status: "",
      source: "",
      assignee: "",
      view: "active",
    });
    expect(parseSavedSearchCriteria(null)).toEqual({
      q: "",
      status: "",
      source: "",
      assignee: "",
      view: "active",
    });
  });
  it("flags rentals ending soon", () => {
    const now = new Date("2026-11-20T12:00:00Z");
    expect(rentalDaysRemaining("2026-12-01", now)).toBe(11);
    expect(rentalDaysRemaining("2026-11-01", now)).toBe(-19);
    expect(rentalDaysRemaining(null, now)).toBeNull();
    expect(isRentalEndingSoon("2026-12-01", "active", now)).toBe(true);
    expect(isRentalEndingSoon("2027-06-01", "active", now)).toBe(false);
    expect(isRentalEndingSoon("2026-11-01", "ended", now)).toBe(false);
  });
});
