import { describe, expect, it } from "vitest";
import { mapHeaders, parseCsvText, validateRows, type ValidatedRow } from "./csv";

function run(csv: string) {
  const { rows, headers } = parseCsvText(csv);
  const { map, missing, unknown } = mapHeaders(headers);
  return { results: validateRows(rows, map), missing, unknown };
}

/** Index into results, failing the test loudly instead of returning undefined. */
function row(results: ValidatedRow[], index: number): ValidatedRow {
  const r = results[index];
  if (!r) throw new Error(`Expected a validated row at index ${index}, got ${results.length} rows`);
  return r;
}

describe("CSV import validation", () => {
  it("reports missing required columns", () => {
    const { missing } = run("name,email\nAli,a@b.com");
    expect(missing).toEqual(["phone"]);
  });

  it("accepts Arabic headers and Arabic source/status values", () => {
    const { results } = run("الاسم,رقم الهاتف,المصدر,المرحلة\nمنى,01012345678,فيسبوك,تم التواصل");
    expect(row(results, 0).errors).toEqual([]);
    expect(row(results, 0).data).toMatchObject({
      phone: "+201012345678",
      source: "facebook",
      status: "contacted",
    });
  });

  it("never drops a bad row silently: each invalid row is returned with its row number and errors", () => {
    const { results } = run(
      "full_name,phone,email,source,budget_min,budget_max\n" +
        "Good,01012345678,,,,\n" +
        ",123,bad-email,tiktok,abc,\n" +
        "Range,01112345678,,,5000000,1000000",
    );
    expect(results).toHaveLength(3);
    expect(row(results, 0).data).not.toBeNull();
    expect(row(results, 1).rowNumber).toBe(3);
    expect(row(results, 1).data).toBeNull();
    expect(row(results, 1).errors.map((e) => e.key)).toEqual([
      "errEmptyName",
      "errPhone",
      "errEmail",
      "errSource",
      "errBudget",
    ]);
    expect(row(results, 2).errors.map((e) => e.key)).toEqual(["errBudgetRange"]);
  });

  it("warns about duplicate phones in the same file but keeps both rows importable", () => {
    const { results } = run("full_name,phone\nA,01012345678\nB,+20 101 234 5678");
    expect(row(results, 1).data).not.toBeNull();
    expect(row(results, 1).warnings[0]).toEqual({ key: "warnDupFile", vars: { row: 2 } });
  });

  it("parses DD/MM/YYYY follow-up dates and rejects impossible ones", () => {
    const { results } = run(
      "full_name,phone,next_follow_up_at\nA,01012345678,25/12/2026 14:30\nB,01112345678,31/02/2026",
    );
    const followUpAt = row(results, 0).data?.next_follow_up_at;
    if (!followUpAt) throw new Error("Expected row A to have a follow-up date");
    const d = new Date(followUpAt);
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([
      2026, 11, 25, 14, 30,
    ]);
    expect(row(results, 1).errors.map((e) => e.key)).toEqual(["errDate"]);
  });
});
