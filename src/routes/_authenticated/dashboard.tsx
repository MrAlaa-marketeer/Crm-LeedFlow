import { useState } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Building2,
  CalendarClock,
  ChevronRight,
  GitBranch,
  MessageCircle,
  Target,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { WhatsAppDialog } from "@/components/app/whatsapp-dialog";
import { ErrorState, ListSkeleton, PageHeader } from "@/components/app/states";
import { workspaceQueryOptions, useWorkspaceData } from "@/hooks/use-workspace";
import { useI18n } from "@/lib/i18n";
import { statsQuery } from "@/lib/queries";
import { daysIdle, revivalCandidates } from "@/lib/phase-features";
import { formatMoney } from "@/lib/leads";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "لوحة التحكم — LeadFlow | Dashboard" },
      { name: "description", content: "Your agency's lead and follow-up overview." },
      { property: "og:title", content: "LeadFlow Dashboard" },
      { property: "og:description", content: "Lead and follow-up overview for your agency." },
    ],
  }),
  loader: async ({ context }) => {
    const ws = await context.queryClient.ensureQueryData(workspaceQueryOptions);
    await context.queryClient.ensureQueryData(statsQuery(ws.workspace.id, "month"));
  },
  pendingComponent: () => <ListSkeleton rows={4} />,
  errorComponent: DashboardError,
  component: Dashboard,
});

function DashboardError({ error }: { error: unknown }) {
  const router = useRouter();
  return <ErrorState error={error} onRetry={() => router.invalidate()} />;
}

