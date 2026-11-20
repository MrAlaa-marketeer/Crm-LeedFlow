import { describe, expect, it } from "vitest";
import { groupPipelineLeads, pipelineWinRate, type PipelineStageCounts } from "./pipeline";

const emptyCounts: PipelineStageCounts = {
  new: 0,
  contacted: 0,
  qualified: 0,
  meeting: 0,
  negotiation: 0,
  won: 0,
  lost: 0,
};

describe("sales pipeline helpers", () => {
  it("groups every lead once under its current sales stage", () => {
    const leads = [
      { id: "a", status: "new" as const },
      { id: "b", status: "won" as const },
      { id: "c", status: "new" as const },
    ];
    const grouped = groupPipelineLeads(leads);

    expect(grouped.new.map((lead) => lead.id)).toEqual(["a", "c"]);
    expect(grouped.won.map((lead) => lead.id)).toEqual(["b"]);
    expect(Object.values(grouped).flat()).toHaveLength(leads.length);
  });

  it("calculates win rate only from closed won/lost outcomes", () => {
    expect(pipelineWinRate({ ...emptyCounts, won: 3, lost: 1, new: 12 })).toBe(75);
    expect(pipelineWinRate(emptyCounts)).toBeNull();
  });
});
