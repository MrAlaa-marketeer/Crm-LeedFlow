import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Handshake } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader, EmptyState } from "@/components/app/states";
import { useWorkspaceData } from "@/hooks/use-workspace";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { formatMoney } from "@/lib/leads";
import { inventoryDb } from "@/lib/inventory-client";

export const Route = createFileRoute("/_authenticated/deals")({ component: DealsPage });
type Stage = "reserved" | "won" | "lost" | "cancelled";
type Deal = {
  id: string;
  lead_id: string;
  property_id: string | null;
  value_egp: number;
  expected_close_date: string | null;
  stage: Stage;
  lost_reason: string | null;
  agent_commission_egp: number;
  company_commission_egp: number;
  lead?: { full_name: string } | null;
};
type DealLeadOption = { id: string; full_name: string };
type DealPropertyOption = { id: string; unit_code: string; project?: { name: string } | null };
const db = supabase as any;
const stages: Stage[] = ["reserved", "won", "lost", "cancelled"];
const stageKey = (stage: Stage) => ("deal_" + stage) as any;

function DealsPage() {
  const { t, locale } = useI18n();
  const ws = useWorkspaceData();
  const qc = useQueryClient();
  const [view, setView] = useState<"kanban" | "table">("kanban");
  const [editing, setEditing] = useState<Deal | null>(null);
  const deals = useQuery({
    queryKey: ["deals", ws.workspace.id],
    queryFn: async () => {
      const { data, error } = await db
        .from("deals")
        .select("*, lead:leads(full_name)")
        .eq("workspace_id", ws.workspace.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Deal[];
    },
  });
  const mutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const q =
        editing && editing.id
          ? db
              .from("deals")
              .update(payload)
              .eq("id", editing.id)
              .eq("workspace_id", ws.workspace.id)
          : db.from("deals").insert({ ...payload, workspace_id: ws.workspace.id });
      const { error } = await q;
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["deals", ws.workspace.id] });
      setEditing(null);
      toast.success(t("dealSaved"));
    },
  });
  const data = deals.data ?? [];
  const expected = data
    .filter((x) => x.stage === "reserved")
    .reduce((n, x) => n + Number(x.value_egp), 0);
  const commissions = data.reduce(
    (n, x) => n + Number(x.agent_commission_egp) + Number(x.company_commission_egp),
    0,
  );
  return (
    <div className="space-y-6">
      <PageHeader
        title={t("deals")}
        description={
          t("expectedRevenue") +
          ": " +
          formatMoney(expected, locale) +
          " · " +
          t("commissions") +
          ": " +
          formatMoney(commissions, locale)
        }
      >
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setView(view === "kanban" ? "table" : "kanban")}>
            {t(view === "kanban" ? "tableView" : "kanbanView")}
          </Button>
          <Button
            onClick={() =>
              setEditing({
                id: "",
                lead_id: "",
                property_id: null,
                value_egp: 0,
                expected_close_date: null,
                stage: "reserved",
                lost_reason: null,
                agent_commission_egp: 0,
                company_commission_egp: 0,
              })
            }
          >
            <Plus className="size-4" />
            {t("newDeal")}
          </Button>
        </div>
      </PageHeader>
      {deals.isPending ? (
        <p>...</p>
      ) : !data.length ? (
        <EmptyState icon={Handshake} title={t("dealsEmpty")} body="" />
      ) : view === "kanban" ? (
        <div className="grid gap-4 md:grid-cols-4">
          {stages.map((stage) => (
            <section key={stage} className="rounded-lg border bg-card p-3">
              <h2 className="mb-3 font-semibold">{t(stageKey(stage))}</h2>
              {data
                .filter((x) => x.stage === stage)
                .map((deal) => (
                  <button
                    key={deal.id}
                    className="mb-2 w-full rounded-md border p-3 text-start hover:bg-muted"
                    onClick={() => setEditing(deal)}
                  >
                    <b>{deal.lead?.full_name || deal.lead_id.slice(0, 8)}</b>
                    <div>{formatMoney(Number(deal.value_egp), locale)}</div>
                    <small>{deal.expected_close_date || ""}</small>
                  </button>
                ))}
            </section>
          ))}
        </div>
      ) : (
        <div className="overflow-auto rounded-lg border">
          <table className="data-table w-full text-sm">
            <thead>
              <tr className="border-b text-start">
                <th className="p-3">{t("dealLead")}</th>
                <th>{t("dealStage")}</th>
                <th>{t("dealValue")}</th>
                <th>{t("closeDate")}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((x) => (
                <tr className="border-b" key={x.id}>
                  <td className="p-3">{x.lead?.full_name || x.lead_id}</td>
                  <td>{t(stageKey(x.stage))}</td>
                  <td>{formatMoney(Number(x.value_egp), locale)}</td>
                  <td>{x.expected_close_date || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <DealForm
          deal={editing}
          workspaceId={ws.workspace.id}
          onClose={() => setEditing(null)}
          onSave={(p) => mutation.mutate(p)}
          saving={mutation.isPending}
        />
      )}
    </div>
  );
}
function DealForm({
  deal,
  workspaceId,
  onClose,
  onSave,
  saving,
}: {
  deal: Deal;
  workspaceId: string;
  onClose: () => void;
  onSave: (p: Record<string, unknown>) => void;
  saving: boolean;
}) {
  const { t } = useI18n();
  const [p, setP] = useState({ ...deal });
  const leadOptions = useQuery({
    queryKey: ["deal-leads", workspaceId],
    queryFn: async () => {
      const { data, error } = await db
        .from("leads")
        .select("id, full_name")
        .eq("workspace_id", workspaceId)
        .is("archived_at", null)
        .order("full_name")
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as DealLeadOption[];
    },
  });
  const propertyOptions = useQuery({
    queryKey: ["deal-properties", workspaceId],
    queryFn: async () => {
      const { data, error } = await inventoryDb
        .from("properties")
        .select("id, unit_code, project:projects(name)")
        .eq("workspace_id", workspaceId)
        .order("unit_code")
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as DealPropertyOption[];
    },
  });
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-overlay/40 p-4">
      <form
        className="grid w-full max-w-lg gap-3 rounded-lg bg-background p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!p.lead_id || !p.expected_close_date) return;
          onSave({
            lead_id: p.lead_id,
            property_id: p.property_id || null,
            value_egp: Number(p.value_egp),
            expected_close_date: p.expected_close_date || null,
            stage: p.stage,
            lost_reason: p.lost_reason || null,
            agent_commission_egp: Number(p.agent_commission_egp),
            company_commission_egp: Number(p.company_commission_egp),
          });
        }}
      >
        <h2 className="text-lg font-semibold">{t("newDeal")}</h2>
        <NativeSelect
          required
          aria-label={t("dealLead")}
          value={p.lead_id}
          onChange={(e) => setP({ ...p, lead_id: e.target.value })}
        >
          <option value="">{t("selectLead")}</option>
          {p.lead_id && !leadOptions.data?.some((lead) => lead.id === p.lead_id) && (
            <option value={p.lead_id}>{deal.lead?.full_name ?? p.lead_id}</option>
          )}
          {(leadOptions.data ?? []).map((lead) => (
            <option key={lead.id} value={lead.id}>
              {lead.full_name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label={t("dealProperty")}
          value={p.property_id || ""}
          onChange={(e) => setP({ ...p, property_id: e.target.value || null })}
        >
          <option value="">{t("dealProperty")}</option>
          {p.property_id && !propertyOptions.data?.some((property) => property.id === p.property_id) && (
            <option value={p.property_id}>{p.property_id}</option>
          )}
          {(propertyOptions.data ?? []).map((property) => (
            <option key={property.id} value={property.id}>
              {`${property.unit_code}${property.project?.name ? ` · ${property.project.name}` : ""}`}
            </option>
          ))}
        </NativeSelect>
        <Input
          type="number"
          min="0"
          placeholder={t("dealValue")}
          value={p.value_egp}
          onChange={(e) => setP({ ...p, value_egp: Number(e.target.value) })}
        />
        <Input
          type="date"
          required
          aria-label={t("closeDate")}
          value={p.expected_close_date || ""}
          onChange={(e) => setP({ ...p, expected_close_date: e.target.value })}
        />
        <NativeSelect
          value={p.stage}
          onChange={(e) => setP({ ...p, stage: e.target.value as Stage })}
        >
          {stages.map((s) => (
            <option key={s} value={s}>
              {t(stageKey(s))}
            </option>
          ))}
        </NativeSelect>
        {(p.stage === "lost" || p.stage === "cancelled") && (
          <Input
            placeholder={t("lostReason")}
            value={p.lost_reason || ""}
            onChange={(e) => setP({ ...p, lost_reason: e.target.value })}
          />
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button disabled={saving} type="submit">
            {t("save")}
          </Button>
        </div>
      </form>
    </div>
  );
}
