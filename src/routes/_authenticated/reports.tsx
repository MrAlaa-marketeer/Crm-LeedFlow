import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Download, FileBarChart2 } from "lucide-react";

import { EmptyState, ErrorState, ListSkeleton, PageHeader } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceData } from "@/hooks/use-workspace";
import { useI18n } from "@/lib/i18n";
import { sourceKey, statusKey, LEAD_SOURCES, LEAD_STATUSES, formatMoney } from "@/lib/leads";
import { inventoryDb, type Project } from "@/lib/inventory-client";
import {
  parseReport,
  reportDateBounds,
  type ReportData,
  type ReportFilters,
} from "@/lib/report-analytics";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "التقارير والتحليلات — LeadFlow | Reports & analytics" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ReportsPage,
});

const reportDb = supabase as unknown as {
  rpc: (
    name: "report_analytics",
    args: {
      _workspace_id: string;
      _from: string;
      _to: string;
      _assigned_to: string | null;
      _source: string | null;
      _project_id: string | null;
      _status: string | null;
      _timezone: string;
    },
  ) => Promise<{ data: unknown; error: Error | null }>;
};

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function csvCell(value: string | number) {
  const raw = String(value);
  const text = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${text.replaceAll('"', '""')}"`;
}

function exportReport(report: ReportData, filters: ReportFilters, locale: string) {
  const rows: (string | number)[][] = [["section", "name", "value"]];
  Object.entries(report.kpis).forEach(([name, value]) => rows.push(["kpi", name, value]));
  report.by_status.forEach((row) => rows.push(["status", row.name, row.count]));
  report.by_source.forEach((row) => rows.push(["source", row.name, row.count]));
  report.monthly.forEach((row) =>
    rows.push([
      "month",
      row.month,
      `${row.total}; qualified=${row.qualified}; won=${row.won}; lost=${row.lost}`,
    ]),
  );
  report.employees.forEach((row) =>
    rows.push([
      "employee",
      row.full_name ?? row.user_id,
      `${row.lead_count}; won=${row.won_count}; lost=${row.lost_count}; follow-ups completed=${row.completed_follow_up_count}`,
    ]),
  );
  report.projects.forEach((row) =>
    rows.push([
      "project",
      row.project_name,
      `${row.lead_count}; won=${row.won_count}; linked units=${row.linked_unit_interest_count}`,
    ]),
  );
  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `leadflow-reports-${filters.from}-to-${filters.to}-${locale}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function ReportsPage() {
  const { t, dir, locale } = useI18n();
  const ws = useWorkspaceData();
  const [filters, setFilters] = useState<ReportFilters>(() => {
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - 29);
    return {
      from: localDateKey(from),
      to: localDateKey(to),
      assignedTo: "all",
      source: "all",
      projectId: "all",
      status: "all",
    };
  });
  const validRange = Boolean(filters.from && filters.to && filters.from <= filters.to);

  const projectsQuery = useQuery({
    queryKey: ["reports", "projects", ws.workspace.id],
    queryFn: async () => {
      const { data, error } = await inventoryDb
        .from("projects")
        .select("id, name")
        .eq("workspace_id", ws.workspace.id)
        .order("name")
        .limit(500);
      if (error) throw error;
      return (data ?? []) as Pick<Project, "id" | "name">[];
    },
  });
  const reportQuery = useQuery({
    queryKey: ["reports", ws.workspace.id, filters],
    enabled: validRange,
    queryFn: async () => {
      const bounds = reportDateBounds(filters.from, filters.to);
      const { data, error } = await reportDb.rpc("report_analytics", {
        _workspace_id: ws.workspace.id,
        _from: bounds.from,
        _to: bounds.to,
        _assigned_to: filters.assignedTo === "all" ? null : filters.assignedTo,
        _source: filters.source === "all" ? null : filters.source,
        _project_id: filters.projectId === "all" ? null : filters.projectId,
        _status: filters.status === "all" ? null : filters.status,
        _timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      });
      if (error) throw error;
      return parseReport(data);
    },
  });
  const report = reportQuery.data;
  const monthRows = useMemo(
    () =>
      (report?.monthly ?? []).map((row) => ({
        ...row,
        month: new Intl.DateTimeFormat(locale, { month: "short", year: "2-digit" }).format(
          new Date(row.month),
        ),
      })),
    [report?.monthly, locale],
  );
  const statusRows = useMemo(
    () =>
      (report?.by_status ?? []).map((row) => ({
        ...row,
        name: t(statusKey(row.name as (typeof LEAD_STATUSES)[number])),
      })),
    [report?.by_status, t],
  );
  const sourceRows = useMemo(
    () =>
      (report?.by_source ?? []).map((row) => ({
        ...row,
        name: t(sourceKey(row.name as (typeof LEAD_SOURCES)[number])),
      })),
    [report?.by_source, t],
  );
  const setFilter = (key: keyof ReportFilters, value: string) =>
    setFilters((current) => ({ ...current, [key]: value }));

  const kpiCards = report
    ? ([
        [t("reportTotalLeads"), report.kpis.total_leads],
        [t("reportNewLeads"), report.kpis.new_leads],
        [t("reportQualifiedLeads"), report.kpis.qualified_leads],
        [t("reportWonLeads"), report.kpis.won_leads],
        [t("reportLostLeads"), report.kpis.lost_leads],
        [t("reportConversion"), `${report.kpis.conversion_rate}%`],
        [t("reportOpenFollowups"), report.kpis.open_follow_ups],
        [t("reportOverdueFollowups"), report.kpis.overdue_follow_ups],
        [t("reportCompletedFollowups"), report.kpis.completed_follow_ups],
        [t("reportBudgetDemand"), formatMoney(report.kpis.lead_budget_max_sum, locale)],
      ] as const)
    : [];

  return (
    <main className="space-y-6" dir={dir}>
      <PageHeader title={t("reportsTitle")} description={t("reportsSubtitle")}>
        <Button
          variant="outline"
          disabled={!report}
          onClick={() => report && exportReport(report, filters, locale)}
        >
          <Download className="me-2 h-4 w-4" />
          {t("exportReport")}
        </Button>
      </PageHeader>

      <section className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-6">
        <div className="space-y-1">
          <Label htmlFor="report-from">{t("reportFrom")}</Label>
          <input
            id="report-from"
            type="date"
            value={filters.from}
            max={filters.to}
            onChange={(event) => setFilter("from", event.target.value)}
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="report-to">{t("reportTo")}</Label>
          <input
            id="report-to"
            type="date"
            value={filters.to}
            min={filters.from}
            onChange={(event) => setFilter("to", event.target.value)}
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          />
        </div>
        {ws.role === "owner" && (
          <div className="space-y-1">
            <Label htmlFor="report-employee">{t("reportEmployee")}</Label>
            <NativeSelect
              id="report-employee"
              value={filters.assignedTo}
              onChange={(event) => setFilter("assignedTo", event.target.value)}
            >
              <option value="all">{t("allAgents")}</option>
              {ws.members.map((member) => (
                <option value={member.user_id} key={member.user_id}>
                  {member.full_name || member.user_id.slice(0, 8)}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
        <div className="space-y-1">
          <Label htmlFor="report-source">{t("source")}</Label>
          <NativeSelect
            id="report-source"
            value={filters.source}
            onChange={(event) => setFilter("source", event.target.value)}
          >
            <option value="all">{t("allSources")}</option>
            {LEAD_SOURCES.map((source) => (
              <option value={source} key={source}>
                {t(sourceKey(source))}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="report-project">{t("project")}</Label>
          <NativeSelect
            id="report-project"
            value={filters.projectId}
            onChange={(event) => setFilter("projectId", event.target.value)}
            disabled={projectsQuery.isLoading}
          >
            <option value="all">{t("allProjects")}</option>
            {projectsQuery.data?.map((project) => (
              <option value={project.id} key={project.id}>
                {project.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="report-status">{t("status")}</Label>
          <NativeSelect
            id="report-status"
            value={filters.status}
            onChange={(event) => setFilter("status", event.target.value)}
          >
            <option value="all">{t("allStatuses")}</option>
            {LEAD_STATUSES.map((status) => (
              <option value={status} key={status}>
                {t(statusKey(status))}
              </option>
            ))}
          </NativeSelect>
        </div>
      </section>
      {projectsQuery.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t("reportProjectFilterError")}
        </p>
      )}

      {!validRange ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive-soft p-3 text-sm"
        >
          {t("reportInvalidRange")}
        </p>
      ) : reportQuery.isPending ? (
        <ListSkeleton rows={5} />
      ) : reportQuery.isError ? (
        <ErrorState error={reportQuery.error} onRetry={() => void reportQuery.refetch()} />
      ) : report ? (
        <>
          <p className="text-xs text-muted-foreground">{t("reportMetricDefinitions")}</p>
          <section
            aria-label={t("reportsTitle")}
            className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5"
          >
            {kpiCards.map(([label, value]) => (
              <article key={label} className="rounded-xl border bg-card p-4 shadow-sm">
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="mt-2 break-words text-2xl font-bold ltr-nums">{value}</p>
              </article>
            ))}
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <article className="rounded-xl border bg-card p-4">
              <h2 className="mb-3 font-semibold">{t("reportMonthlyPerformance")}</h2>
              {monthRows.length ? (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={monthRows}
                      margin={{ top: 5, right: 12, left: -18, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Line
                        type="monotone"
                        dataKey="total"
                        name={t("reportTotalLeads")}
                        stroke="var(--chart-1)"
                        strokeWidth={2}
                      />
                      <Line
                        type="monotone"
                        dataKey="qualified"
                        name={t("reportQualifiedLeads")}
                        stroke="var(--chart-2)"
                        strokeWidth={2}
                      />
                      <Line
                        type="monotone"
                        dataKey="won"
                        name={t("reportWonLeads")}
                        stroke="var(--chart-3)"
                        strokeWidth={2}
                      />
                      <Line
                        type="monotone"
                        dataKey="lost"
                        name={t("reportLostLeads")}
                        stroke="var(--destructive)"
                        strokeWidth={2}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState icon={FileBarChart2} title={t("reportNoData")} />
              )}
            </article>
            <article className="rounded-xl border bg-card p-4">
              <h2 className="mb-3 font-semibold">{t("reportByStatus")}</h2>
              {statusRows.length ? (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={statusRows}
                      margin={{ top: 5, right: 12, left: -18, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Bar
                        dataKey="count"
                        name={t("reportLeadsCount")}
                        fill="var(--chart-1)"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState icon={FileBarChart2} title={t("reportNoData")} />
              )}
            </article>
            <article className="rounded-xl border bg-card p-4">
              <h2 className="mb-3 font-semibold">{t("reportBySource")}</h2>
              {sourceRows.length ? (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={sourceRows}
                      margin={{ top: 5, right: 12, left: -18, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Bar
                        dataKey="count"
                        name={t("reportLeadsCount")}
                        fill="var(--chart-3)"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState icon={FileBarChart2} title={t("reportNoData")} />
              )}
            </article>
            <article className="rounded-xl border bg-card p-4">
              <h2 className="mb-3 font-semibold">{t("reportPipelineFunnel")}</h2>
              <p className="mb-3 text-xs text-muted-foreground">{t("reportFunnelDefinition")}</p>
              {statusRows.length ? (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={statusRows}
                      layout="vertical"
                      margin={{ top: 5, right: 12, left: 10, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" allowDecimals={false} />
                      <YAxis type="category" dataKey="name" width={95} />
                      <Tooltip />
                      <Bar
                        dataKey="count"
                        name={t("reportLeadsCount")}
                        fill="var(--chart-2)"
                        radius={[0, 4, 4, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState icon={FileBarChart2} title={t("reportNoData")} />
              )}
            </article>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <article className="rounded-xl border bg-card p-4">
              <h2 className="mb-3 font-semibold">{t("reportEmployeeAnalytics")}</h2>
              {report.employees.length ? (
                <div className="overflow-x-auto">
                  <table className="data-table w-full min-w-[600px] text-start text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        {[
                          "member",
                          "reportLeadsCount",
                          "reportWonLeads",
                          "reportLostLeads",
                          "reportCompletedFollowups",
                        ].map((key) => (
                          <th className="p-3" key={key}>
                            {t(key as never)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {report.employees.map((employee) => (
                        <tr className="border-b last:border-0" key={employee.user_id}>
                          <td className="p-3">{employee.full_name || t("member")}</td>
                          <td className="p-3">{employee.lead_count}</td>
                          <td className="p-3">{employee.won_count}</td>
                          <td className="p-3">{employee.lost_count}</td>
                          <td className="p-3">{employee.completed_follow_up_count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState icon={FileBarChart2} title={t("reportNoData")} />
              )}
            </article>
            <article className="rounded-xl border bg-card p-4">
              <h2 className="mb-3 font-semibold">{t("reportProjectAnalytics")}</h2>
              {report.projects.length ? (
                <div className="overflow-x-auto">
                  <table className="data-table w-full min-w-[520px] text-start text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        {["project", "reportLeadsCount", "reportWonLeads", "reportLinkedUnits"].map(
                          (key) => (
                            <th className="p-3" key={key}>
                              {t(key as never)}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {report.projects.map((project) => (
                        <tr className="border-b last:border-0" key={project.project_id}>
                          <td className="p-3">{project.project_name}</td>
                          <td className="p-3">{project.lead_count}</td>
                          <td className="p-3">{project.won_count}</td>
                          <td className="p-3">{project.linked_unit_interest_count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState icon={FileBarChart2} title={t("reportNoData")} />
              )}
            </article>
          </section>
          <ReferralsSection />
          <aside className="rounded-xl border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
            {t("reportLimits")}
          </aside>
        </>
      ) : null}
    </main>
  );
}

type ReferralRow = {
  id: string;
  referrer_lead_id: string | null;
  referred_lead_id: string | null;
  reward_egp: number;
  status: string;
  created_at: string;
};

/**
 * Referrals (`referrals`): who referred whom, reward and status.
 * NOTE: the table stores lead ids only (referrer_lead_id / referred_lead_id),
 * so both sides are picked from existing workspace leads — there is no
 * name/phone column for a referred person who is not a lead yet.
 */
function ReferralsSection() {
  const { t, dir, locale } = useI18n();
  const L = (ar: string, en: string) => (dir === "rtl" ? ar : en);
  const ws = useWorkspaceData();
  const qc = useQueryClient();
  const [referrerId, setReferrerId] = useState("");
  const [referredId, setReferredId] = useState("");
  const [reward, setReward] = useState("");
  const [status, setStatus] = useState("pending");

  const leadsQuery = useQuery({
    queryKey: ["reports", "referral-leads", ws.workspace.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("leads")
        .select("id, full_name, phone")
        .eq("workspace_id", ws.workspace.id)
        .is("archived_at", null)
        .order("full_name")
        .limit(500);
      if (error) throw error;
      return (data ?? []) as { id: string; full_name: string; phone: string }[];
    },
  });
  const referralsQuery = useQuery({
    queryKey: ["referrals", ws.workspace.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("referrals")
        .select("id, referrer_lead_id, referred_lead_id, reward_egp, status, created_at")
        .eq("workspace_id", ws.workspace.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ReferralRow[];
    },
  });
  const leadName = (id: string | null) =>
    (leadsQuery.data ?? []).find((l) => l.id === id)?.full_name ?? "—";

  const createMutation = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).from("referrals").insert({
        workspace_id: ws.workspace.id,
        referrer_lead_id: referrerId || null,
        referred_lead_id: referredId || null,
        reward_egp: Number(reward) || 0,
        status,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setReferrerId("");
      setReferredId("");
      setReward("");
      setStatus("pending");
      await qc.invalidateQueries({ queryKey: ["referrals", ws.workspace.id] });
      toast.success(L("تم تسجيل الإحالة.", "Referral recorded."));
    },
    onError: () => toast.error(t("somethingWrong")),
  });
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from("referrals")
        .delete()
        .eq("id", id)
        .eq("workspace_id", ws.workspace.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["referrals", ws.workspace.id] });
      toast.success(L("تم حذف الإحالة.", "Referral deleted."));
    },
    onError: () => toast.error(t("somethingWrong")),
  });

  return (
    <section className="rounded-xl border bg-card p-4" aria-labelledby="referrals-title">
      <h2 id="referrals-title" className="mb-3 font-semibold">
        {L("الإحالات", "Referrals")}
        <span className="ms-2 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
          {(referralsQuery.data ?? []).length}
        </span>
      </h2>
      <form
        className="mb-4 flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (referrerId && referredId && referrerId !== referredId) createMutation.mutate();
        }}
      >
        <div className="space-y-1">
          <Label>{L("المُحيل", "Referrer")}</Label>
          <NativeSelect
            value={referrerId}
            onChange={(event) => setReferrerId(event.target.value)}
            className="w-48"
          >
            <option value="">{L("اختر عميلًا", "Choose a lead")}</option>
            {(leadsQuery.data ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.full_name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label>{L("المُحال إليه", "Referred lead")}</Label>
          <NativeSelect
            value={referredId}
            onChange={(event) => setReferredId(event.target.value)}
            className="w-48"
          >
            <option value="">{L("اختر عميلًا", "Choose a lead")}</option>
            {(leadsQuery.data ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.full_name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label>{L("المكافأة (ج.م)", "Reward (EGP)")}</Label>
          <Input
            type="number"
            min="0"
            value={reward}
            onChange={(event) => setReward(event.target.value)}
            className="w-28"
          />
        </div>
        <div className="space-y-1">
          <Label>{t("status")}</Label>
          <NativeSelect value={status} onChange={(event) => setStatus(event.target.value)}>
            {["pending", "converted", "rewarded"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button
          type="submit"
          size="sm"
          disabled={
            !referrerId || !referredId || referrerId === referredId || createMutation.isPending
          }
        >
          {L("تسجيل إحالة", "Record referral")}
        </Button>
      </form>
      {referralsQuery.isPending ? (
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      ) : referralsQuery.isError ? (
        <p className="text-sm text-destructive">{t("somethingWrong")}</p>
      ) : (referralsQuery.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {L("لا توجد إحالات بعد.", "No referrals yet.")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table w-full min-w-[520px] text-start text-sm">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="p-3">{L("المُحيل", "Referrer")}</th>
                <th className="p-3">{L("المُحال إليه", "Referred lead")}</th>
                <th className="p-3">{L("المكافأة", "Reward")}</th>
                <th className="p-3">{t("status")}</th>
                <th className="p-3">{t("actions")}</th>
              </tr>
            </thead>
            <tbody>
              {(referralsQuery.data ?? []).map((row) => (
                <tr className="border-b last:border-0" key={row.id}>
                  <td className="p-3">{leadName(row.referrer_lead_id)}</td>
                  <td className="p-3">{leadName(row.referred_lead_id)}</td>
                  <td className="p-3">{formatMoney(row.reward_egp, locale)}</td>
                  <td className="p-3">{row.status}</td>
                  <td className="p-3">
                    {ws.role === "owner" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        disabled={deleteMutation.isPending}
                        onClick={() => deleteMutation.mutate(row.id)}
                      >
                        {t("delete")}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
