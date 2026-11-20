import Papa from "papaparse";
import type { DictKey } from "./i18n-dict";
import {
  LEAD_SOURCES,
  LEAD_STATUSES,
  parseAmount,
  type LeadSource,
  type LeadStatus,
} from "./leads";
import { normalizePhone } from "./phone";

export const IMPORT_FIELDS = [
  "full_name",
  "phone",
  "email",
  "source",
  "status",
  "interested_project",
  "preferred_area",
  "budget_min",
  "budget_max",
  "notes",
  "next_follow_up_at",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export const REQUIRED_FIELDS: ImportField[] = ["full_name", "phone"];
export const MAX_IMPORT_ROWS = 2000;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

const norm = (s: string) =>
  s
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[أإآ]/g, "ا");

const HEADER_ALIASES: Record<ImportField, string[]> = {
  full_name: ["full_name", "name", "full name", "lead name", "الاسم", "الاسم الكامل", "اسم العميل"],
  phone: [
    "phone",
    "mobile",
    "phone number",
    "mobile number",
    "الهاتف",
    "رقم الهاتف",
    "الموبايل",
    "موبايل",
    "رقم الموبايل",
  ],
  email: ["email", "e-mail", "email address", "البريد", "البريد الإلكتروني", "الايميل", "الإيميل"],
  source: ["source", "lead source", "المصدر"],
  status: ["status", "stage", "المرحلة", "الحالة"],
  interested_project: [
    "interested_project",
    "project",
    "interested project",
    "المشروع",
    "المشروع المهتم به",
  ],
  preferred_area: [
    "preferred_area",
    "area",
    "preferred area",
    "location",
    "المنطقة",
    "المنطقة المفضلة",
  ],
  budget_min: ["budget_min", "min budget", "budget from", "الميزانية من", "اقل ميزانية"],
  budget_max: [
    "budget_max",
    "max budget",
    "budget to",
    "الميزانية إلى",
    "الميزانية الى",
    "اقصى ميزانية",
  ],
  notes: ["notes", "note", "comments", "ملاحظات"],
  next_follow_up_at: [
    "next_follow_up_at",
    "next follow up",
    "follow up",
    "follow up date",
    "المتابعة القادمة",
    "موعد المتابعة",
  ],
};

const SOURCE_ALIASES: Record<LeadSource, string[]> = {
  facebook: ["facebook", "fb", "meta", "فيسبوك", "فيس بوك", "فيس"],
  instagram: ["instagram", "ig", "insta", "انستجرام", "انستغرام", "انستا"],
  whatsapp: ["whatsapp", "wa", "whats app", "واتساب", "واتس اب", "واتس"],
  referral: ["referral", "ref", "referred", "ترشيح", "توصية"],
  website: ["website", "web", "site", "الموقع", "الموقع الإلكتروني", "الموقع الالكتروني", "موقع"],
  other: ["other", "others", "اخرى", "اخري", "أخرى"],
};

const STATUS_ALIASES: Record<LeadStatus, string[]> = {
  new: ["new", "جديد"],
  contacted: ["contacted", "تم التواصل", "تواصل"],
  qualified: ["qualified", "مؤهل"],
  meeting: ["meeting", "اجتماع", "مقابلة", "معاينة"],
  negotiation: ["negotiation", "negotiating", "تفاوض"],
  won: ["won", "closed won", "تم البيع", "بيع", "مكسب"],
  lost: ["lost", "closed lost", "خسارة", "خاسر", "مفقود"],
};

function matchAlias<T extends string>(value: string, aliases: Record<T, string[]>): T | null {
  const v = norm(value);
  for (const [key, list] of Object.entries(aliases) as [T, string[]][]) {
    if (list.some((a) => norm(a) === v)) return key;
  }
  return null;
}

export function mapHeaders(headers: string[]) {
  const map: Partial<Record<ImportField, string>> = {};
  const unknown: string[] = [];
  for (const h of headers) {
    if (!h || !h.trim()) continue;
    const field = matchAlias(h, HEADER_ALIASES);
    if (field && !map[field]) map[field] = h;
    else unknown.push(h);
  }
  const missing = REQUIRED_FIELDS.filter((f) => !map[f]);
  return { map, unknown, missing };
}

/** Accepts ISO dates, "YYYY-MM-DD HH:mm", and Egyptian-style "DD/MM/YYYY [HH:mm]". */
export function parseDateInput(value: string): Date | null {
  const s = value.trim().replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  if (!s) return null;
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(s);
  if (dmy) {
    const [, d, m, y, hh = "9", mm = "0"] = dmy;
    const date = new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm));
    if (date.getMonth() !== Number(m) - 1 || date.getDate() !== Number(d)) return null;
    return date;
  }
  const ymd = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(s);
  if (ymd) {
    const [, y, m, d, hh = "9", mm = "0"] = ymd;
    const date = new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm));
    if (date.getMonth() !== Number(m) - 1 || date.getDate() !== Number(d)) return null;
    return date;
  }
  const iso = new Date(s);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s) && !Number.isNaN(iso.getTime())) return iso;
  return null;
}

export interface RowIssue {
  key: DictKey;
  vars?: Record<string, string | number>;
}

