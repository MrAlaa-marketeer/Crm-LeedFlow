export type DealStage = "reserved" | "won" | "lost" | "cancelled";
export type InventoryAvailability = "available" | "reserved" | "sold" | "unavailable";

/** Mirrors the database trigger so UI previews and tests use the same lifecycle. */
export function inventoryStatusForDeal(
  stage: DealStage,
  current: InventoryAvailability,
): InventoryAvailability {
  if (stage === "reserved" && (current === "available" || current === "reserved"))
    return "reserved";
  if (stage === "won" && (current === "available" || current === "reserved")) return "sold";
  if ((stage === "lost" || stage === "cancelled") && (current === "reserved" || current === "sold"))
    return "available";
  return current;
}
