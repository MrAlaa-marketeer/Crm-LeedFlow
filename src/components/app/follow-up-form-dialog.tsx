import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Search } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { FieldError } from "@/components/app/states";
import { DemoBadge, StatusBadge } from "@/components/app/badges";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceData } from "@/hooks/use-workspace";
import { useI18n } from "@/lib/i18n";
import type { DictKey } from "@/lib/i18n-dict";
import {
  fromLocalInput,
  sanitizeSearch,
  toLocalInput,
  type FollowUp,
  type Lead,
} from "@/lib/leads";
import { formatPhone } from "@/lib/phone";
import { invalidateLeadData, mutationErrorKey } from "@/lib/queries";
import { cn } from "@/lib/utils";

type PickedLead = Pick<Lead, "id" | "full_name" | "phone" | "status" | "is_demo">;

function defaultDue() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(11, 0, 0, 0);
  return toLocalInput(d);
}

export function FollowUpFormDialog({
  open,
  onOpenChange,
  followUp,
  lead,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  followUp?: FollowUp;
  lead?: PickedLead | null;
}) {
  const { t } = useI18n();
  const ws = useWorkspaceData();
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [due, setDue] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [picked, setPicked] = useState<PickedLead | null>(null);
  const [search, setSearch] = useState("");
  const [errors, setErrors] = useState<{ title?: DictKey; due?: DictKey; lead?: DictKey }>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(followUp?.title ?? "");
    setNotes(followUp?.notes ?? "");
    setDue(followUp ? toLocalInput(followUp.due_at) : defaultDue());
    setAssignedTo(followUp ? (followUp.assigned_to ?? "") : ws.userId);
    setPicked(lead ?? null);
    setSearch("");
    setErrors({});
  }, [open, followUp, lead, ws.userId]);

  const needsPicker = !lead && !followUp;
  const q = sanitizeSearch(search);
  const results = useQuery({
    queryKey: ["lead-picker", ws.workspace.id, q],
    enabled: open && needsPicker,
    queryFn: async () => {
      let query = supabase
        .from("leads")
        .select("id, full_name, phone, status, is_demo")
        .eq("workspace_id", ws.workspace.id)
        .is("archived_at", null)
        .order("updated_at", { ascending: false })
        .limit(8);
      if (q) query = query.or(`full_name.ilike.%${q}%,phone.ilike.%${q.replace(/\D/g, "") || q}%`);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const dueIso = fromLocalInput(due);
  const inPast = dueIso && new Date(dueIso) < new Date();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!title.trim()) errs.title = "titleRequired";
    if (!dueIso) errs.due = "dateRequired";
    if (needsPicker && !picked) errs.lead = "leadRequired";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      if (followUp) {
        const { data, error } = await supabase
          .from("follow_ups")
          .update({
            title: title.trim(),
            notes: notes.trim() || null,
            due_at: dueIso!,
            assigned_to: assignedTo || null,
          })
          .eq("id", followUp.id)
          .select("id")
          .maybeSingle();
        if (error) throw error;
        if (!data) throw new Error("mutation_no_rows");
      } else {
        const leadId = (lead ?? picked)!.id;
        const { data, error } = await supabase
          .from("follow_ups")
          .insert({
            workspace_id: ws.workspace.id,
            lead_id: leadId,
            title: title.trim(),
            notes: notes.trim() || null,
            due_at: dueIso!,
            assigned_to: assignedTo || null,
          })
          .select("id")
          .maybeSingle();
        if (error) throw error;
        if (!data) throw new Error("mutation_no_rows");
      }
      await invalidateLeadData(qc);
      toast.success(followUp ? t("followUpUpdated") : t("followUpCreated"));
      onOpenChange(false);
    } catch (err) {
      toast.error(t(mutationErrorKey(err)));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{followUp ? t("editFollowUp") : t("newFollowUp")}</DialogTitle>
          <DialogDescription>{t("inAppOnly")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {needsPicker ? (
            <fieldset>
              <legend className="text-sm font-medium">{t("lead")} *</legend>
              {picked ? (
                <div className="mt-1.5 flex items-center justify-between gap-2 rounded-lg border bg-brand-soft px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{picked.full_name}</p>
                    <p className="text-xs text-muted-foreground ltr-nums">
                      {formatPhone(picked.phone)}
                    </p>
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setPicked(null)}>
                    {t("edit")}
                  </Button>
                </div>
              ) : (
                <div className="mt-1.5">
                  <div className="relative">
                    <Search
                      aria-hidden="true"
                      className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                    />
                    <Input
                      aria-label={t("searchLeadPlaceholder")}
                      placeholder={t("searchLeadPlaceholder")}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="ps-9"
                      aria-invalid={errors.lead ? true : undefined}
                    />
                  </div>
                  <ul
                    className="mt-2 max-h-52 space-y-1 overflow-y-auto"
                    role="listbox"
                    aria-label={t("selectLead")}
                  >
                    {results.isLoading && (
                      <li className="px-2 py-2 text-sm text-muted-foreground">{t("loading")}</li>
                    )}
                    {results.data?.length === 0 && (
                      <li className="px-2 py-2 text-sm text-muted-foreground">
                        {t("noResultsTitle")}
                      </li>
                    )}
                    {results.data?.map((l) => (
                      <li key={l.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={false}
                          onClick={() => {
                            setPicked(l);
                            setErrors(({ lead: _cleared, ...rest }) => rest);
                          }}
                          className={cn(
                            "flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-start hover:bg-accent focus-visible:bg-accent",
                          )}
                        >
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5 truncate text-sm font-medium">
                              {l.full_name} {l.is_demo && <DemoBadge />}
                            </span>
                            <span className="block text-xs text-muted-foreground ltr-nums">
                              {formatPhone(l.phone)}
                            </span>
                          </span>
                          <StatusBadge status={l.status} />
                        </button>
                      </li>
                    ))}
                  </ul>
                  <FieldError id="fu-lead-error" message={errors.lead && t(errors.lead)} />
                </div>
              )}
            </fieldset>
          ) : (
            lead && (
              <div className="flex items-center gap-2 rounded-lg border bg-muted px-3 py-2 text-sm">
                <Check aria-hidden="true" className="h-4 w-4 text-success" />
                <span className="font-medium">{lead.full_name}</span>
              </div>
            )
          )}
          <div>
            <Label htmlFor="fu-title">{t("followUpTitleLabel")} *</Label>
            <Input
              id="fu-title"
              value={title}
              maxLength={200}
              placeholder={t("followUpTitlePlaceholder")}
              onChange={(e) => setTitle(e.target.value)}
              aria-invalid={errors.title ? true : undefined}
              aria-describedby={errors.title ? "fu-title-error" : undefined}
              className="mt-1.5"
            />
            <FieldError id="fu-title-error" message={errors.title && t(errors.title)} />
          </div>
          <div>
            <Label htmlFor="fu-due">{t("dueAt")} *</Label>
            <Input
              id="fu-due"
              type="datetime-local"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              aria-invalid={errors.due ? true : undefined}
              aria-describedby="fu-due-help"
              className="mt-1.5"
            />
            {errors.due ? (
              <FieldError id="fu-due-help" message={t(errors.due)} />
            ) : (
              inPast && (
                <p id="fu-due-help" className="mt-1 text-xs text-warning-foreground">
                  {t("dueInPast")}
                </p>
              )
            )}
          </div>
          <div>
            <Label htmlFor="fu-assignee">{t("assignedTo")}</Label>
            <select
              id="fu-assignee"
              value={assignedTo}
              onChange={(event) => setAssignedTo(event.target.value)}
              className="mt-1.5 h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
              dir="auto"
            >
              <option value="">{t("unassigned")}</option>
              {ws.members.map((member) => (
                <option key={member.user_id} value={member.user_id}>
                  {member.full_name || member.user_id.slice(0, 8)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="fu-notes">
              {t("notes")} <span className="text-muted-foreground">({t("optional")})</span>
            </Label>
            <Textarea
              id="fu-notes"
              rows={2}
              maxLength={2000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1.5"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? t("saving") : t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
