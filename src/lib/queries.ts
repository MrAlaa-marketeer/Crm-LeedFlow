import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  LEAD_SOURCES,
  LEAD_STATUSES,
  dayBounds,
  sanitizeSearch,
  type FollowUp,
  type Lead,
  type LeadSource,
  type LeadStatus,
} from "./leads";
import { toLatinDigits } from "./phone";
export { mutationErrorKey } from "./mutation-errors";

export const LEAD_DATA_KEYS = [
  "leads",
  "lead",
  "followups",
  "stats",
  "pipeline",
  "reminders",
  "lead-picker",
  "lead-activities",
] as const;

export function invalidateLeadData(qc: QueryClient) {
  return Promise.all(LEAD_DATA_KEYS.map((k) => qc.invalidateQueries({ queryKey: [k] })));
}

export type FollowUpWithLead = FollowUp & {
  lead: Pick<
    Lead,
    | "id"
    | "full_name"
    | "phone"
    | "status"
    | "interested_project"
    | "preferred_area"
    | "is_demo"
    | "archived_at"
  > | null;
};

export const FOLLOW_UP_SELECT =
  "*, lead:leads!inner(id, full_name, phone, status, interested_project, preferred_area, is_demo, archived_at)";

export async function updateLeadStatus(id: string, status: LeadStatus) {
  const { data, error } = await supabase
    .from("leads")
    .update({ status })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("mutation_no_rows");
}

export async function setLeadArchived(id: string, archived: boolean) {
  const { data, error } = await supabase
    .from("leads")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("mutation_no_rows");
}

export async function deleteLead(id: string) {
  const { data, error } = await supabase
    .from("leads")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("mutation_no_rows");
}

export async function setFollowUpDone(id: string, done: boolean) {
  const { data, error } = await supabase
    .from("follow_ups")
    .update({ completed_at: done ? new Date().toISOString() : null })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("mutation_no_rows");
}

export async function deleteFollowUp(id: string) {
  const { data, error } = await supabase
    .from("follow_ups")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("mutation_no_rows");
}

// ---------------------------------------------------------------------------
// Read queries (browser client; RLS scopes every read to the caller's workspace)
// ---------------------------------------------------------------------------

export const LEADS_PAGE_SIZE = 25;

export type LeadsView = "active" | "archived";
export interface LeadFilters {
  q: string;
  status: LeadStatus | "";
  source: LeadSource | "";
  assignee: string;
  view: LeadsView;
  page: number;
}

const leadsBase = (withCount: boolean) =>
  supabase.from("leads").select("*", withCount ? { count: "exact" } : {});
type LeadsQuery = ReturnType<typeof leadsBase>;

function applyLeadFilters(
  query: LeadsQuery,
  workspaceId: string,
  f: Omit<LeadFilters, "page">,
): LeadsQuery {
  let q = query.eq("workspace_id", workspaceId);
  q = f.view === "archived" ? q.not("archived_at", "is", null) : q.is("archived_at", null);
  if (f.status) q = q.eq("status", f.status);
  if (f.source) q = q.eq("source", f.source);
  if (f.assignee === "none") q = q.is("assigned_to", null);
  else if (f.assignee) q = q.eq("assigned_to", f.assignee);
  const term = sanitizeSearch(f.q);
  if (term) {
    const digits = toLatinDigits(term).replace(/\D/g, "");
    const parts = [
      `full_name.ilike.%${term}%`,
      `interested_project.ilike.%${term}%`,
      `preferred_area.ilike.%${term}%`,
      `email.ilike.%${term}%`,
    ];
    // Phones are stored as +20…; match on the significant digits (drop a leading 0).
    if (digits.length >= 3) parts.push(`phone.ilike.%${digits.replace(/^0+/, "")}%`);
    q = q.or(parts.join(","));
  }
  return q;
}

export const leadsListQuery = (workspaceId: string, f: LeadFilters) =>
  queryOptions({
    queryKey: ["leads", workspaceId, f],
    queryFn: async () => {
      const from = (f.page - 1) * LEADS_PAGE_SIZE;
      const query = applyLeadFilters(leadsBase(true), workspaceId, f)
        .order("created_at", { ascending: false })
        .range(from, from + LEADS_PAGE_SIZE - 1);
      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: data, total: count ?? 0 };
    },
  });

/** All leads matching the filters (for CSV export), capped to keep the browser responsive. */
export async function fetchLeadsForExport(
  workspaceId: string,
  f: Omit<LeadFilters, "page">,
  max = 5000,
) {
  const out: Lead[] = [];
  const chunk = 1000;
  for (let from = 0; from < max; from += chunk) {
    const { data, error } = await applyLeadFilters(leadsBase(false), workspaceId, f)
      .order("created_at", { ascending: false })
      .range(from, Math.min(from + chunk, max) - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < chunk) break;
  }
  return out;
}

