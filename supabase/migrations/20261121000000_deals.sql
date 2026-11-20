ALTER TABLE public.leads ADD CONSTRAINT leads_id_workspace_unique UNIQUE (id, workspace_id);
CREATE TYPE public.deal_stage AS ENUM ('reserved', 'won', 'lost', 'cancelled');
CREATE TABLE public.deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL,
  property_id uuid,
  value_egp numeric(14,2) NOT NULL DEFAULT 0 CHECK (value_egp >= 0),
  expected_close_date date,
  stage public.deal_stage NOT NULL DEFAULT 'reserved',
  lost_reason text CHECK (lost_reason IS NULL OR char_length(lost_reason) <= 1000),
  agent_commission_egp numeric(14,2) NOT NULL DEFAULT 0 CHECK (agent_commission_egp >= 0),
  company_commission_egp numeric(14,2) NOT NULL DEFAULT 0 CHECK (company_commission_egp >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  CONSTRAINT deals_lead_workspace_fk FOREIGN KEY (lead_id, workspace_id) REFERENCES public.leads(id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT deals_property_workspace_fk FOREIGN KEY (property_id, workspace_id) REFERENCES public.properties(id, workspace_id) ON DELETE RESTRICT
);
CREATE INDEX deals_workspace_stage_idx ON public.deals(workspace_id, stage);
CREATE INDEX deals_workspace_close_idx ON public.deals(workspace_id, expected_close_date);
ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deals TO authenticated;
GRANT ALL ON public.deals TO service_role;
CREATE POLICY "Members read deals" ON public.deals FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE POLICY "Members create deals" ON public.deals FOR INSERT TO authenticated WITH CHECK (public.is_workspace_member(workspace_id));
CREATE POLICY "Members update deals" ON public.deals FOR UPDATE TO authenticated USING (public.is_workspace_member(workspace_id)) WITH CHECK (public.is_workspace_member(workspace_id));
CREATE POLICY "Owners delete deals" ON public.deals FOR DELETE TO authenticated USING (public.has_workspace_role(workspace_id, 'owner'));
CREATE OR REPLACE FUNCTION public.sync_deal_inventory() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.property_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.stage = 'reserved' THEN
    UPDATE public.properties SET availability = 'reserved', updated_at = now()
      WHERE id = NEW.property_id AND workspace_id = NEW.workspace_id AND availability IN ('available','reserved');
  ELSIF NEW.stage = 'won' THEN
    UPDATE public.properties SET availability = 'sold', updated_at = now()
      WHERE id = NEW.property_id AND workspace_id = NEW.workspace_id AND availability IN ('available','reserved');
  ELSIF NEW.stage IN ('lost','cancelled') THEN
    UPDATE public.properties SET availability = 'available', updated_at = now()
      WHERE id = NEW.property_id AND workspace_id = NEW.workspace_id AND availability IN ('reserved','sold');
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER deals_inventory_sync AFTER INSERT OR UPDATE OF stage, property_id ON public.deals FOR EACH ROW EXECUTE FUNCTION public.sync_deal_inventory();
CREATE TRIGGER deals_updated_at BEFORE UPDATE ON public.deals FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
