import { useEffect, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
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
import { Textarea } from "@/components/ui/textarea";
import { FieldError } from "@/components/app/states";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceData } from "@/hooks/use-workspace";
import { useI18n } from "@/lib/i18n";
import type { DictKey } from "@/lib/i18n-dict";
import {
  LEAD_SOURCES,
  LEAD_STATUSES,
  fromLocalInput,
  parseAmount,
  sourceKey,
  statusKey,
  type Lead,
  type LeadSource,
  type LeadStatus,
} from "@/lib/leads";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { invalidateLeadData } from "@/lib/queries";
import { fetchWorkspacePhones, hasDuplicatePhone } from "@/lib/lead-batches";

interface FormState {
  full_name: string;
  phone: string;
  email: string;
  source: LeadSource;
  status: LeadStatus;
  interested_project: string;
  preferred_area: string;
  budget_min: string;
  budget_max: string;
  notes: string;
  assigned_to: string;
  follow_up_at: string;
}

type Errors = Partial<Record<keyof FormState, DictKey>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function initialState(lead: Lead | undefined, defaultAssignee: string): FormState {
  return {
    full_name: lead?.full_name ?? "",
    phone: lead?.phone ?? "",
    email: lead?.email ?? "",
    source: lead?.source ?? "facebook",
    status: lead?.status ?? "new",
    interested_project: lead?.interested_project ?? "",
    preferred_area: lead?.preferred_area ?? "",
    budget_min: lead?.budget_min != null ? String(lead.budget_min) : "",
    budget_max: lead?.budget_max != null ? String(lead.budget_max) : "",
    notes: lead?.notes ?? "",
    assigned_to: lead ? (lead.assigned_to ?? "") : defaultAssignee,
    follow_up_at: "",
  };
}

