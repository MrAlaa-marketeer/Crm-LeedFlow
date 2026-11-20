import { supabase } from "@/integrations/supabase/client";

// Supabase's Database type is generated from the remote schema. The Phase 5
// migration is intentionally awaiting review, so keep these new tables local
// to this feature until the normal schema type-generation workflow is run.
export const inventoryDb = supabase as unknown as {
  // The current generated schema intentionally excludes the unapproved Phase 5 tables.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: "developers" | "projects" | "properties" | "leads") => any;
};

export type Developer = {
  id: string;
  workspace_id: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  notes: string | null;
};

export type Project = {
  id: string;
  workspace_id: string;
  developer_id: string | null;
  name: string;
  location: string | null;
  project_type: string | null;
  description: string | null;
  delivery_date: string | null;
  status: "planning" | "under_construction" | "ready" | "paused" | "completed";
  developer?: Pick<Developer, "name"> | null;
};

export type Property = {
  id: string;
  workspace_id: string;
  project_id: string;
  unit_code: string;
  property_type:
    | "apartment"
    | "villa"
    | "townhouse"
    | "duplex"
    | "penthouse"
    | "studio"
    | "commercial"
    | "land"
    | "other";
  area: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  price: number | null;
  payment_plan: string | null;
  availability: "available" | "reserved" | "sold" | "unavailable";
  project?: Pick<Project, "name" | "location"> | null;
};
