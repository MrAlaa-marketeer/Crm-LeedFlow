import { describe, expect, it } from "vitest";

import { matchesLeadPreferences } from "./inventory-matching";
import type { Property } from "./inventory-client";

const property: Property = {
  id: "unit-1",
  workspace_id: "workspace-1",
  project_id: "project-1",
  unit_code: "A-101",
  property_type: "apartment",
  area: 120,
  bedrooms: 3,
  bathrooms: 2,
  price: 4_000_000,
  payment_plan: null,
  availability: "available",
  project: { name: "Garden Residence", location: "New Cairo" },
};

describe("matchesLeadPreferences", () => {
  it("matches budget, area, and unit/project searches", () => {
    const lead = { budget_min: 3_000_000, budget_max: 5_000_000, preferred_area: "cairo" };
    expect(matchesLeadPreferences(property, lead)).toBe(true);
    expect(matchesLeadPreferences(property, lead, "garden")).toBe(true);
    expect(matchesLeadPreferences(property, lead, "A-101")).toBe(true);
  });

  it("rejects units outside budget, area, or availability", () => {
    expect(
      matchesLeadPreferences(property, {
        budget_min: null,
        budget_max: 3_000_000,
        preferred_area: null,
      }),
    ).toBe(false);
    expect(
      matchesLeadPreferences(property, {
        budget_min: null,
        budget_max: null,
        preferred_area: "maadi",
      }),
    ).toBe(false);
    expect(
      matchesLeadPreferences(
        { ...property, availability: "reserved" },
        { budget_min: null, budget_max: null, preferred_area: null },
      ),
    ).toBe(false);
    expect(
      matchesLeadPreferences(
        { ...property, price: null },
        { budget_min: null, budget_max: 5_000_000, preferred_area: null },
      ),
    ).toBe(false);
  });
});