export const leadQuery = (leadId: string) =>
  queryOptions({
    queryKey: ["lead", leadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select("*")
        .eq("id", leadId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

export const leadActivitiesQuery = (leadId: string, workspaceId: string) =>
  queryOptions({
    queryKey: ["lead-activities", workspaceId, leadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lead_activities")
        .select("id, workspace_id, lead_id, actor_id, activity_type, details, created_at")
        .eq("workspace_id", workspaceId)
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });

export const leadFollowUpsQuery = (leadId: string) =>
  queryOptions({
    queryKey: ["followups", "lead", leadId],
    queryFn: async (): Promise<FollowUpWithLead[]> => {
      const { data, error } = await supabase
        .from("follow_ups")
        .select(FOLLOW_UP_SELECT)
        .eq("lead_id", leadId)
        .order("completed_at", { ascending: true, nullsFirst: true })
        .order("due_at", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

export type PipelineLead = Pick<
  Lead,
  | "id"
  | "full_name"
  | "phone"
  | "status"
  | "source"
  | "interested_project"
  | "preferred_area"
  | "budget_min"
  | "budget_max"
  | "next_follow_up_at"
  | "is_demo"
  | "assigned_to"
  | "notes"
  | "created_at"
>;

export const PIPELINE_LIMIT = 500;

export interface PipelineFilters {
  q: string;
  source: LeadSource | "";
  assignee: string;
  project: string;
  fromDate: string;
  toDate: string;
}

function createPipelineFilterQuery() {
  return supabase.from("leads").select("id");
}

function applyPipelineFilters<T>(query: T, filters: PipelineFilters): T {
  let filtered = query as ReturnType<typeof createPipelineFilterQuery>;
  if (filters.source) filtered = filtered.eq("source", filters.source);
  if (filters.assignee === "none") filtered = filtered.is("assigned_to", null);
  else if (filters.assignee) filtered = filtered.eq("assigned_to", filters.assignee);
  const project = sanitizeSearch(filters.project);
  if (project) filtered = filtered.ilike("interested_project", `%${project}%`);
  if (filters.fromDate)
    filtered = filtered.gte("created_at", new Date(`${filters.fromDate}T00:00:00`).toISOString());
  if (filters.toDate) {
    const through = new Date(`${filters.toDate}T00:00:00`);
    through.setDate(through.getDate() + 1);
    filtered = filtered.lt("created_at", through.toISOString());
  }
  const term = sanitizeSearch(filters.q);
  if (term) {
    const digits = toLatinDigits(term).replace(/\D/g, "").replace(/^0+/, "");
    const parts = [`full_name.ilike.%${term}%`, `interested_project.ilike.%${term}%`];
    if (digits.length >= 3) parts.push(`phone.ilike.%${digits}%`);
    filtered = filtered.or(parts.join(","));
  }
  return filtered as T;
}

export const pipelineQuery = (
  workspaceId: string,
  filters: PipelineFilters = {
    q: "",
    source: "",
    assignee: "",
    project: "",
    fromDate: "",
    toDate: "",
  },
  limit = PIPELINE_LIMIT,
) =>
  queryOptions({
    queryKey: ["pipeline", workspaceId, filters, limit],
    queryFn: async (): Promise<{
      rows: PipelineLead[];
      total: number;
      stageCounts: Record<LeadStatus, number>;
      truncated: boolean;
    }> => {
      const select =
        "id, full_name, phone, status, source, interested_project, preferred_area, budget_min, budget_max, next_follow_up_at, is_demo, assigned_to, notes, created_at";
      const listQuery = applyPipelineFilters(
        supabase
          .from("leads")
          .select(select, { count: "exact" })
          .eq("workspace_id", workspaceId)
          .is("archived_at", null),
        filters,
      );
      const [listResult, ...counts] = await Promise.all([
        listQuery.order("status_changed_at", { ascending: false }).limit(limit),
        ...LEAD_STATUSES.map((status) =>
          applyPipelineFilters(
            supabase
              .from("leads")
              .select("id", { count: "exact", head: true })
              .eq("workspace_id", workspaceId)
              .is("archived_at", null),
            filters,
          ).eq("status", status),
        ),
      ]);
      if (listResult.error) throw listResult.error;
      const failedCount = counts.find((result) => result.error);
      if (failedCount?.error) throw failedCount.error;
      const stageCounts = Object.fromEntries(
        LEAD_STATUSES.map((status, index) => [status, counts[index]?.count ?? 0]),
      ) as Record<LeadStatus, number>;
      const data = listResult.data ?? [];
      return {
        rows: data,
        total: listResult.count ?? 0,
        stageCounts,
        truncated: (listResult.count ?? 0) > data.length,
      };
    },
  });

export const openFollowUpsQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: ["followups", "open", workspaceId],
    queryFn: async (): Promise<FollowUpWithLead[]> => {
      const { data, error } = await supabase
        .from("follow_ups")
        .select(FOLLOW_UP_SELECT)
        .eq("workspace_id", workspaceId)
        .is("completed_at", null)
        .is("lead.archived_at", null)
        .order("due_at", { ascending: true })
        .limit(1000);
      if (error) throw error;
      return data;
    },
  });

export const completedFollowUpsQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: ["followups", "completed", workspaceId],
    queryFn: async (): Promise<FollowUpWithLead[]> => {
      const { data, error } = await supabase
        .from("follow_ups")
        .select(FOLLOW_UP_SELECT)
        .eq("workspace_id", workspaceId)
        .not("completed_at", "is", null)
        .order("completed_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });

export interface FollowUpTaskFilters {
  assignedTo: string | null;
  state: "open" | "completed" | "all";
  from: string | null;
  to: string | null;
  limit?: number;
}

/** One workspace-scoped source for task lists and calendar ranges. */
export const followUpTasksQuery = (workspaceId: string, filters: FollowUpTaskFilters) =>
  queryOptions({
    queryKey: ["followups", "tasks", workspaceId, filters],
    queryFn: async (): Promise<{ rows: FollowUpWithLead[]; total: number; truncated: boolean }> => {
      let query = supabase
        .from("follow_ups")
        .select(FOLLOW_UP_SELECT, { count: "exact" })
        .eq("workspace_id", workspaceId)
        .is("lead.archived_at", null);
      if (filters.assignedTo) query = query.eq("assigned_to", filters.assignedTo);
      if (filters.state === "open") query = query.is("completed_at", null);
      if (filters.state === "completed") query = query.not("completed_at", "is", null);
      if (filters.from) query = query.gte("due_at", filters.from);
      if (filters.to) query = query.lt("due_at", filters.to);
      const { data, error, count } = await query
        .order(filters.state === "completed" ? "completed_at" : "due_at", {
          ascending: filters.state !== "completed",
        })
        .limit(filters.limit ?? 2000);
      if (error) throw error;
      return {
        rows: data,
        total: count ?? 0,
        truncated: (count ?? 0) > data.length,
      };
    },
  });

/** Count of open follow-ups due before the end of today (overdue + today), active leads only. */
export const remindersQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: ["reminders", workspaceId],
    queryFn: async () => {
      const { end } = dayBounds();
      const { count, error } = await supabase
        .from("follow_ups")
        .select("id, lead:leads!inner(archived_at)", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .is("completed_at", null)
        .is("lead.archived_at", null)
        .lt("due_at", end.toISOString());
      if (error) throw error;
      return count ?? 0;
    },
    refetchInterval: 60_000,
  });

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export const DATE_RANGES = ["month", "30d", "90d", "year", "all"] as const;
export type DateRange = (typeof DATE_RANGES)[number];

export function rangeStart(range: DateRange, now = new Date()): Date | null {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (range) {
    case "month":
      return new Date(now.getFullYear(), now.getMonth(), 1);
    case "30d":
      d.setDate(d.getDate() - 29);
      return d;
    case "90d":
      d.setDate(d.getDate() - 89);
      return d;
    case "year":
      return new Date(now.getFullYear(), 0, 1);
    case "all":
      return null;
  }
}

export interface DashboardStats {
  total_leads: number;
  new_this_month: number;
  range_leads: number;
  range_won: number;
  range_lost: number;
  overdue: number;
  due_today: number;
  upcoming: number;
  has_demo: boolean;
  by_status: Partial<Record<LeadStatus, number>>;
  by_source: Partial<Record<LeadSource, number>>;
}

function toCount(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toCountMap<K extends string>(v: unknown, keys: readonly K[]): Partial<Record<K, number>> {
  const out: Partial<Record<K, number>> = {};
  if (v && typeof v === "object") {
    const rec = v as Record<string, unknown>;
    for (const k of keys) if (k in rec) out[k] = toCount(rec[k]);
  }
  return out;
}

/** Validates the jsonb returned by dashboard_stats() into a typed DTO. */
export function parseDashboardStats(raw: unknown): DashboardStats {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    total_leads: toCount(r["total_leads"]),
    new_this_month: toCount(r["new_this_month"]),
    range_leads: toCount(r["range_leads"]),
    range_won: toCount(r["range_won"]),
    range_lost: toCount(r["range_lost"]),
    overdue: toCount(r["overdue"]),
    due_today: toCount(r["due_today"]),
    upcoming: toCount(r["upcoming"]),
    has_demo: r["has_demo"] === true,
    by_status: toCountMap(r["by_status"], LEAD_STATUSES),
    by_source: toCountMap(r["by_source"], LEAD_SOURCES),
  };
}

export const statsQuery = (workspaceId: string, range: DateRange) =>
  queryOptions({
    queryKey: ["stats", workspaceId, range],
    queryFn: async () => {
      const now = new Date();
      const { start, end } = dayBounds(now);
      const from = rangeStart(range, now);
      const { data, error } = await supabase.rpc("dashboard_stats", {
        _workspace_id: workspaceId,
        // "All time" starts at the epoch; the range always ends now.
        _from: (from ?? new Date(0)).toISOString(),
        _to: now.toISOString(),
        _month_start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
        _today_start: start.toISOString(),
        _today_end: end.toISOString(),
      });
      if (error) throw error;
      return {
        stats: parseDashboardStats(data),
        from: from ? from.toISOString() : null,
        to: now.toISOString(),
      };
    },
  });
