import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { LayoutGrid, List, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { DemoBadge } from "@/components/app/badges";
import { EmptyState, ErrorState, ListSkeleton, PageHeader } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useWorkspaceData } from "@/hooks/use-workspace";
import { useI18n } from "@/lib/i18n";
import {
  formatBudget,
  formatDateTime,
  LEAD_SOURCES,
  LEAD_STATUSES,
  STATUS_STYLES,
  sourceKey,
  type LeadStatus,
  statusKey,
} from "@/lib/leads";
import {
  invalidateLeadData,
  mutationErrorKey,
  PIPELINE_LIMIT,
  pipelineQuery,
  type PipelineFilters,
  updateLeadStatus,
} from "@/lib/queries";
import { groupPipelineLeads, pipelineWinRate } from "@/lib/pipeline";

export const Route = createFileRoute("/_authenticated/pipeline")({
  head: () => ({
    meta: [
      { title: "مراحل البيع — LeadFlow | Pipeline" },
      { name: "description", content: "Track leads through your agency sales pipeline." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PipelinePage,
});

type PipelineView = "board" | "list";
const EMPTY_FILTERS: PipelineFilters = {
  q: "",
  source: "",
  assignee: "",
  project: "",
  fromDate: "",
  toDate: "",
};

function PipelinePage() {
  const { t, locale, dir } = useI18n();
  const workspace = useWorkspaceData();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [view, setView] = useState<PipelineView>("board");
  const [draggedLeadId, setDraggedLeadId] = useState<string | null>(null);
  const [rowsLimit, setRowsLimit] = useState(PIPELINE_LIMIT);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(filters.q), 300);
    return () => window.clearTimeout(timer);
  }, [filters.q]);

  const activeFilters = useMemo(
    () => ({ ...filters, q: debouncedSearch }),
    [filters, debouncedSearch],
  );
  const query = useQuery(pipelineQuery(workspace.workspace.id, activeFilters, rowsLimit));
  const moveMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: LeadStatus }) =>
      updateLeadStatus(id, status),
    onSuccess: async () => {
      await invalidateLeadData(queryClient);
      toast.success(t("statusSaved"));
    },
    onError: (error) => {
      toast.error(t("somethingWrong"), {
        description: mutationErrorKey(error) ? t(mutationErrorKey(error)!) : t("somethingWrong"),
      });
    },
  });

  if (query.isPending) return <ListSkeleton rows={7} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => router.invalidate()} />;

  const { rows, stageCounts, total, truncated } = query.data;
  const byStatus = groupPipelineLeads(rows);
  const wonRate = pipelineWinRate(stageCounts);
  const selectedDatesInvalid =
    !!filters.fromDate && !!filters.toDate && filters.fromDate > filters.toDate;

  function setFilter<K extends keyof PipelineFilters>(key: K, value: PipelineFilters[K]) {
    setFilters((previous) => ({ ...previous, [key]: value }));
    setRowsLimit(PIPELINE_LIMIT);
  }

  function moveLead(id: string, status: LeadStatus) {
    const lead = rows.find((item) => item.id === id);
    if (!lead || lead.status === status || moveMutation.isPending) return;
    moveMutation.mutate({ id, status });
  }

  function StatusControl({ id, name, status }: { id: string; name: string; status: LeadStatus }) {
    return (
      <>
        <label className="sr-only" htmlFor={`lead-status-${id}`}>
          {t("statusFor", { name })}
        </label>
        <NativeSelect
          id={`lead-status-${id}`}
          value={status}
          disabled={moveMutation.isPending}
          onChange={(event) => moveLead(id, event.target.value as LeadStatus)}
          className="h-8 w-full text-xs"
        >
          {LEAD_STATUSES.map((option) => (
            <option key={option} value={option}>
              {t(statusKey(option))}
            </option>
          ))}
        </NativeSelect>
      </>
    );
  }

  function LeadCard({ lead }: { lead: (typeof rows)[number] }) {
    const assignee = lead.assigned_to
      ? (workspace.members.find((member) => member.user_id === lead.assigned_to)?.full_name ??
        t("member"))
      : t("unassigned");
    return (
      <article
        draggable
        onDragStart={() => setDraggedLeadId(lead.id)}
        onDragEnd={() => setDraggedLeadId(null)}
        className="rounded-lg border bg-card p-3 shadow-sm transition-shadow hover:shadow-md"
      >
        <div className="flex items-start justify-between gap-2">
          <Link
            to="/leads/$leadId"
            params={{ leadId: lead.id }}
            className="min-w-0 truncate text-sm font-semibold text-foreground hover:text-primary hover:underline"
          >
            {lead.full_name}
          </Link>
          {lead.is_demo && <DemoBadge />}
        </div>
        <p dir="ltr" className="mt-1 text-start text-xs text-muted-foreground">
          {lead.phone}
        </p>
        {lead.interested_project && (
          <p className="mt-1 truncate text-xs text-muted-foreground">{lead.interested_project}</p>
        )}
        <p className="mt-2 text-xs font-medium text-foreground">
          {formatBudget(lead.budget_min, lead.budget_max, locale) || t("noValue")}
        </p>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {t("assignedTo")}: {assignee}
        </p>
        {lead.next_follow_up_at && (
          <p className="mt-1 text-xs text-muted-foreground">
            {t("dueLabel", { date: formatDateTime(lead.next_follow_up_at, locale) })}
          </p>
        )}
        {(lead.status === "won" || lead.status === "lost") && lead.notes && (
          <p className="mt-2 line-clamp-2 border-t pt-2 text-xs text-muted-foreground">
            {lead.notes}
          </p>
        )}
        <div className="mt-3 border-t pt-2">
          <StatusControl id={lead.id} name={lead.full_name} status={lead.status} />
        </div>
      </article>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("pipelineTitle")} description={t("pipelineHint")} />

      <section
        aria-label={t("pipelineMetrics")}
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        <Metric label={t("pipelineTotalLeads")} value={total} />
        <Metric label={t("pipelineWonCount")} value={stageCounts.won} />
        <Metric label={t("pipelineLostCount")} value={stageCounts.lost} />
        <Metric
          label={t("pipelineWinRate")}
          value={wonRate == null ? t("convNA") : `${wonRate}%`}
        />
      </section>

      <section className="space-y-3 rounded-xl border bg-card p-3" aria-label={t("filtersLabel")}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Input
            aria-label={t("searchPipeline")}
            placeholder={t("searchPipeline")}
            value={filters.q}
            onChange={(event) => setFilter("q", event.target.value)}
          />
          <NativeSelect
            aria-label={t("source")}
            value={filters.source}
            onChange={(event) =>
              setFilter("source", event.target.value as PipelineFilters["source"])
            }
          >
            <option value="">{t("allSources")}</option>
            {LEAD_SOURCES.map((source) => (
              <option key={source} value={source}>
                {t(sourceKey(source))}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label={t("assignedTo")}
            value={filters.assignee}
            onChange={(event) => setFilter("assignee", event.target.value)}
          >
            <option value="">{t("allAgents")}</option>
            <option value="none">{t("unassigned")}</option>
            {workspace.members.map((member) => (
              <option key={member.user_id} value={member.user_id}>
                {member.full_name || member.user_id.slice(0, 8)}
              </option>
            ))}
          </NativeSelect>
          <Input
            aria-label={t("projectFilter")}
            placeholder={t("projectFilter")}
            value={filters.project}
            onChange={(event) => setFilter("project", event.target.value)}
          />
          <Input
            aria-label={t("fromDate")}
            type="date"
            value={filters.fromDate}
            onChange={(event) => setFilter("fromDate", event.target.value)}
          />
          <Input
            aria-label={t("toDate")}
            type="date"
            value={filters.toDate}
            onChange={(event) => setFilter("toDate", event.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {t("pipelineFilteredCount", { count: total })}
          </p>
          <div
            className="flex items-center gap-1 rounded-lg border p-1"
            role="group"
            aria-label={t("viewLabel")}
          >
            <Button
              type="button"
              size="sm"
              variant={view === "board" ? "default" : "ghost"}
              aria-pressed={view === "board"}
              onClick={() => setView("board")}
            >
              <LayoutGrid className="me-1 h-4 w-4" />
              {t("pipelineBoardView")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={view === "list" ? "default" : "ghost"}
              aria-pressed={view === "list"}
              onClick={() => setView("list")}
            >
              <List className="me-1 h-4 w-4" />
              {t("pipelineListView")}
            </Button>
          </div>
        </div>
        {selectedDatesInvalid && (
          <p role="alert" className="text-sm text-destructive">
            {t("invalidDateRange")}
          </p>
        )}
      </section>

      {truncated && (
        <p
          role="status"
          className="rounded-lg border bg-muted/50 px-4 py-3 text-sm text-muted-foreground"
        >
          {t("pipelineTruncated", { count: rows.length })}
        </p>
      )}

      {total === 0 ? (
        <EmptyState icon={Users} title={t("noLeadsTitle")} body={t("noLeadsBody")} />
      ) : view === "board" ? (
        <div className="overflow-x-auto pb-3" aria-label={t("pipelineTitle")}>
          <div className="grid min-w-max grid-cols-7 items-start gap-3">
            {LEAD_STATUSES.map((status) => {
              const leads = byStatus[status];
              return (
                <section
                  key={status}
                  aria-label={`${t(statusKey(status))}: ${stageCounts[status]}`}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (draggedLeadId) moveLead(draggedLeadId, status);
                    setDraggedLeadId(null);
                  }}
                  className={`w-[260px] rounded-xl border border-t-4 bg-muted/30 p-2.5 ${STATUS_STYLES[status].column}`}
                >
                  <div className="mb-3 flex items-center justify-between gap-2 px-1 py-1">
                    <h2 className="text-sm font-semibold">{t(statusKey(status))}</h2>
                    <span className="rounded-full bg-background px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                      {stageCounts[status]}
                    </span>
                  </div>
                  <div
                    className="min-h-24 space-y-2 rounded-lg"
                    aria-label={t("dropToMove", { status: t(statusKey(status)) })}
                  >
                    {leads.length === 0 ? (
                      <p className="rounded-lg border border-dashed bg-background/60 px-3 py-5 text-center text-xs text-muted-foreground">
                        {t("emptyColumn")}
                      </p>
                    ) : (
                      leads.map((lead) => <LeadCard key={lead.id} lead={lead} />)
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[900px] text-start text-sm">
            <thead className="bg-muted/60 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-3">
                  {t("fullName")}
                </th>
                <th scope="col" className="px-3 py-3">
                  {t("phone")}
                </th>
                <th scope="col" className="px-3 py-3">
                  {t("interestedProject")}
                </th>
                <th scope="col" className="px-3 py-3">
                  {t("colBudget")}
                </th>
                <th scope="col" className="px-3 py-3">
                  {t("assignedTo")}
                </th>
                <th scope="col" className="px-3 py-3">
                  {t("nextFollowUp")}
                </th>
                <th scope="col" className="px-3 py-3">
                  {t("colStatus")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((lead) => {
                const assignee = lead.assigned_to
                  ? (workspace.members.find((member) => member.user_id === lead.assigned_to)
                      ?.full_name ?? t("member"))
                  : t("unassigned");
                return (
                  <tr key={lead.id}>
                    <td className="max-w-[200px] px-3 py-3">
                      <Link
                        to="/leads/$leadId"
                        params={{ leadId: lead.id }}
                        className="font-medium text-primary hover:underline"
                      >
                        {lead.full_name}
                      </Link>
                      {lead.is_demo && (
                        <span className="ms-2">
                          <DemoBadge />
                        </span>
                      )}
                    </td>
                    <td dir="ltr" className="px-3 py-3 text-start">
                      {lead.phone}
                    </td>
                    <td className="max-w-[180px] truncate px-3 py-3">
                      {lead.interested_project || t("noValue")}
                    </td>
                    <td className="px-3 py-3">
                      {formatBudget(lead.budget_min, lead.budget_max, locale) || t("noValue")}
                    </td>
                    <td className="px-3 py-3">{assignee}</td>
                    <td className="px-3 py-3">
                      {lead.next_follow_up_at
                        ? formatDateTime(lead.next_follow_up_at, locale)
                        : t("noValue")}
                    </td>
                    <td className="min-w-40 px-3 py-3">
                      <StatusControl id={lead.id} name={lead.full_name} status={lead.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {truncated && (
        <div className="flex justify-center py-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setRowsLimit((limit) => limit + PIPELINE_LIMIT)}
          >
            {t("pipelineLoadMore", { shown: rows.length, total })}
          </Button>
        </div>
      )}
      <p className="sr-only" aria-live="polite" dir={dir}>
        {moveMutation.isPending ? t("saving") : ""}
      </p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
