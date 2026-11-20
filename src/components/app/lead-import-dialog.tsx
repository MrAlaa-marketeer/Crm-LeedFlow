import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  downloadCsv,
  IMPORT_FIELDS,
  mapHeaders,
  REQUIRED_FIELDS,
  TEMPLATE_CSV,
  type ImportField,
  type parseCsvText,
  type RowIssue,
} from "@/lib/csv";
import { useI18n } from "@/lib/i18n";
import type { DictKey } from "@/lib/i18n-dict";
import {
  fetchWorkspacePhones,
  insertImportedLeads,
  previewImport,
  readImportFile,
} from "@/lib/lead-batches";
import { invalidateLeadData } from "@/lib/queries";

const fieldLabels: Record<ImportField, DictKey> = {
  full_name: "fullName",
  phone: "phone",
  email: "email",
  source: "source",
  status: "status",
  interested_project: "interestedProject",
  preferred_area: "preferredArea",
  budget_min: "budgetMin",
  budget_max: "budgetMax",
  notes: "notes",
  next_follow_up_at: "nextFollowUp",
};

export function LeadImportDialog({
  workspaceId,
  close,
}: {
  workspaceId: string;
  close: () => void;
}) {
  const { t, dir } = useI18n();
  const qc = useQueryClient();
  const [parsed, setParsed] = useState<ReturnType<typeof parseCsvText>>();
  const [mapping, setMapping] = useState<Partial<Record<ImportField, string>>>({});
  const [issue, setIssue] = useState<RowIssue>();
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<
    Awaited<ReturnType<typeof insertImportedLeads>> & { skipped: number }
  >();
  const phones = useQuery({
    queryKey: ["leads", workspaceId, "import-phones"],
    queryFn: () => fetchWorkspacePhones(workspaceId),
    enabled: !!parsed && !result,
    retry: false,
  });
  const missing = REQUIRED_FIELDS.filter((field) => !mapping[field]);
  const rows = useMemo(
    () =>
      parsed && phones.data && REQUIRED_FIELDS.every((field) => mapping[field])
        ? previewImport(parsed, mapping, phones.data)
        : [],
    [parsed, mapping, phones.data],
  );
  const ready = rows.filter((row) => row.data).length;
  const duplicates = rows.filter((row) => row.duplicate).length;

  async function selectFile(file?: File) {
    setParsed(undefined);
    setResult(undefined);
    setIssue(undefined);
    setMapping({});
    if (!file) return;
    setReading(true);
    try {
      const read = await readImportFile(file);
      if (read.issue) setIssue(read.issue);
      else if (read.parsed) {
        setMapping(mapHeaders(read.parsed.headers).map);
        setParsed(read.parsed);
      }
    } catch {
      setIssue({ key: "csvUnreadable" });
    } finally {
      setReading(false);
    }
  }

  async function submit() {
    if (!parsed || saving || result || !ready) return;
    setSaving(true);
    setIssue(undefined);
    try {
      const fresh = await fetchWorkspacePhones(workspaceId);
      const checked = previewImport(parsed, mapping, fresh);
      const entries = checked.flatMap(({ rowNumber, data }) => (data ? [{ rowNumber, data }] : []));
      const saved = await insertImportedLeads(workspaceId, entries, t("followUpFromImport"));
      setResult({ ...saved, skipped: checked.filter((row) => row.duplicate).length });
      await invalidateLeadData(qc);
    } catch {
      setIssue({ key: "somethingWrong" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) close();
      }}
    >
      <DialogContent dir={dir} className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("importTitle")}</DialogTitle>
          <DialogDescription className="sr-only">{t("importIntro")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <Label htmlFor="lead-csv-file">{t("chooseFile")}</Label>
            <Input
              id="lead-csv-file"
              className="mt-1"
              type="file"
              accept=".csv,text/csv"
              disabled={reading || saving}
              onChange={(event) => void selectFile(event.target.files?.[0])}
            />
          </div>
          <Button
            variant="outline"
            onClick={() => downloadCsv("leadflow-template.csv", TEMPLATE_CSV)}
          >
            <Download className="size-4" />
            {t("downloadTemplate")}
          </Button>
        </div>
        {issue && (
          <p role="alert" className="text-sm text-destructive">
            {t(issue.key, issue.vars)}
          </p>
        )}
        {parsed && !result && (
          <>
            <fieldset disabled={saving} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <legend className="mb-2 text-sm font-semibold">{t("csvMapping")}</legend>
              {IMPORT_FIELDS.map((field) => (
                <label key={field} className="min-w-0 text-sm">
                  {t(fieldLabels[field])}
                  {REQUIRED_FIELDS.includes(field) && " *"}
                  <NativeSelect
                    className="mt-1"
                    value={mapping[field] ?? ""}
                    onChange={(event) =>
                      setMapping((current) => ({ ...current, [field]: event.target.value }))
                    }
                  >
                    <option value="">{t("csvIgnore")}</option>
                    {parsed.headers.filter(Boolean).map((header) => (
                      <option
                        key={header}
                        value={header}
                        disabled={IMPORT_FIELDS.some(
                          (other) => other !== field && mapping[other] === header,
                        )}
                      >
                        {header}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
              ))}
            </fieldset>
            {missing.length > 0 && (
              <p className="text-sm text-destructive">
                {t("missingColumns", {
                  cols: missing.map((field) => t(fieldLabels[field])).join(", "),
                })}
              </p>
            )}
            {phones.isError && (
              <div className="flex flex-wrap items-center gap-2 text-sm" role="alert">
                {t("csvCheckFailed")}{" "}
                <Button variant="outline" size="sm" onClick={() => void phones.refetch()}>
                  {t("retry")}
                </Button>
              </div>
            )}
            {rows.length > 0 && (
              <>
                <p className="text-sm" aria-live="polite">
                  {t("importSummary", {
                    total: rows.length,
                    valid: ready,
                    invalid: rows.length - ready - duplicates,
                  })}
                  {" · "}
                  {t("csvSkipped", { count: duplicates })}
                </p>
                <div className="max-h-64 overflow-auto rounded-md border">
                  <table className="w-full min-w-96 text-start text-sm">
                    <thead className="sticky top-0 bg-muted">
                      <tr>
                        {(["fullName", "phone", "status"] as const).map((key) => (
                          <th key={key} className="px-3 py-2 text-start">
                            {t(key)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {rows.map((row) => (
                        <tr key={row.rowNumber}>
                          <td className="max-w-44 break-all px-3 py-2">
                            <span className="block text-xs text-muted-foreground">
                              {t("rowLabel", { row: row.rowNumber })}
                            </span>
                            {row.raw[mapping.full_name ?? ""]}
                          </td>
                          <td className="px-3 py-2">
                            <bdi>{row.raw[mapping.phone ?? ""]}</bdi>
                          </td>
                          <td className="max-w-72 break-words px-3 py-2">
                            {row.errors.map((error, i) => (
                              <div className="text-destructive" key={i}>
                                {t(error.key, error.vars)}
                              </div>
                            ))}
                            {row.duplicate && (
                              <div className="text-warning">
                                {t(row.duplicate.key, row.duplicate.vars)}
                              </div>
                            )}
                            {row.data && t("csvReady")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
        {result && (
          <div aria-live="polite" className="space-y-2 text-sm">
            <p>
              {t("importDone", { count: result.imported })} ·{" "}
              {t("csvSkipped", { count: result.skipped })}
            </p>
            {result.failures.length > 0 && (
              <ul className="max-h-48 overflow-y-auto text-destructive">
                {result.failures.map(({ row, key }) => (
                  <li key={row}>
                    {t("rowLabel", { row })}: {t(key)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={saving}>
            {t(result ? "csvFinish" : "cancel")}
          </Button>
          {!result && (
            <Button
              disabled={!ready || saving || phones.isFetching || phones.isError}
              onClick={() => void submit()}
            >
              <Upload className="size-4" />
              {t(saving ? "importing" : "importValid", { count: ready })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
