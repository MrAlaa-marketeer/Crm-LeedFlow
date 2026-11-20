import { describe, expect, it } from "vitest";
import { parseReport, reportDateBounds } from "./report-analytics";

describe("report analytics data handling", () => {
  it("treats empty aggregate data as zero-valued metrics and empty charts", () => {
    const report = parseReport(null);
    expect(report.kpis.total_leads).toBe(0);
    expect(report.kpis.conversion_rate).toBe(0);
    expect(report.by_status).toEqual([]);
    expect(report.monthly).toEqual([]);
    expect(report.employees).toEqual([]);
    expect(report.projects).toEqual([]);
  });

  it("normalizes database numeric strings without losing aggregate counts", () => {
    const report = parseReport({
      kpis: { total_leads: "8", won_leads: "2", conversion_rate: "25.0" },
      by_status: { won: "2", new: 6 },
      monthly: [{ month: "2026-11-01T00:00:00Z", total: "8", qualified: 3, won: 2, lost: 1 }],
    });
    expect(report.kpis.total_leads).toBe(8);
    expect(report.kpis.conversion_rate).toBe(25);
    expect(report.by_status).toEqual([
      { name: "won", count: 2 },
      { name: "new", count: 6 },
    ]);
    expect(report.monthly[0]).toMatchObject({ total: 8, qualified: 3, won: 2, lost: 1 });
  });

  it("uses an exclusive next-day end bound for date filters", () => {
    const bounds = reportDateBounds("2026-11-01", "2026-11-19");
    expect(new Date(bounds.from).getHours()).toBe(0);
    expect(new Date(bounds.to).getDate()).toBe(20);
    expect(new Date(bounds.to).getHours()).toBe(0);
  });
});
