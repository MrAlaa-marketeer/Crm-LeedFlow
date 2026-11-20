import { describe, expect, it } from "vitest";
import { inventoryStatusForDeal } from "./deals";

describe("deal inventory lifecycle", () => {
  it("moves a unit available -> reserved -> sold", () => {
    expect(inventoryStatusForDeal("reserved", "available")).toBe("reserved");
    expect(inventoryStatusForDeal("won", "reserved")).toBe("sold");
  });
  it("releases reserved and sold units when a deal is lost or cancelled", () => {
    expect(inventoryStatusForDeal("lost", "reserved")).toBe("available");
    expect(inventoryStatusForDeal("cancelled", "sold")).toBe("available");
  });
  it("does not make unrelated unavailable inventory available", () => {
    expect(inventoryStatusForDeal("reserved", "unavailable")).toBe("unavailable");
  });
});