function Dashboard() {
  const { t, dir } = useI18n();
  const ws = useWorkspaceData();
  const { data } = useSuspenseQuery(statsQuery(ws.workspace.id, "month"));
  const s = data.stats;
  const response = useQuery({
    queryKey: ["speed-to-lead", ws.workspace.id],
    queryFn: async () => {
      const { data: rows, error } = await (supabase as any).rpc("speed_to_lead_report", {
        _workspace_id: ws.workspace.id,
      });
      if (error) throw error;
      return (rows ?? []) as {
        agent_id: string | null;
        average_minutes: number | null;
        waiting_over_five: number;
      }[];
    },
  });
  const kpis = [
    { label: t("kpiTotal"), value: s.total_leads, hint: t("kpiTotalHint") },
    { label: t("kpiNewMonth"), value: s.new_this_month, hint: t("kpiNewMonthHint") },
    {
      label: t("kpiDue"),
      value: s.overdue + s.due_today,
      hint: t("kpiDueHint", { overdue: s.overdue, today: s.due_today }),
    },
    { label: t("kpiWon"), value: s.range_won, hint: t("kpiWonLostHint") },
  ];
  const shortcuts = [
    { label: t("openLeads"), to: "/leads", icon: Users },
    { label: t("viewPipeline"), to: "/pipeline", icon: GitBranch },
    { label: t("manageFollowUps"), to: "/follow-ups", icon: CalendarClock },
    { label: t("browseProjects"), to: "/projects", icon: Building2 },
  ] as const;
  return (
    <div className="space-y-6">
      <PageHeader
        title={t("dashboardGreeting", { name: ws.profile.full_name || ws.email })}
        description={ws.workspace.name}
      />
      <ul className="grid auto-rows-fr grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k) => (
          <li key={k.label} className="rounded-xl border bg-card p-4 shadow-card">
            <p className="text-sm text-muted-foreground">{k.label}</p>
            <p className="mt-1 text-3xl font-bold ltr-nums">{k.value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{k.hint}</p>
          </li>
        ))}
      </ul>
      <section aria-labelledby="dashboard-shortcuts" className="space-y-3 pt-2">
        <h2 id="dashboard-shortcuts" className="text-base font-semibold">
          {t("quickActions")}
        </h2>
        <div className="grid auto-rows-fr gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {shortcuts.map(({ label, to, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="group flex min-h-20 items-center gap-3 rounded-xl border bg-card p-4 shadow-card transition-colors hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
                <Icon aria-hidden="true" className="size-5" />
              </span>
              <span className="flex-1 text-sm font-semibold">{label}</span>
              <ChevronRight
                aria-hidden="true"
                className={`size-4 text-muted-foreground transition-transform group-hover:text-primary ${dir === "rtl" ? "rotate-180" : ""}`}
              />
            </Link>
          ))}
        </div>
      </section>
      <section className="space-y-3 pt-2" aria-labelledby="speed-to-lead">
        <h2 id="speed-to-lead" className="text-base font-semibold">
          {t("speedToLead")}
        </h2>
        <div className="grid auto-rows-fr gap-4 sm:grid-cols-2">
          <div className="rounded-xl border bg-card p-4 shadow-card">
            <p className="text-sm text-muted-foreground">{t("responseAverage")}</p>
            <p className="mt-1 text-2xl font-bold">
              {(() => {
                const values = (response.data ?? [])
                  .map((row) => row.average_minutes)
                  .filter((value): value is number => value != null);
                return values.length
                  ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1) +
                      " " +
                      t("minutes")
                  : "—";
              })()}
            </p>
          </div>
          <div className="rounded-xl border bg-card p-4 shadow-card">
            <p className="text-sm text-muted-foreground">{t("waitingOverFive")}</p>
            <p className="mt-1 text-2xl font-bold">
              {(response.data ?? []).reduce(
                (sum, row) => sum + Number(row.waiting_over_five || 0),
                0,
              )}
            </p>
          </div>
        </div>
        <div className="overflow-auto rounded-lg border bg-card">
          <table className="data-table w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-3 text-start">{t("assignedTo")}</th>
                <th className="p-3 text-start">{t("responseAverage")}</th>
                <th className="p-3 text-start">{t("waitingOverFive")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(response.data ?? []).map((row) => {
                const member = ws.members.find((item) => item.user_id === row.agent_id);
                const name = row.agent_id
                  ? member?.full_name ||
                    (row.agent_id === ws.userId ? ws.email : row.agent_id.slice(0, 8))
                  : t("unassigned");
                return (
                  <tr key={row.agent_id ?? "unassigned"}>
                    <td className="p-3">{name}</td>
                    <td className="p-3">
                      {row.average_minutes == null ? "—" : row.average_minutes + " " + t("minutes")}
                    </td>
                    <td className="p-3">{row.waiting_over_five}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <ColdLeadRevival />
      <AgentTargets />
    </div>
  );
}

/** Cold-lead revival: leads untouched 30+ days, with a WhatsApp action reusing WhatsAppDialog. */
function ColdLeadRevival() {
  const { t, dir } = useI18n();
  const L = (ar: string, en: string) => (dir === "rtl" ? ar : en);
  const ws = useWorkspaceData();
  const [waLead, setWaLead] = useState<{
    id: string;
    full_name: string;
    phone: string;
    interested_project: string | null;
  } | null>(null);
  const revivalQuery = useQuery({
    queryKey: ["revival", ws.workspace.id],
    queryFn: async () => {
      const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
      const { data, error } = await (supabase as any)
        .from("leads")
        .select("id, full_name, phone, interested_project, updated_at, archived_at")
        .eq("workspace_id", ws.workspace.id)
        .is("archived_at", null)
        .lt("updated_at", cutoff)
        .order("updated_at", { ascending: true })
        .limit(20);
      if (error) throw error;
      return revivalCandidates(
        (data ?? []) as {
          id: string;
          full_name: string;
          phone: string;
          interested_project: string | null;
          updated_at: string;
          archived_at: string | null;
        }[],
      );
    },
  });
  const rows = revivalQuery.data ?? [];
  return (
    <section className="space-y-3 pt-2" aria-labelledby="cold-leads">
      <h2 id="cold-leads" className="text-base font-semibold">
        {L("عملاء لم نتواصل معهم منذ 30 يومًا", "Cold leads — untouched 30+ days")}
      </h2>
      {revivalQuery.isPending ? (
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      ) : revivalQuery.isError ? (
        <p className="text-sm text-destructive">{t("somethingWrong")}</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          {L("لا يوجد عملاء باردون حاليًا.", "No cold leads right now.")}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((lead) => (
            <li
              key={lead.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-3"
            >
              <Link
                to="/leads/$leadId"
                params={{ leadId: lead.id }}
                className="text-sm font-medium hover:underline"
              >
                {lead.full_name}
              </Link>
              <span className="text-xs text-muted-foreground">
                {L("آخر تحديث منذ", "Idle for")} {daysIdle(lead.updated_at)} {L("يوم", "days")}
              </span>
              <Button size="sm" variant="whatsapp" onClick={() => setWaLead(lead)}>
                <MessageCircle className="h-4 w-4" />
                {t("whatsapp")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {waLead && (
        <WhatsAppDialog
          lead={waLead}
          open={waLead !== null}
          onOpenChange={(open) => !open && setWaLead(null)}
        />
      )}
    </section>
  );
}

/** Agent targets: monthly target_leads / target_revenue vs actual won deals (via leads.assigned_to). */
function AgentTargets() {
  const { t, dir, locale } = useI18n();
  const L = (ar: string, en: string) => (dir === "rtl" ? ar : en);
  const ws = useWorkspaceData();
  const qc = useQueryClient();
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const [agentId, setAgentId] = useState("");
  const [targetLeads, setTargetLeads] = useState("");
  const [targetRevenue, setTargetRevenue] = useState("");
  const isOwner = ws.role === "owner";

  const targetsQuery = useQuery({
    queryKey: ["agent-targets", ws.workspace.id, month],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("agent_targets")
        .select("agent_id, month, target_leads, target_revenue")
        .eq("workspace_id", ws.workspace.id)
        .eq("month", month);
      if (error) throw error;
      return (data ?? []) as {
        agent_id: string;
        month: string;
        target_leads: number;
        target_revenue: number;
      }[];
    },
  });
  const actualQuery = useQuery({
    queryKey: ["agent-targets-actual", ws.workspace.id, month],
    queryFn: async () => {
      const from = `${month}T00:00:00Z`;
      const { data: deals, error } = await (supabase as any)
        .from("deals")
        .select("lead_id, value_egp, created_at")
        .eq("workspace_id", ws.workspace.id)
        .eq("stage", "won")
        .gte("created_at", from);
      if (error) throw error;
      const won = (deals ?? []) as { lead_id: string; value_egp: number }[];
      if (won.length === 0) return new Map<string, { count: number; value: number }>();
      const { data: leads, error: leadsError } = await (supabase as any)
        .from("leads")
        .select("id, assigned_to")
        .eq("workspace_id", ws.workspace.id)
        .in("id", [...new Set(won.map((d) => d.lead_id))]);
      if (leadsError) throw leadsError;
      const assignee = new Map<string, string | null>(
        ((leads ?? []) as { id: string; assigned_to: string | null }[]).map((l) => [
          l.id,
          l.assigned_to,
        ]),
      );
      const out = new Map<string, { count: number; value: number }>();
      for (const deal of won) {
        const agent = assignee.get(deal.lead_id);
        if (!agent) continue;
        const cur = out.get(agent) ?? { count: 0, value: 0 };
        cur.count += 1;
        cur.value += Number(deal.value_egp) || 0;
        out.set(agent, cur);
      }
      return out;
    },
  });

  const saveTarget = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).from("agent_targets").upsert(
        {
          workspace_id: ws.workspace.id,
          agent_id: agentId,
          month,
          target_leads: Number(targetLeads) || 0,
          target_revenue: Number(targetRevenue) || 0,
        },
        { onConflict: "workspace_id,agent_id,month" },
      );
      if (error) throw error;
    },
    onSuccess: async () => {
      setAgentId("");
      setTargetLeads("");
      setTargetRevenue("");
      await qc.invalidateQueries({ queryKey: ["agent-targets", ws.workspace.id, month] });
      toast.success(L("تم حفظ الهدف.", "Target saved."));
    },
    onError: () => toast.error(t("somethingWrong")),
  });

  const rows = (targetsQuery.data ?? []).map((row) => ({
    ...row,
    actual: actualQuery.data?.get(row.agent_id) ?? { count: 0, value: 0 },
  }));
  return (
    <section className="space-y-3 pt-2" aria-labelledby="agent-targets">
      <h2 id="agent-targets" className="flex items-center gap-2 text-base font-semibold">
        <Target className="h-4 w-4 text-muted-foreground" />
        {L("أهداف الوكلاء — هذا الشهر", "Agent targets — this month")}
      </h2>
      {isOwner && (
        <form
          className="flex flex-wrap items-end gap-2 rounded-xl border bg-card p-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (agentId) saveTarget.mutate();
          }}
        >
          <div className="space-y-1">
            <Label>{t("assignedTo")}</Label>
            <NativeSelect
              value={agentId}
              onChange={(event) => setAgentId(event.target.value)}
              className="w-48"
            >
              <option value="">{L("اختر وكيلًا", "Choose an agent")}</option>
              {ws.members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.full_name || (m.user_id === ws.userId ? ws.email : m.user_id.slice(0, 8))}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label>{L("هدف العملاء", "Leads target")}</Label>
            <Input
              type="number"
              min="0"
              value={targetLeads}
              onChange={(event) => setTargetLeads(event.target.value)}
              className="w-28"
            />
          </div>
          <div className="space-y-1">
            <Label>{L("هدف الإيراد (ج.م)", "Revenue target (EGP)")}</Label>
            <Input
              type="number"
              min="0"
              value={targetRevenue}
              onChange={(event) => setTargetRevenue(event.target.value)}
              className="w-36"
            />
          </div>
          <Button type="submit" size="sm" disabled={!agentId || saveTarget.isPending}>
            {t("saveChanges")}
          </Button>
        </form>
      )}
      {targetsQuery.isPending ? (
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          {L("لا توجد أهداف محددة لهذا الشهر بعد.", "No targets set for this month yet.")}
        </p>
      ) : (
        <div className="overflow-auto rounded-lg border bg-card">
          <table className="data-table w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-3 text-start">{t("assignedTo")}</th>
                <th className="p-3 text-start">{L("الهدف (عملاء)", "Target (leads)")}</th>
                <th className="p-3 text-start">{L("الفعلي (عملاء)", "Actual (leads)")}</th>
                <th className="p-3 text-start">{L("الهدف (إيراد)", "Target (revenue)")}</th>
                <th className="p-3 text-start">{L("الفعلي (إيراد)", "Actual (revenue)")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => {
                const member = ws.members.find((m) => m.user_id === row.agent_id);
                const name =
                  member?.full_name ||
                  (row.agent_id === ws.userId ? ws.email : row.agent_id.slice(0, 8));
                return (
                  <tr key={row.agent_id}>
                    <td className="p-3">{name}</td>
                    <td className="p-3">{row.target_leads}</td>
                    <td className="p-3">{row.actual.count}</td>
                    <td className="p-3">{formatMoney(row.target_revenue, locale)}</td>
                    <td className="p-3">{formatMoney(row.actual.value, locale)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