export interface ValidatedLead {
  full_name: string;
  phone: string;
  email: string | null;
  source: LeadSource;
  status: LeadStatus;
  interested_project: string | null;
  preferred_area: string | null;
  budget_min: number | null;
  budget_max: number | null;
  notes: string | null;
  next_follow_up_at: string | null;
}

export interface ValidatedRow {
  rowNumber: number;
  raw: Record<string, string>;
  data: ValidatedLead | null;
  errors: RowIssue[];
  warnings: RowIssue[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateRows(
  rows: Record<string, string>[],
  headerMap: Partial<Record<ImportField, string>>,
): ValidatedRow[] {
  const get = (row: Record<string, string>, f: ImportField) => {
    const h = headerMap[f];
    return h ? String(row[h] ?? "").trim() : "";
  };
  const seenPhones = new Map<string, number>();

  return rows.map((row, i) => {
    const rowNumber = i + 2; // header is row 1
    const errors: RowIssue[] = [];
    const warnings: RowIssue[] = [];

    const full_name = get(row, "full_name");
    if (!full_name) errors.push({ key: "errEmptyName" });
    else if (full_name.length > 150)
      errors.push({ key: "errTooLong", vars: { field: "full_name" } });

    const phoneRaw = get(row, "phone");
    let phone = "";
    if (!phoneRaw) errors.push({ key: "errEmptyPhone" });
    else {
      const res = normalizePhone(phoneRaw);
      if (res.ok) {
        phone = res.e164;
        const prev = seenPhones.get(phone);
        if (prev) warnings.push({ key: "warnDupFile", vars: { row: prev } });
        else seenPhones.set(phone, rowNumber);
      } else errors.push({ key: "errPhone", vars: { value: phoneRaw } });
    }

    const emailRaw = get(row, "email");
    if (emailRaw && (!EMAIL_RE.test(emailRaw) || emailRaw.length > 255))
      errors.push({ key: "errEmail", vars: { value: emailRaw } });

    const sourceRaw = get(row, "source");
    let source: LeadSource = "other";
    if (sourceRaw) {
      const s = matchAlias(sourceRaw, SOURCE_ALIASES);
      if (s && LEAD_SOURCES.includes(s)) source = s;
      else errors.push({ key: "errSource", vars: { value: sourceRaw } });
    }

    const statusRaw = get(row, "status");
    let status: LeadStatus = "new";
    if (statusRaw) {
      const s = matchAlias(statusRaw, STATUS_ALIASES);
      if (s && LEAD_STATUSES.includes(s)) status = s;
      else errors.push({ key: "errStatus", vars: { value: statusRaw } });
    }

    const amounts: Record<"budget_min" | "budget_max", number | null> = {
      budget_min: null,
      budget_max: null,
    };
    for (const f of ["budget_min", "budget_max"] as const) {
      const v = get(row, f);
      const n = parseAmount(v);
      if (n === undefined) continue;
      if (!Number.isSafeInteger(n) || n >= 1e14)
        errors.push({ key: "errBudget", vars: { field: f, value: v } });
      else amounts[f] = n;
    }
    if (
      amounts.budget_min != null &&
      amounts.budget_max != null &&
      amounts.budget_max < amounts.budget_min
    )
      errors.push({ key: "errBudgetRange" });

    const project = get(row, "interested_project");
    const area = get(row, "preferred_area");
    const notes = get(row, "notes");
    if (project.length > 200)
      errors.push({ key: "errTooLong", vars: { field: "interested_project" } });
    if (area.length > 200) errors.push({ key: "errTooLong", vars: { field: "preferred_area" } });
    if (notes.length > 5000) errors.push({ key: "errTooLong", vars: { field: "notes" } });

    const fuRaw = get(row, "next_follow_up_at");
    let next_follow_up_at: string | null = null;
    if (fuRaw) {
      const d = parseDateInput(fuRaw);
      if (d) next_follow_up_at = d.toISOString();
      else errors.push({ key: "errDate", vars: { value: fuRaw } });
    }

    const data: ValidatedLead | null = errors.length
      ? null
      : {
          full_name,
          phone,
          email: emailRaw || null,
          source,
          status,
          interested_project: project || null,
          preferred_area: area || null,
          budget_min: amounts.budget_min,
          budget_max: amounts.budget_max,
          notes: notes || null,
          next_follow_up_at,
        };
    return { rowNumber, raw: row, data, errors, warnings };
  });
}

export function parseCsvText(text: string) {
  const result = Papa.parse<Record<string, string>>(text.replace(/^\uFEFF/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  return { rows: result.data, headers: result.meta.fields ?? [], parseErrors: result.errors };
}

/** CSV text with a UTF-8 BOM so Excel shows Arabic correctly. */
export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  return (
    "\uFEFF" +
    Papa.unparse({ fields: columns, data: rows.map((r) => columns.map((c) => r[c] ?? "")) })
  );
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const TEMPLATE_CSV = toCsv(
  [
    {
      full_name: "أحمد محمود",
      phone: "01012345678",
      email: "ahmed@example.com",
      source: "facebook",
      status: "new",
      interested_project: "Project name",
      preferred_area: "التجمع الخامس",
      budget_min: "3000000",
      budget_max: "5000000",
      notes: "",
      next_follow_up_at: "2026-12-01 11:00",
    },
  ],
  [...IMPORT_FIELDS],
);
