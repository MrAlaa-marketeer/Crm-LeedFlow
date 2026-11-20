import type { Property } from "@/lib/inventory-client";

export type InventoryMatchLead = {
  budget_min: number | null;
  budget_max: number | null;
  preferred_area: string | null;
};

export function matchesLeadPreferences(property: Property, lead: InventoryMatchLead, term = "") {
  if (property.availability !== "available") return false;
  if ((lead.budget_min != null || lead.budget_max != null) && property.price == null) return false;
  if (lead.budget_max != null && property.price != null && property.price > lead.budget_max)
    return false;
  if (lead.budget_min != null && property.price != null && property.price < lead.budget_min)
    return false;
  if (
    lead.preferred_area &&
    property.project?.location &&
    !property.project.location.toLocaleLowerCase().includes(lead.preferred_area.toLocaleLowerCase())
  )
    return false;
  const query = term.trim().toLocaleLowerCase();
  return (
    !query ||
    [property.unit_code, property.project?.name, property.project?.location].some((value) =>
      value?.toLocaleLowerCase().includes(query),
    )
  );
}
