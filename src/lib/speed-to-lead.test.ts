import { describe, expect, it } from "vitest";
import {
  averageResponseMinutes,
  firstResponseMinutes,
  nextRoundRobinAgent,
  validateCapture,
} from "./speed-to-lead";

describe("lead capture validation", () => {
  it("normalizes valid Egyptian phones and rejects spam", () => {
    expect(
      validateCapture({
        name: "Ali",
        phone: "010 1234 5678",
        budget: "1,000,000",
        preferredArea: "",
        project: "",
        honeypot: "",
      }),
    ).toMatchObject({ phone: "+201012345678", budget: 1000000, errors: [] });
    expect(
      validateCapture({
        name: "Ali",
        phone: "01012345678",
        budget: "",
        preferredArea: "",
        project: "",
        honeypot: "bot",
      }).errors,
    ).toContain("spam");
  });
});
describe("round robin assignment", () => {
  it("rotates among available workspace agents and handles an empty team", () => {
    expect(nextRoundRobinAgent(["a", "b", "c"], null)).toBe("a");
    expect(nextRoundRobinAgent(["a", "b", "c"], "a")).toBe("b");
    expect(nextRoundRobinAgent(["a", "b", "c"], "c")).toBe("a");
    expect(nextRoundRobinAgent([], null)).toBeNull();
  });
});
describe("speed to lead", () => {
  it("calculates elapsed response time and waiting averages", () => {
    const now = new Date("2026-11-20T12:10:00Z");
    expect(firstResponseMinutes("2026-11-20T12:00:00Z", "2026-11-20T12:06:30Z", now)).toBe(6.5);
    expect(firstResponseMinutes("2026-11-20T12:00:00Z", null, now)).toBe(10);
    expect(averageResponseMinutes([5, 10, null])).toBe(7.5);
    expect(averageResponseMinutes([])).toBeNull();
  });
});
