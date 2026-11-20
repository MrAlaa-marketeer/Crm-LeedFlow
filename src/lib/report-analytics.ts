export type ReportFilters = {
  from: string;
  to: string;
  assignedTo: string;
  source: string;
  projectId: string;
  status: string;
};

type StatusCount = { name: string; count: number };
export type MonthReportRow = {
  month: string;
  total: number;
  qualified: number;
  won: number;
  lost: number;
};
export type EmployeeReportRow = {
  user_id: string;
  full_name: string | null;
  role: string;
  lead_count: number;
  won_count: number;
  lost_count: number;
  completed_follow_up_count: number;
};
export type ProjectReportRow = {
  project_id: string;
  project_name: string;
  lead_count: number;
  won_count: number;
  linked_unit_interest_count: number;
};
export type ReportData = {
  kpis: {
    total_leads: number;
    new_leads: number;
    qualified_leads: number;
    won_leads: number;
    lost_leads: number;
    conversion_rate: number;
    open_follow_ups: number;
    overdue_follow_ups: number;
    completed_follow_ups: number;
    lead_budget_max_sum: number;
  };
  by_status: StatusCount[];
  by_source: StatusCount[];
  monthly: MonthReportRow[];
  employees: EmployeeReportRow[];
  projects: ProjectReportRow[];
};

export function reportDateBounds(from: string, to: string) {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  end.setDate(end.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asNumber(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

/** Validates the aggregate JSON returned by the workspace-scoped analytics RPC. */
export function parseReport(raw: unknown): ReportData {
  const root = asRecord(raw);
  const kpi = asRecord(root["kpis"]);
  const counts = (input: unknown) =>
    Object.entries(asRecord(input)).map(([name, value]) => ({ name, count: asNumber(value) }));
  return {
    kpis: {
      total_leads: asNumber(kpi["total_leads"]),
      new_leads: asNumber(kpi["new_leads"]),
      qualified_leads: asNumber(kpi["qualified_leads"]),
      won_leads: asNumber(kpi["won_leads"]),
      lost_leads: asNumber(kpi["lost_leads"]),
      conversion_rate: asNumber(kpi["conversion_rate"]),
      open_follow_ups: asNumber(kpi["open_follow_ups"]),
      overdue_follow_ups: asNumber(kpi["overdue_follow_ups"]),
      completed_follow_ups: asNumber(kpi["completed_follow_ups"]),
      lead_budget_max_sum: asNumber(kpi["lead_budget_max_sum"]),
    },
    by_status: counts(root["by_status"]),
    by_source: counts(root["by_source"]),
    monthly: asArray(root["monthly"]).map((row) => ({
      month: String(row["month"] ?? ""),
      total: asNumber(row["total"]),
      qualified: asNumber(row["qualified"]),
      won: asNumber(row["won"]),
      lost: asNumber(row["lost"]),
    })),
    employees: asArray(root["employees"]).map((row) => ({
      user_id: String(row["user_id"] ?? ""),
      full_name: typeof row["full_name"] === "string" ? row["full_name"] : null,
      role: String(row["role"] ?? "agent"),
      lead_count: asNumber(row["lead_count"]),
      won_count: asNumber(row["won_count"]),
      lost_count: asNumber(row["lost_count"]),
      completed_follow_up_count: asNumber(row["completed_follow_up_count"]),
    })),
    projects: asArray(root["projects"]).map((row) => ({
      project_id: String(row["project_id"] ?? ""),
      project_name: String(row["project_name"] ?? ""),
      lead_count: asNumber(row["lead_count"]),
      won_count: asNumber(row["won_count"]),
      linked_unit_interest_count: asNumber(row["linked_unit_interest_count"]),
    })),
  };
}
