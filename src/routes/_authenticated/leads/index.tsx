import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArrowDownToLine,
  ChevronLeft,
  ChevronRight,
  Eye,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Upload,
  UserRoundPlus,
  ListChecks,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import Papa from "papaparse";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Checkbox } from "@/components/ui/checkbox";
import { LeadFormDialog } from "@/components/app/lead-form-dialog";
import { LeadImportDialog } from "@/components/app/lead-import-dialog";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { DemoBadge, SourceBadge, StatusBadge } from "@/components/app/badges";
import { EmptyState, ErrorState, ListSkeleton, PageHeader } from "@/components/app/states";
import { useWorkspaceData } from "@/hooks/use-workspace";
import { useI18n } from "@/lib/i18n";
import {
  LEAD_SOURCES,
  LEAD_STATUSES,
  formatBudget,
  formatDate,
  statusKey,
  type Lead,
  type LeadSource,
  type LeadStatus,
} from "@/lib/leads";
import {
  LEADS_PAGE_SIZE,
  deleteLead,
  fetchLeadsForExport,
  invalidateLeadData,
  leadsListQuery,
  mutationErrorKey,
  setLeadArchived,
  type LeadsView,
} from "@/lib/queries";
import { updateLeadsInBulk, type BulkLeadAction } from "@/lib/lead-batches";
import { scoreLead } from "@/lib/phase-features";
import { SavedSearches } from "@/components/app/saved-searches";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/leads/")({
  head: () => ({
    meta: [
      { title: "العملاء — LeadFlow | Leads" },
      { name: "description", content: "Manage and follow up with your leads." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LeadsPage,
});

function LeadsPage() {
  const { t, locale, dir } = useI18n();
  const ws = useWorkspaceData();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const router = useRouter();

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<LeadStatus | "">("");
  const [source, setSource] = useState<LeadSource | "">("");
  const [assignee, setAssignee] = useState("");
  const [view, setView] = useState<LeadsView>("active");
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | undefined>(undefined);
  const [exporting, setExporting] = useState(false);
  const [archiveLeadId, setArchiveLeadId] = useState<string | null>(null);
  const [deleteLeadId, setDeleteLeadId] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput), 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => setPage(1), [search, status, source, assignee, view]);

  const filters = useMemo(
    () => ({ q: search, status, source, assignee, view, page }),
    [search, status, source, assignee, view, page],
  );
  const leadsQuery = useQuery(leadsListQuery(ws.workspace.id, filters));
  const rows = leadsQuery.data?.rows ?? [];
  const total = leadsQuery.data?.total ?? 0;

  // Persisted lead_scores for the visible page (lead_scores is not in the
  // generated Supabase types, so this uses the `as any` pattern).
  const scoresQuery = useQuery({
    queryKey: ["lead-scores", ws.workspace.id, rows.map((row) => row.id).join(",")],
    enabled: rows.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("lead_scores")
        .select("lead_id, score, band")
        .eq("workspace_id", ws.workspace.id)
        .in(
          "lead_id",
          rows.map((row) => row.id),
        );
      if (error) throw error;
      return new Map(
        ((data ?? []) as { lead_id: string; score: number; band: string }[]).map((row) => [
          row.lead_id,
          row,
        ]),
      );
    },
  });
  const scoreBadge = (lead: Lead) => {
    const stored = scoresQuery.data?.get(lead.id);
    const live = scoreLead({
      budget: lead.budget_max ?? lead.budget_min ?? null,
      timelineDays: null,
      responseMinutes: null,
      interactions: 0,
    });
    const band = stored?.band ?? live.band;
    const score = stored?.score ?? live.score;
    const style =
      band === "hot"
        ? "bg-destructive/10 text-destructive"
        : band === "warm"
          ? "bg-warning/10 text-warning"
          : "bg-muted text-muted-foreground";
    const label =
      dir === "rtl" ? (band === "hot" ? "ساخن" : band === "warm" ? "دافئ" : "بارد") : band;
    return (
      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>
        {label} · {score}
      </span>
    );
  };
  const pages = Math.max(1, Math.ceil(total / LEADS_PAGE_SIZE));
  const selectionScope = JSON.stringify([ws.workspace.id, filters]);
  const [selection, setSelection] = useState<{ scope: string; ids: string[] }>();
  const [bulkAssignee, setBulkAssignee] = useState("");
  const [bulkStatus, setBulkStatus] = useState<LeadStatus | "">("");
  const [confirmBulkArchive, setConfirmBulkArchive] = useState(false);
  const selected = rows
    .filter((row) => selection?.scope === selectionScope && selection.ids.includes(row.id))
    .map((row) => row.id);
  const allSelected = !!rows.length && selected.length === rows.length;
  function select(ids: string[]) {
    setSelection({ scope: selectionScope, ids });
  }
  useEffect(() => {
    setSelection(undefined);
    setBulkAssignee("");
    setBulkStatus("");
    setConfirmBulkArchive(false);
  }, [selectionScope]);
  useEffect(() => {
    if (leadsQuery.data && page > pages) setPage(pages);
  }, [leadsQuery.data, page, pages]);

  const bulk = useMutation({
    mutationFn: ({ ids, action }: { ids: string[]; action: BulkLeadAction }) =>
      updateLeadsInBulk(ws.workspace.id, ids, action),
    onSuccess: async (result) => {
      setSelection(undefined);
      setBulkAssignee("");
      setBulkStatus("");
      await invalidateLeadData(qc);
      toast[result.skipped ? "warning" : "success"](
        t(result.skipped ? "bulkPartial" : "bulkResult", result),
      );
    },
    onError: (error) => toast.error(t(mutationErrorKey(error))),
  });

  const archiveMutation = useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      setLeadArchived(id, archived),
    onSuccess: async (_data, variables) => {
      await invalidateLeadData(qc);
      setArchiveLeadId(null);
      toast.success(variables.archived ? t("leadArchived") : t("leadRestored"));
    },
    onError: (error) => toast.error(t(mutationErrorKey(error))),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteLead,
    onSuccess: async () => {
      await invalidateLeadData(qc);
      setDeleteLeadId(null);
      toast.success(t("leadDeleted"));
    },
    onError: (error) => toast.error(t(mutationErrorKey(error))),
  });

  async function exportCsv() {
    setExporting(true);
    try {
      const data = await fetchLeadsForExport(ws.workspace.id, {
        q: search,
        status,
        source,
        assignee,
        view,
      });
      const csv = Papa.unparse(
        data.map((lead) => ({
          name: lead.full_name,
          phone: lead.phone,
          email: lead.email,
          source: lead.source,
          status: lead.status,
          project: lead.interested_project,
          area: lead.preferred_area,
          budget_min: lead.budget_min,
          budget_max: lead.budget_max,
          notes: lead.notes,
        })),
      );
      const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `leadflow-leads-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success(t("exportCsv"));
    } catch (error) {
      toast.error(t("somethingWrong"));
    } finally {
      setExporting(false);
    }
  }

  function openCreate() {
    setEditingLead(undefined);
    setFormOpen(true);
  }

  function openEdit(lead: Lead) {
    setEditingLead(lead);
    setFormOpen(true);
  }

  const isOwner = ws.role === "owner";

  return (
    <div className="space-y-6">
      <PageHeader title={t("leadsTitle")} description={t("leadsCount", { count: total })}>
        <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
          <Upload className="h-4 w-4" />
          {t("importCsv")}
        </Button>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={exporting || total === 0}>
          <ArrowDownToLine className="h-4 w-4" />
          {t("exportCsv")}
        </Button>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          {t("addLead")}
        </Button>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={t("searchLeads")}
            className="ps-9"
            aria-label={t("searchLeads")}
          />
        </div>
        <NativeSelect
          value={status}
          onChange={(event) => setStatus(event.target.value as LeadStatus | "")}
          className="w-[160px]"
        >
          <option value="">{t("allStatuses")}</option>
          {LEAD_STATUSES.map((item) => (
            <option key={item} value={item}>
              {t(`status_${item}` as never)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          value={source}
          onChange={(event) => setSource(event.target.value as LeadSource | "")}
          className="w-[150px]"
        >
          <option value="">{t("allSources")}</option>
          {LEAD_SOURCES.map((item) => (
            <option key={item} value={item}>
              {t(`source_${item}` as never)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          value={assignee}
          onChange={(event) => setAssignee(event.target.value)}
          className="w-[170px]"
        >
          <option value="">{t("allAssignees")}</option>
          <option value="none">{t("unassigned")}</option>
          {ws.members.map((member) => (
            <option key={member.user_id} value={member.user_id}>
              {member.full_name ||
                (member.user_id === ws.userId ? ws.email : member.user_id.slice(0, 8))}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          value={view}
          onChange={(event) => setView(event.target.value as LeadsView)}
          className="w-[145px]"
        >
          <option value="active">{t("viewActive")}</option>
          <option value="archived">{t("viewArchived")}</option>
        </NativeSelect>
      </div>

      <SavedSearches
        workspaceId={ws.workspace.id}
        userId={ws.userId}
        currentFilters={{ q: search, status, source, assignee, view }}
        onApply={(next) => {
          setSearchInput(next.q);
          setSearch(next.q);
          setStatus(next.status as LeadStatus | "");
          setSource(next.source as LeadSource | "");
          setAssignee(next.assignee);
          setView(next.view as LeadsView);
          setPage(1);
        }}
      />

      {leadsQuery.isPending ? (
        <ListSkeleton rows={6} />
      ) : leadsQuery.isError ? (
        <ErrorState error={leadsQuery.error} onRetry={() => router.invalidate()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title={
            search || status || source || assignee
              ? t("noResultsTitle")
              : view === "archived"
                ? t("noArchivedTitle")
                : t("noLeadsTitle")
          }
          body={
            search || status || source || assignee
              ? t("noResultsBody")
              : view === "archived"
                ? t("noArchivedBody")
                : t("noLeadsBody")
          }
        >
          {(search || status || source || assignee) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSearchInput("");
                setSearch("");
                setStatus("");
                setSource("");
                setAssignee("");
              }}
            >
              {t("clearFilters")}
            </Button>
          )}
          {view === "active" && !search && !status && !source && !assignee && (
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              {t("addLead")}
            </Button>
          )}
        </EmptyState>
      ) : (
        <>
          {view === "active" && selected.length > 0 && (
            <fieldset
              disabled={bulk.isPending}
              className="flex flex-wrap items-center gap-2 rounded-lg border p-2 text-sm"
            >
              <span className="px-1 font-medium" aria-live="polite">
                {t("bulkSelected", { count: selected.length })}
              </span>
              <div className="flex items-center gap-1">
                <NativeSelect
                  className="max-w-36"
                  aria-label={t("assignedTo")}
                  value={bulkAssignee}
                  onChange={(event) => setBulkAssignee(event.target.value)}
                >
                  <option value="">{t("assignedTo")}</option>
                  <option value="none">{t("unassigned")}</option>
                  {ws.members.map((member) => (
                    <option key={member.user_id} value={member.user_id}>
                      {member.full_name ||
                        (member.user_id === ws.userId ? ws.email : member.user_id.slice(0, 8))}
                    </option>
                  ))}
                </NativeSelect>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!bulkAssignee}
                  onClick={() =>
                    bulk.mutate({
                      ids: selected,
                      action: {
                        type: "assign",
                        userId: bulkAssignee === "none" ? null : bulkAssignee,
                      },
                    })
                  }
                >
                  <UserRoundPlus className="size-4" />
                  {t("bulkAssign")}
                </Button>
              </div>
              <div className="flex items-center gap-1">
                <NativeSelect
                  className="max-w-36"
                  aria-label={t("status")}
                  value={bulkStatus}
                  onChange={(event) => setBulkStatus(event.target.value as LeadStatus | "")}
                >
                  <option value="">{t("status")}</option>
                  {LEAD_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {t(statusKey(status))}
                    </option>
                  ))}
                </NativeSelect>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!bulkStatus}
                  onClick={() =>
                    bulkStatus &&
                    bulk.mutate({ ids: selected, action: { type: "status", status: bulkStatus } })
                  }
                >
                  <ListChecks className="size-4" />
                  {t("bulkStatus")}
                </Button>
              </div>
              <Button size="sm" variant="outline" onClick={() => setConfirmBulkArchive(true)}>
                <Archive className="size-4" />
                {t("bulkArchive")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => select([])}>
                {t("bulkClear")}
              </Button>
            </fieldset>
          )}
          <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <div className="overflow-x-auto">
              <table className="data-table w-full min-w-[950px] text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    {view === "active" && (
                      <th className="w-10 ps-4">
                        <Checkbox
                          aria-label={t("selectPage")}
                          checked={allSelected ? true : selected.length ? "indeterminate" : false}
                          disabled={bulk.isPending}
                          onCheckedChange={() =>
                            select(allSelected ? [] : rows.map((row) => row.id))
                          }
                        />
                      </th>
                    )}
                    <th className="px-4 py-3 text-start font-medium">{t("colName")}</th>
                    <th className="px-4 py-3 text-start font-medium">{t("colPhone")}</th>
                    <th className="px-4 py-3 text-start font-medium">{t("colSource")}</th>
                    <th className="px-4 py-3 text-start font-medium">{t("colInterest")}</th>
                    <th className="px-4 py-3 text-start font-medium">{t("colBudget")}</th>
                    <th className="px-4 py-3 text-start font-medium">{t("colStatus")}</th>
                    <th className="px-4 py-3 text-start font-medium">
                      {dir === "rtl" ? "النقاط" : "Score"}
                    </th>
                    <th className="px-4 py-3 text-start font-medium">{t("colCreated")}</th>
                    <th className="px-4 py-3 text-end font-medium">{t("actions")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((lead) => (
                    <tr key={lead.id} className="transition-colors hover:bg-muted/30">
                      {view === "active" && (
                        <td className="ps-4">
                          <Checkbox
                            aria-label={t("bulkSelectLead", { name: lead.full_name })}
                            checked={selected.includes(lead.id)}
                            disabled={bulk.isPending}
                            onCheckedChange={(checked) =>
                              select(
                                checked === true
                                  ? [...selected, lead.id]
                                  : selected.filter((id) => id !== lead.id),
                              )
                            }
                          />
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          className="text-start font-semibold text-foreground hover:text-primary hover:underline"
                          onClick={() =>
                            navigate({ to: "/leads/$leadId", params: { leadId: lead.id } })
                          }
                        >
                          {lead.full_name}
                        </button>
                        {lead.is_demo && (
                          <div className="mt-1">
                            <DemoBadge />
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap" dir="ltr">
                        {lead.phone}
                      </td>
                      <td className="px-4 py-3">
                        <SourceBadge source={lead.source} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{lead.interested_project || "—"}</div>
                        {lead.preferred_area && (
                          <div className="text-xs text-muted-foreground">{lead.preferred_area}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {formatBudget(lead.budget_min, lead.budget_max, locale) || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={lead.status} />
                      </td>
                      <td className="px-4 py-3">{scoreBadge(lead)}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                        {formatDate(lead.created_at, locale)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            title={t("viewDetails")}
                            aria-label={t("viewDetails")}
                            onClick={() =>
                              navigate({ to: "/leads/$leadId", params: { leadId: lead.id } })
                            }
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title={t("edit")}
                            aria-label={t("edit")}
                            onClick={() => openEdit(lead)}
                          >
                            <span className="text-xs">✎</span>
                          </Button>
                          {view === "active" ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              title={t("archive")}
                              aria-label={t("archive")}
                              disabled={archiveMutation.isPending}
                              onClick={() => setArchiveLeadId(lead.id)}
                            >
                              <Archive className="h-4 w-4" />
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="icon"
                              title={t("restore")}
                              aria-label={t("restore")}
                              disabled={archiveMutation.isPending}
                              onClick={() => setArchiveLeadId(lead.id)}
                            >
                              <RotateCcw className="h-4 w-4" />
                            </Button>
                          )}
                          {isOwner && (
                            <Button
                              variant="ghost"
                              size="icon"
                              title={t("delete")}
                              aria-label={t("delete")}
                              className="text-destructive hover:text-destructive"
                              disabled={deleteMutation.isPending}
                              onClick={() => setDeleteLeadId(lead.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>{t("leadsCount", { count: total })}</span>
            <div className="flex items-center gap-2">
              <span>{t("page", { page, pages })}</span>
              <Button
                variant="outline"
                size="icon"
                aria-label={t("prev")}
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                {dir === "rtl" ? (
                  <ChevronRight className="h-4 w-4" />
                ) : (
                  <ChevronLeft className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label={t("next")}
                disabled={page >= pages}
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
              >
                {dir === "rtl" ? (
                  <ChevronLeft className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </>
      )}

      {importOpen && (
        <LeadImportDialog
          key={ws.workspace.id}
          workspaceId={ws.workspace.id}
          close={() => setImportOpen(false)}
        />
      )}
      <ConfirmDialog
        open={confirmBulkArchive}
        onOpenChange={setConfirmBulkArchive}
        title={t("bulkArchive")}
        body={t("bulkArchiveBody", { count: selected.length })}
        confirmLabel={t("archive")}
        onConfirm={() => bulk.mutate({ ids: selected, action: { type: "archive" } })}
      />
      <LeadFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditingLead(undefined);
        }}
        lead={editingLead}
      />
      <ConfirmDialog
        open={archiveLeadId !== null}
        onOpenChange={(open) => {
          if (!open) setArchiveLeadId(null);
        }}
        title={t(view === "archived" ? "restoreLeadTitle" : "archiveLeadTitle")}
        body={t(view === "archived" ? "restoreLeadBody" : "archiveLeadBody", {
          name: rows.find((row) => row.id === archiveLeadId)?.full_name ?? "",
        })}
        confirmLabel={t(view === "archived" ? "restore" : "archive")}
        confirmVariant={view === "archived" ? "default" : "destructive"}
        onConfirm={() => {
          if (archiveLeadId)
            archiveMutation.mutate({ id: archiveLeadId, archived: view !== "archived" });
        }}
      />
      <ConfirmDialog
        open={deleteLeadId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteLeadId(null);
        }}
        title={t("deleteLeadTitle")}
        body={t("deleteLeadBody", {
          name: rows.find((row) => row.id === deleteLeadId)?.full_name ?? "",
        })}
        confirmLabel={t("delete")}
        onConfirm={() => {
          if (deleteLeadId) deleteMutation.mutate(deleteLeadId);
        }}
      />
    </div>
  );
}
