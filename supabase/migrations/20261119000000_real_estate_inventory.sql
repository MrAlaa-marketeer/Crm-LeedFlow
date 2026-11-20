-- Workspace-owned real-estate inventory. No inventory rows are seeded.
CREATE TYPE public.project_status AS ENUM ('planning', 'under_construction', 'ready', 'paused', 'completed');
CREATE TYPE public.property_type AS ENUM ('apartment', 'villa', 'townhouse', 'duplex', 'penthouse', 'studio', 'commercial', 'land', 'other');
CREATE TYPE public.inventory_status AS ENUM ('available', 'reserved', 'sold', 'unavailable');

CREATE TABLE public.developers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
  contact_name text CHECK (contact_name IS NULL OR char_length(contact_name) <= 120),
  email text CHECK (email IS NULL OR char_length(email) <= 255),
  phone text CHECK (phone IS NULL OR char_length(phone) <= 30),
  website text CHECK (website IS NULL OR char_length(website) <= 500),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 5000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id)
);

CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  developer_id uuid,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  location text CHECK (location IS NULL OR char_length(location) <= 240),
  project_type text CHECK (project_type IS NULL OR char_length(project_type) <= 100),
  description text CHECK (description IS NULL OR char_length(description) <= 10000),
  delivery_date date,
  status public.project_status NOT NULL DEFAULT 'planning',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  CONSTRAINT projects_developer_workspace_fk FOREIGN KEY (developer_id, workspace_id)
    REFERENCES public.developers(id, workspace_id) ON DELETE RESTRICT
);

CREATE TABLE public.properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  unit_code text NOT NULL CHECK (char_length(btrim(unit_code)) BETWEEN 1 AND 100),
  property_type public.property_type NOT NULL DEFAULT 'other',
  area numeric(12, 2) CHECK (area IS NULL OR area > 0),
  bedrooms smallint CHECK (bedrooms IS NULL OR bedrooms BETWEEN 0 AND 50),
  bathrooms smallint CHECK (bathrooms IS NULL OR bathrooms BETWEEN 0 AND 50),
  price numeric(14, 2) CHECK (price IS NULL OR price >= 0),
  payment_plan text CHECK (payment_plan IS NULL OR char_length(payment_plan) <= 3000),
  availability public.inventory_status NOT NULL DEFAULT 'available',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  UNIQUE (project_id, unit_code),
  CONSTRAINT properties_project_workspace_fk FOREIGN KEY (project_id, workspace_id)
    REFERENCES public.projects(id, workspace_id) ON DELETE RESTRICT
);

CREATE INDEX developers_workspace_name_idx ON public.developers(workspace_id, name);
CREATE INDEX projects_workspace_name_idx ON public.projects(workspace_id, name);
CREATE INDEX projects_workspace_location_idx ON public.projects(workspace_id, location);
CREATE INDEX properties_workspace_availability_idx ON public.properties(workspace_id, availability);
CREATE INDEX properties_workspace_filter_idx ON public.properties(workspace_id, property_type, availability, price);
CREATE INDEX properties_workspace_unit_code_idx ON public.properties(workspace_id, unit_code);
CREATE INDEX properties_project_price_idx ON public.properties(project_id, price);

CREATE OR REPLACE FUNCTION public.guard_inventory_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
    RAISE EXCEPTION 'Inventory records cannot move between workspaces';
  END IF;
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'properties' THEN
    IF NEW.project_id IS DISTINCT FROM OLD.project_id
      AND EXISTS (SELECT 1 FROM public.leads WHERE interested_property_id = OLD.id) THEN
      RAISE EXCEPTION 'A unit linked to a lead cannot be moved to another project';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE public.leads ADD COLUMN interested_project_id uuid;
ALTER TABLE public.leads ADD COLUMN interested_property_id uuid;
ALTER TABLE public.leads ADD CONSTRAINT leads_project_workspace_fk
  FOREIGN KEY (interested_project_id, workspace_id) REFERENCES public.projects(id, workspace_id) ON DELETE RESTRICT;
ALTER TABLE public.leads ADD CONSTRAINT leads_property_workspace_fk
  FOREIGN KEY (interested_property_id, workspace_id) REFERENCES public.properties(id, workspace_id) ON DELETE SET NULL (interested_property_id);
CREATE INDEX leads_ws_project_idx ON public.leads(workspace_id, interested_project_id);
CREATE INDEX leads_ws_property_idx ON public.leads(workspace_id, interested_property_id);

CREATE OR REPLACE FUNCTION public.validate_lead_inventory_links()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE property_project uuid;
BEGIN
  IF NEW.interested_property_id IS NOT NULL THEN
    SELECT project_id INTO property_project FROM public.properties
      WHERE id = NEW.interested_property_id AND workspace_id = NEW.workspace_id;
    IF property_project IS NULL THEN RAISE EXCEPTION 'Property must belong to the lead workspace'; END IF;
    IF NEW.interested_project_id IS NOT NULL AND NEW.interested_project_id <> property_project THEN
      RAISE EXCEPTION 'Selected property must belong to the selected project';
    END IF;
    NEW.interested_project_id := property_project;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER leads_inventory_links_before_write BEFORE INSERT OR UPDATE OF interested_project_id, interested_property_id, workspace_id
  ON public.leads FOR EACH ROW EXECUTE FUNCTION public.validate_lead_inventory_links();

-- Preserve the existing real-event-only timeline without rewriting old lead events.
CREATE OR REPLACE FUNCTION public.log_lead_inventory_link_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE changed_fields text[] := ARRAY[]::text[];
BEGIN
  IF NEW.interested_project_id IS DISTINCT FROM OLD.interested_project_id THEN
    changed_fields := array_append(changed_fields, 'interested_project_id');
  END IF;
  IF NEW.interested_property_id IS DISTINCT FROM OLD.interested_property_id THEN
    changed_fields := array_append(changed_fields, 'interested_property_id');
  END IF;
  IF cardinality(changed_fields) > 0 THEN
    INSERT INTO public.lead_activities (workspace_id, lead_id, actor_id, activity_type, details)
    VALUES (NEW.workspace_id, NEW.id, auth.uid(), 'lead.updated', jsonb_build_object('changed_fields', to_jsonb(changed_fields)));
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER leads_inventory_link_activity AFTER UPDATE OF interested_project_id, interested_property_id
  ON public.leads FOR EACH ROW EXECUTE FUNCTION public.log_lead_inventory_link_activity();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['developers', 'projects', 'properties'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "Members read %I" ON public.%I FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id))', t, t);
    EXECUTE format('CREATE POLICY "Members create %I" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_workspace_member(workspace_id))', t, t);
    EXECUTE format('CREATE POLICY "Members update %I" ON public.%I FOR UPDATE TO authenticated USING (public.is_workspace_member(workspace_id)) WITH CHECK (public.is_workspace_member(workspace_id))', t, t);
    EXECUTE format('CREATE POLICY "Owners delete %I" ON public.%I FOR DELETE TO authenticated USING (public.has_workspace_role(workspace_id, ''owner''))', t, t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t || '_updated_at', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_inventory_write()', t || '_guard_write', t);
  END LOOP;
END $$;

COMMENT ON TABLE public.developers IS 'Developer records are owned by a single workspace; no global developer directory.';
COMMENT ON TABLE public.projects IS 'Projects and inventory are workspace-scoped; all policies enforce membership.';
COMMENT ON TABLE public.properties IS 'Property/unit inventory. Linking a lead does not reserve or sell the unit.';