export function LeadFormDialog({
  open,
  onOpenChange,
  lead,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead?: Lead | undefined;
  onSaved?: (lead: Lead) => void;
}) {
  const { t } = useI18n();
  const ws = useWorkspaceData();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(() => initialState(lead, ws.userId));
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [duplicatePhone, setDuplicatePhone] = useState<string>();
  const [partialLead, setPartialLead] = useState<Lead | null>(null);

  useEffect(() => {
    if (open) {
      setForm(initialState(lead, ws.userId));
      setErrors({});
      setDuplicatePhone(undefined);
    }
  }, [open, lead, ws.userId]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    if (key === "phone") setDuplicatePhone(undefined);
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const phoneCheck = form.phone.trim() ? normalizePhone(form.phone) : null;

  function validate(): Errors {
    const e: Errors = {};
    if (!form.full_name.trim()) e.full_name = "nameRequired";
    if (!form.phone.trim()) e.phone = "required";
    else if (phoneCheck && !phoneCheck.ok)
      e.phone = phoneCheck.error === "eg_mobile" ? "phoneEgMobileInvalid" : "phoneInvalid";
    if (form.email.trim() && !EMAIL_RE.test(form.email.trim())) e.email = "invalidEmail";
    const min = parseAmount(form.budget_min);
    const max = parseAmount(form.budget_max);
    if (Number.isNaN(min)) e.budget_min = "budgetInvalid";
    if (Number.isNaN(max)) e.budget_max = "budgetInvalid";
    if (min != null && max != null && !Number.isNaN(min) && !Number.isNaN(max) && max < min)
      e.budget_max = "budgetRange";
    return e;
  }

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    if (saving) return;
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) {
      const first = Object.keys(e)[0];
      document.getElementById(`lead-${first}`)?.focus();
      return;
    }
    setSaving(true);
    const payload = {
      full_name: form.full_name.trim(),
      phone: phoneCheck && phoneCheck.ok ? phoneCheck.e164 : form.phone.trim(),
      email: form.email.trim() || null,
      source: form.source,
      status: form.status,
      interested_project: form.interested_project.trim() || null,
      preferred_area: form.preferred_area.trim() || null,
      budget_min: parseAmount(form.budget_min) ?? null,
      budget_max: parseAmount(form.budget_max) ?? null,
      notes: form.notes.trim() || null,
      assigned_to: form.assigned_to || null,
    };
    try {
      if (duplicatePhone !== payload.phone) {
        let phones;
        try {
          phones = await fetchWorkspacePhones(ws.workspace.id);
        } catch {
          toast.error(t("csvCheckFailed"));
          return;
        }
        if (hasDuplicatePhone(phones, payload.phone, lead?.id)) {
          setDuplicatePhone(payload.phone);
          return;
        }
      }
      let saved: Lead;
      let followUpFailed = false;
      if (lead) {
        const { data, error } = await supabase
          .from("leads")
          .update(payload)
          .eq("workspace_id", ws.workspace.id)
          .eq("id", lead.id)
          .select()
          .single();
        if (error) throw error;
        saved = data;
      } else {
        const { data, error } = await supabase
          .from("leads")
          .insert({ ...payload, workspace_id: ws.workspace.id })
          .select()
          .single();
        if (error) throw error;
        saved = data;
        const due = fromLocalInput(form.follow_up_at);
        if (due) {
          const { data: followUp, error: fuErr } = await supabase
            .from("follow_ups")
            .insert({
              workspace_id: ws.workspace.id,
              lead_id: saved.id,
              title: t("scheduleFollowUp"),
              due_at: due,
              assigned_to: saved.assigned_to,
            })
            .select("id")
            .maybeSingle();
          followUpFailed = !!fuErr || !followUp;
        }
      }
      await invalidateLeadData(qc);
      if (followUpFailed) {
        setPartialLead(saved);
        toast.error(t("leadCreatedFollowUpFailed"), {
          action: {
            label: t("reviewLead"),
            onClick: () => void openPartialLead(saved),
          },
          duration: Infinity,
        });
        return;
      }
      toast.success(lead ? t("leadUpdated") : t("leadCreated"));
      onOpenChange(false);
      onSaved?.(saved);
    } catch (err) {
      toast.error(t("somethingWrong"), {
        description:
          err instanceof Error
            ? err.message
            : String((err as { message?: string })?.message ?? err),
      });
    } finally {
      setSaving(false);
    }
  }

  function openPartialLead(saved: Lead) {
    onOpenChange(false);
    void navigate({ to: "/leads/$leadId", params: { leadId: saved.id } });
  }

  const errProps = (key: keyof FormState) => ({
    id: `lead-${key}`,
    "aria-invalid": errors[key] ? true : undefined,
    "aria-describedby": errors[key] ? `lead-${key}-error` : undefined,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{lead ? t("editLead") : t("newLead")}</DialogTitle>
          <DialogDescription className="sr-only">{t("details")}</DialogDescription>
        </DialogHeader>
        {partialLead && (
          <div
            role="alert"
            className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm"
          >
            <p>{t("leadCreatedFollowUpFailed")}</p>
            <Button
              type="button"
              size="sm"
              className="mt-3"
              onClick={() => openPartialLead(partialLead)}
            >
              {t("reviewLead")}
            </Button>
          </div>
        )}
        <form onSubmit={onSubmit} noValidate>
          <fieldset disabled={saving} className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="lead-full_name">{t("fullName")} *</Label>
              <Input
                {...errProps("full_name")}
                value={form.full_name}
                maxLength={150}
                autoComplete="off"
                onChange={(e) => set("full_name", e.target.value)}
                className="mt-1.5"
              />
              <FieldError
                id="lead-full_name-error"
                message={errors.full_name && t(errors.full_name)}
              />
            </div>
            <div>
              <Label htmlFor="lead-phone">{t("phone")} *</Label>
              <Input
                {...errProps("phone")}
                type="tel"
                inputMode="tel"
                dir="ltr"
                value={form.phone}
                maxLength={25}
                placeholder="01012345678"
                onChange={(e) => set("phone", e.target.value)}
                className="mt-1.5 text-start"
              />
              {errors.phone ? (
                <FieldError id="lead-phone-error" message={t(errors.phone)} />
              ) : phoneCheck?.ok ? (
                <p className="mt-1 text-xs text-success">
                  {t("phoneWillSave", { phone: formatPhone(phoneCheck.e164) })}
                </p>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">{t("phoneHint")}</p>
              )}
              {duplicatePhone && (
                <p role="alert" className="mt-1 text-sm text-warning">
                  {t("duplicateSave")}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="lead-email">
                {t("email")} <span className="text-muted-foreground">({t("optional")})</span>
              </Label>
              <Input
                {...errProps("email")}
                type="email"
                dir="ltr"
                value={form.email}
                maxLength={255}
                onChange={(e) => set("email", e.target.value)}
                className="mt-1.5 text-start"
              />
              <FieldError id="lead-email-error" message={errors.email && t(errors.email)} />
            </div>
            <div>
              <Label htmlFor="lead-source">{t("source")}</Label>
              <NativeSelect
                id="lead-source"
                value={form.source}
                onChange={(e) => set("source", e.target.value as LeadSource)}
                className="mt-1.5"
              >
                {LEAD_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {t(sourceKey(s))}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div>
              <Label htmlFor="lead-status">{t("status")}</Label>
              <NativeSelect
                id="lead-status"
                value={form.status}
                onChange={(e) => set("status", e.target.value as LeadStatus)}
                className="mt-1.5"
              >
                {LEAD_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(statusKey(s))}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div>
              <Label htmlFor="lead-interested_project">{t("interestedProject")}</Label>
              <Input
                id="lead-interested_project"
                value={form.interested_project}
                maxLength={200}
                onChange={(e) => set("interested_project", e.target.value)}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="lead-preferred_area">{t("preferredArea")}</Label>
              <Input
                id="lead-preferred_area"
                value={form.preferred_area}
                maxLength={200}
                onChange={(e) => set("preferred_area", e.target.value)}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="lead-budget_min">{t("budgetMin")}</Label>
              <Input
                {...errProps("budget_min")}
                inputMode="numeric"
                dir="ltr"
                value={form.budget_min}
                placeholder="3,000,000"
                onChange={(e) => set("budget_min", e.target.value)}
                className="mt-1.5 text-start"
              />
              <FieldError
                id="lead-budget_min-error"
                message={errors.budget_min && t(errors.budget_min)}
              />
            </div>
            <div>
              <Label htmlFor="lead-budget_max">{t("budgetMax")}</Label>
              <Input
                {...errProps("budget_max")}
                inputMode="numeric"
                dir="ltr"
                value={form.budget_max}
                placeholder="5,000,000"
                onChange={(e) => set("budget_max", e.target.value)}
                className="mt-1.5 text-start"
              />
              <FieldError
                id="lead-budget_max-error"
                message={errors.budget_max && t(errors.budget_max)}
              />
            </div>
            <div>
              <Label htmlFor="lead-assigned_to">{t("assignedTo")}</Label>
              <NativeSelect
                id="lead-assigned_to"
                value={form.assigned_to}
                onChange={(e) => set("assigned_to", e.target.value)}
                className="mt-1.5"
              >
                <option value="">{t("unassigned")}</option>
                {ws.members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.full_name || (m.user_id === ws.userId ? ws.email : m.user_id.slice(0, 8))}
                  </option>
                ))}
              </NativeSelect>
            </div>
            {!lead && (
              <div>
                <Label htmlFor="lead-follow_up_at">
                  {t("scheduleFollowUp")}{" "}
                  <span className="text-muted-foreground">({t("optional")})</span>
                </Label>
                <Input
                  id="lead-follow_up_at"
                  type="datetime-local"
                  value={form.follow_up_at}
                  onChange={(e) => set("follow_up_at", e.target.value)}
                  className="mt-1.5"
                />
                <p className="mt-1 text-xs text-muted-foreground">{t("scheduleFollowUpHint")}</p>
              </div>
            )}
            <div className="sm:col-span-2">
              <Label htmlFor="lead-notes">{t("notes")}</Label>
              <Textarea
                id="lead-notes"
                value={form.notes}
                maxLength={5000}
                rows={3}
                onChange={(e) => set("notes", e.target.value)}
                className="mt-1.5"
              />
            </div>
            <DialogFooter className="sm:col-span-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={saving || !!partialLead}>
                {saving ? t("saving") : t(duplicatePhone ? "saveAnyway" : "save")}
              </Button>
            </DialogFooter>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}
