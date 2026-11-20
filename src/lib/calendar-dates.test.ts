import { describe, expect, it } from "vitest";
import { addCalendarDays, localDateKey, localMonthGrid, startOfLocalWeek } from "./calendar-dates";

describe("local calendar date helpers", () => {
  it("builds local dates without shifting the selected calendar day", () => {
    const selected = new Date(2026, 10, 19, 18, 30);
    expect(localDateKey(addCalendarDays(selected, 1))).toBe("2026-11-20");
  });

  it("starts weeks on Sunday and always returns a six-week month grid", () => {
    const firstOfMonth = new Date(2026, 11, 1, 12);
    expect(startOfLocalWeek(firstOfMonth).getDay()).toBe(0);
    expect(localMonthGrid(firstOfMonth)).toHaveLength(42);
    expect(localDateKey(localMonthGrid(firstOfMonth)[0]!)).toBe("2026-11-29");
  });
});
