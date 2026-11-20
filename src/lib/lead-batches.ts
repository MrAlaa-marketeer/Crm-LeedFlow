import { supabase } from "@/integrations/supabase/client";
import type { DictKey } from "./i18n-dict";
import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  parseCsvText,
  validateRows,
  type ImportField,
  type RowIssue,
  type ValidatedLead,
} from "./csv";
import { LEAD_STATUSES, type LeadStatus } from "./leads";
import { normalizePhone } from "./phone";

export async function readImportFile(file: Pick<File, "size" | "text">) {
  if (file.size > MAX_IMPORT_BYTES) return { issue: { key: "fileTooLarge" } as RowIssue };
  const parsed = parseCsvText(await file.text());
  if (parsed.rows.length > MAX_IMPORT_ROWS)
    return {
      issue: {
        key: "tooManyRows",
        vars: { count: parsed.rows.length, max: MAX_IMPORT_ROWS },
      } as RowIssue,
    };
  if (parsed.parseErrors.some((error) => error.type !== "FieldMismatch"))
    return { issue: { key: "csvUnreadable" } as RowIssue };
  if (!parsed.rows.length) return { issue: { key: "noRows" } as RowIssue };
  return { parsed };
}

export type LeadPhones = ReadonlyMap<string, ReadonlySet<string>>;

export function indexLeadPhones(rows: Iterable<{ id: string; phone: string }>) {
  const index = new Map<string, Set<string>>();
  for (const { id, phone } of rows) {
    const normalized = normalizePhone(phone);
    if (!normalized.ok) continue;
    const ids = index.get(normalized.e164) ?? new Set<string>();
    ids.add(id);
    index.set(normalized.e164, ids);
  }
  return index;
}

export function hasDuplicatePhone(index: LeadPhones, phone: string, exceptId?: string) {
  const normalized = normalizePhone(phone);
  if (!normalized.ok) return false;
  const ids = index.get(normalized.e164);
  return !!ids && (ids.size > 1 || !exceptId || !ids.has(exceptId));
}

// Scan only IDs and phones, including archived leads and numbers saved before normalization.
export async function fetchWorkspacePhones(workspaceId: string) {
  const rows: { id: string; phone: string }[] = [];
  let cursor: string | undefined;
  for (;;) {
    let query = supabase
      .from("leads")
      .select("id, phone")
      .eq("workspace_id", workspaceId)
      .order("id")
      .limit(500);
    if (cursor) query = query.gt("id", cursor);
    const { data, error } = await query;
    if (error) throw error;
    if (!data.length) break;
    rows.push(...data);
    cursor = data.at(-1)?.id;
  }
  return indexLeadPhones(rows);
}

export function previewImport(
  parsed: ReturnType<typeof parseCsvText>,
  mapping: Partial<Record<ImportField, string>>,
  existing: LeadPhones,
) {
  const malformed = new Set(parsed.parseErrors.map((error) => error.row));
  const seen = new Map<string, number>();
  return validateRows(parsed.rows, mapping).map((row, i) => {
    const errors = malformed.has(i)
      ? [...row.errors, { key: "csvColumnCount" as const }]
      : row.errors;
    let duplicate: RowIssue | undefined;
    if (row.data && !errors.length) {
      const phone = row.data.phone;
      const first = seen.get(phone);
      if (hasDuplicatePhone(existing, phone)) duplicate = { key: "warnDupDb" };
      else if (first !== undefined) duplicate = { key: "warnDupFile", vars: { row: first } };
      else seen.set(phone, row.rowNumber);
    }
    return { ...row, errors, duplicate, data: errors.length || duplicate ? null : row.data };
  });
}

type ImportEntry = { rowNumber: number; data: ValidatedLead };

export async function insertImportedLeads(
  workspaceId: string,
  rows: ImportEntry[],
  followUpTitle: string,
) {
  const failures: { row: number; key: DictKey }[] = [];
  let imported = 0;
  const entries = rows.map(({ rowNumber, data: { next_follow_up_at: due, ...lead } }) => ({
    rowNumber,
    due,
    lead: { ...lead, id: crypto.randomUUID(), workspace_id: workspaceId },
  }));
  async function writeBatch(batch: typeof entries) {
    const { data, error } = await supabase
      .from("leads")
      .insert(batch.map((entry) => entry.lead))
      .select("id, assigned_to");
    if (error) {
      // A rejected constraint rolls back the batch. Isolate the bad row without retrying network errors.
      if (batch.length > 1 && /^(22|23)/.test(error.code ?? "")) {
        const middle = Math.floor(batch.length / 2);
        await writeBatch(batch.slice(0, middle));
        await writeBatch(batch.slice(middle));
      } else {
        for (const entry of batch) failures.push({ row: entry.rowNumber, key: "csvSaveFailed" });
      }
      return;
    }
    const saved = new Map(data.map((lead) => [lead.id, lead]));
    const followUps = batch.flatMap(({ lead, due, rowNumber }) => {
      const record = saved.get(lead.id);
      if (!record) {
        failures.push({ row: rowNumber, key: "csvSaveFailed" });
        return [];
      }
      imported++;
      return due
        ? [
            {
              rowNumber,
              payload: {
                id: crypto.randomUUID(),
                workspace_id: workspaceId,
                lead_id: lead.id,
                title: followUpTitle,
                due_at: due,
                assigned_to: record.assigned_to,
              },
            },
          ]
        : [];
    });
    if (followUps.length) {
      const result = await supabase
        .from("follow_ups")
        .insert(followUps.map((item) => item.payload))
        .select("id");
      const ids = new Set(result.data?.map((item) => item.id));
      for (const item of followUps)
        if (!ids.has(item.payload.id))
          failures.push({ row: item.rowNumber, key: "csvFollowUpFailed" });
    }
  }
  for (let i = 0; i < entries.length; i += 100) await writeBatch(entries.slice(i, i + 100));
  return { imported, failures };
}

export type BulkLeadAction =
  | { type: "assign"; userId: string | null }
  | { type: "status"; status: LeadStatus }
  | { type: "archive" };

export async function updateLeadsInBulk(
  workspaceId: string,
  ids: readonly string[],
  action: BulkLeadAction,
) {
  const selected = [...new Set(ids)];
  if (!workspaceId || !selected.length) return { updated: 0, skipped: selected.length };
  if (action.type === "status" && !LEAD_STATUSES.includes(action.status))
    throw new Error("invalid_lead_status");
  const patch =
    action.type === "assign"
      ? { assigned_to: action.userId }
      : action.type === "status"
        ? { status: action.status }
        : { archived_at: new Date().toISOString() };
  const { data, error } = await supabase
    .from("leads")
    .update(patch)
    .eq("workspace_id", workspaceId)
    .is("archived_at", null)
    .in("id", selected)
    .select("id");
  if (error) throw error;
  return { updated: data.length, skipped: selected.length - data.length };
}
