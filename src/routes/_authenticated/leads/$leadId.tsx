import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import {
  Activity,
  Archive,
  Building2,
  CalendarClock,
  Clock3,
  FileText,
  Mail,
  MapPin,
  Pencil,
  Phone,
  PhoneCall,
  Plus,
  MessageCircle,
  UserRound,
  UserX,
  Wallet,
  RotateCcw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { DemoBadge, SourceBadge, StatusBadge } from "@/components/app/badges";
import { FollowUpItem } from "@/components/app/follow-up-item";
import { FollowUpFormDialog } from "@/components/app/follow-up-form-dialog";
import { LeadFormDialog } from "@/components/app/lead-form-dialog";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { WhatsAppDialog } from "@/components/app/whatsapp-dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { EmptyState, ErrorState, ListSkeleton, PageHeader } from "@/components/app/states";

import { useWorkspaceData } from "@/hooks/use-workspace";
import { useI18n } from "@/lib/i18n";
import {
  formatBudget,
  formatDate,
  formatDateTime,
  fromLocalInput,
  toLocalInput,
  LEAD_STATUSES,
  statusKey,
} from "@/lib/leads";
import { formatPhone } from "@/lib/phone";
import {
  deriveLeadScoreInput,
  matchUnit,
  monthlyInstallment,
  scoreLead,
} from "@/lib/phase-features";
import { ActivityLog, type CallEntry, type VisitEntry } from "@/components/app/activity-log";
import {
  invalidateLeadData,
  leadActivitiesQuery,
  leadFollowUpsQuery,
  leadQuery,
  mutationErrorKey,
  setLeadArchived,
  updateLeadStatus,
} from "@/lib/queries";
import { toast } from "sonner";
import { inventoryDb, type Project, type Property } from "@/lib/inventory-client";
import { matchesLeadPreferences } from "@/lib/inventory-matching";

export const Route = createFileRoute("/_authenticated/leads/$leadId")({
  head: () => ({
    meta: [
      { title: "تفاصيل العميل — LeadFlow | Lead details" },
      {
        name: "description",
        content: "Lead contact details, interest and follow-ups.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),

  loader: async ({ context, params }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(leadQuery(params.leadId)),
      context.queryClient.ensureQueryData(leadFollowUpsQuery(params.leadId)),
    ]);
  },

  pendingComponent: () => <ListSkeleton rows={4} />,
  errorComponent: LeadError,
  component: LeadDetail,
});

function LeadError({ error }: { error: unknown }) {
  const router = useRouter();

  return <ErrorState error={error} onRetry={() => router.invalidate()} />;
}

function DetailField({
  icon: Icon,
  label,
  value,
  direction,
}: {
  icon: typeof Phone;
  label: string;
  value: string;
  direction?: "ltr" | "rtl";
}) {
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-lg border bg-card p-3">
      <div className="mt-0.5 rounded-md bg-muted p-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p dir={direction} className="mt-1 break-words text-sm font-medium">
          {value}
        </p>
      </div>
    </div>
  );
}

function LeadDetail() {
  const { t, locale, dir } = useI18n();
  const { leadId } = Route.useParams();
  const ws = useWorkspaceData();

  const [editOpen, setEditOpen] = useState(false);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [whatsAppOpen, setWhatsAppOpen] = useState(false);
  const qc = useQueryClient();

  const { data: lead } = useSuspenseQuery(leadQuery(leadId));
  const { data: followUps } = useSuspenseQuery(leadFollowUpsQuery(leadId));
  const activitiesQuery = useQuery(leadActivitiesQuery(leadId, ws.workspace.id));

  const statusMutation = useMutation({
    mutationFn: (status: (typeof LEAD_STATUSES)[number]) => updateLeadStatus(leadId, status),
    onSuccess: async (_data, status) => {
      await invalidateLeadData(qc);
      toast.success(t("statusChanged", { status: t(statusKey(status)) }));
    },
    onError: (error) => {
      const detail = t(mutationErrorKey(error));
      toast.error(t("somethingWrong"), { description: detail });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (archived: boolean) => setLeadArchived(leadId, archived),
    onSuccess: async (_data, archived) => {
      await invalidateLeadData(qc);
      setArchiveOpen(false);
      toast.success(t(archived ? "leadArchived" : "leadRestored"));
    },
    onError: (error) => {
      const detail = t(mutationErrorKey(error));
      toast.error(t("somethingWrong"), { description: detail });
    },
  });

  if (!lead) {
    return <EmptyState icon={UserX} title={t("leadNotFoundTitle")} body={t("leadNotFoundBody")} />;
  }

  const assignedMember = ws.members.find((member) => member.user_id === lead.assigned_to);

  const assignedName = lead.assigned_to
    ? assignedMember?.full_name ||
      (lead.assigned_to === ws.userId ? ws.email : lead.assigned_to.slice(0, 8))
    : t("unassigned");

  const budget = formatBudget(lead.budget_min, lead.budget_max, locale);

  return (
    <div className="space-y-6">
      <PageHeader title={lead.full_name}>
        <StatusBadge status={lead.status} />
        <SourceBadge source={lead.source} />

        {lead.is_demo && <DemoBadge />}

        <Button size="sm" variant="whatsapp" onClick={() => setWhatsAppOpen(true)}>
          <MessageCircle className="h-4 w-4" />
          {t("whatsapp")}
        </Button>
        <Button size="sm" variant="outline" asChild>
          <a
            href={`tel:${lead.phone}`}
            onClick={() => {
              void (supabase as any).from("lead_activities").insert({
                lead_id: lead.id,
                workspace_id: ws.workspace.id,
                actor_id: ws.userId,
                activity_type: "lead.response_call",
              });
            }}
          >
            <PhoneCall className="size-4" />
            {t("callLead")}
          </a>
        </Button>

        <Button size="sm" onClick={() => setEditOpen(true)} className="gap-2">
          <Pencil className="h-4 w-4" />
          {t("edit")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setArchiveOpen(true)}
          disabled={archiveMutation.isPending}
        >
          {lead.archived_at ? <RotateCcw className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
          {t(lead.archived_at ? "restore" : "archive")}
        </Button>
      </PageHeader>

      {lead.archived_at && (
        <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          {t("archivedBadge")}
        </p>
      )}

      <section className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
        <div className="w-full max-w-xs">
          <label
            htmlFor="lead-detail-status"
            className="mb-1.5 block text-xs text-muted-foreground"
          >
            {t("changeStatus")}
          </label>
          <NativeSelect
            id="lead-detail-status"
            value={lead.status}
            disabled={statusMutation.isPending}
            onChange={(event) =>
              statusMutation.mutate(event.target.value as (typeof LEAD_STATUSES)[number])
            }
          >
            {LEAD_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(statusKey(status))}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            {t("createdAt")}: {formatDate(lead.created_at, locale)}
          </span>
          <span>
            {t("updatedAt")}: {formatDate(lead.updated_at, locale)}
          </span>
          <span>
            {t("statusChangedAt")}: {formatDate(lead.status_changed_at, locale)}
          </span>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <UserRound className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold">{t("details")}</h2>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <DetailField
            icon={Phone}
            label={t("phone")}
            value={formatPhone(lead.phone)}
            direction="ltr"
          />
          <DetailField
            icon={Clock3}
            label={t("responseTimer")}
            value={
              (
                lead as typeof lead & {
                  first_response_at?: string | null;
                  first_response_minutes?: number | null;
                }
              ).first_response_at
                ? t("responseMinutes", {
                    minutes:
                      (lead as typeof lead & { first_response_minutes?: number | null })
                        .first_response_minutes ?? 0,
                  })
                : t("waitingResponse", {
                    minutes: Math.max(
                      0,
                      Math.floor((Date.now() - new Date(lead.created_at).getTime()) / 60000),
                    ),
                  })
            }
          />

          <DetailField
            icon={Mail}
            label={t("email")}
            value={lead.email || t("noValue")}
            direction="ltr"
          />

          <DetailField icon={UserRound} label={t("assignedTo")} value={assignedName} />
          <DetailField
            icon={CalendarClock}
            label={t("nextFollowUp")}
            value={
              lead.next_follow_up_at ? formatDateTime(lead.next_follow_up_at, locale) : t("noValue")
            }
            direction="ltr"
          />
        </div>
        <LeadInventoryPanel lead={lead} workspaceId={ws.workspace.id} />
      </section>

      <LeadScorePanel
        lead={lead}
        workspaceId={ws.workspace.id}
        interactionCount={(activitiesQuery.data?.length ?? 0) + followUps.length}
      />
      <LeadMatchingUnits lead={lead} workspaceId={ws.workspace.id} />

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold">{t("interestedProject")}</h2>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <DetailField
            icon={Building2}
            label={t("interestedProject")}
            value={lead.interested_project || t("noValue")}
          />

          <DetailField
            icon={MapPin}
            label={t("preferredArea")}
            value={lead.preferred_area || t("noValue")}
          />

          <DetailField icon={Wallet} label={t("colBudget")} value={budget || t("noValue")} />
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold">{t("notes")}</h2>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-card">
          {lead.notes ? (
            <p className="whitespace-pre-wrap text-sm leading-7">{lead.notes}</p>
          ) : (
            <p className="text-sm text-muted-foreground">{t("noValue")}</p>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold">{t("activityTimeline")}</h2>
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
            {activitiesQuery.data?.length ?? 0}
          </span>
        </div>
        {activitiesQuery.isPending ? (
          <ListSkeleton rows={3} />
        ) : activitiesQuery.isError ? (
          <ErrorState
            error={activitiesQuery.error}
            onRetry={() => void activitiesQuery.refetch()}
          />
        ) : activitiesQuery.data.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-center">
            <p className="text-sm text-muted-foreground">{t("noActivityYet")}</p>
          </div>
        ) : (
          <ol className="space-y-3 border-s border-border ps-4">
            {activitiesQuery.data.map((activity) => {
              const details =
                activity.details &&
                typeof activity.details === "object" &&
                !Array.isArray(activity.details)
                  ? (activity.details as Record<string, unknown>)
                  : {};
              const actor =
                activity.actor_id === ws.userId
                  ? t("activityByYou")
                  : ws.members.find((member) => member.user_id === activity.actor_id)?.full_name ||
                    t("activityByMember");
              const statusName = (value: unknown) =>
                typeof value === "string" &&
                LEAD_STATUSES.includes(value as (typeof LEAD_STATUSES)[number])
                  ? t(statusKey(value as (typeof LEAD_STATUSES)[number]))
                  : String(value ?? "—");
              let description = t("activityUnknown");
              switch (activity.activity_type as string) {
                case "lead.created":
                  description = t("activityLeadCreated");
                  break;
                case "lead.updated": {
                  const fieldLabels: Record<string, string> = {
                    full_name: t("fullName"),
                    phone: t("phone"),
                    email: t("email"),
                    source: t("source"),
                    interested_project: t("interestedProject"),
                    interested_project_id: t("inventoryProjectLink"),
                    interested_property_id: t("inventoryPropertyLink"),
                    preferred_area: t("preferredArea"),
                    budget_min: t("budgetMin"),
                    budget_max: t("budgetMax"),
                    notes: t("notes"),
                    assigned_to: t("assignedTo"),
                  };
                  const changedFields = details["changed_fields"];
                  const fields = Array.isArray(changedFields)
                    ? changedFields
                        .filter((field): field is string => typeof field === "string")
                        .map((field) => fieldLabels[field] ?? field)
                    : [];
                  description = fields.length
                    ? `${t("activityLeadUpdated")} · ${fields.join(", ")}`
                    : t("activityLeadUpdated");
                  break;
                }
                case "lead.status_changed":
                  description = t("activityStatusChanged", {
                    from: statusName(details["from"]),
                    to: statusName(details["to"]),
                  });
                  break;
                case "lead.archived":
                  description = t("activityLeadArchived");
                  break;
                case "lead.restored":
                  description = t("activityLeadRestored");
                  break;
                case "lead.deleted":
                  description = t("activityLeadDeleted");
                  break;
                case "follow_up.created":
                  description = t("activityFollowUpCreated");
                  break;
                case "follow_up.updated":
                  description = t("activityFollowUpUpdated");
                  break;
                case "follow_up.completed":
                  description = t("activityFollowUpCompleted");
                  break;
                case "follow_up.reopened":
                  description = t("activityFollowUpReopened");
                  break;
                case "follow_up.deleted":
                  description = t("activityFollowUpDeleted");
                  break;
                case "lead.response_call":
                  description =
                    dir === "rtl" ? "تم تسجيل مكالمة مع العميل" : "Call logged with lead";
                  break;
                case "lead.response_whatsapp":
                  description =
                    dir === "rtl"
                      ? "تم إرسال رسالة واتساب للعميل"
                      : "WhatsApp message sent to lead";
                  break;
              }
              return (
                <li key={activity.id} className="relative space-y-1 pb-1">
                  <span className="absolute -start-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary" />
                  <p className="text-sm font-medium">{description}</p>
                  <p className="text-xs text-muted-foreground">
                    {actor} · {formatDateTime(activity.created_at, locale)}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">{t("followUpsTitle")}</h2>

            <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
              {followUps.length}
            </span>
          </div>

          <Button size="sm" onClick={() => setFollowUpOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            {t("newFollowUp")}
          </Button>
        </div>

        {followUps.length > 0 ? (
          <ul className="space-y-2">
            {followUps.map((item) => (
              <FollowUpItem key={item.id} item={item} showLead={false} />
            ))}
          </ul>
        ) : (
          <div className="rounded-xl border border-dashed p-6 text-center">
            <p className="text-sm text-muted-foreground">{t("noFollowUpsLead")}</p>
          </div>
        )}
      </section>

      <LeadCallsVisits lead={lead} workspaceId={ws.workspace.id} userId={ws.userId} />

      <LeadFormDialog open={editOpen} onOpenChange={setEditOpen} lead={lead} />

      <FollowUpFormDialog open={followUpOpen} onOpenChange={setFollowUpOpen} lead={lead} />
      <WhatsAppDialog lead={lead} open={whatsAppOpen} onOpenChange={setWhatsAppOpen} />
      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={t(lead.archived_at ? "restoreLeadTitle" : "archiveLeadTitle")}
        body={t(lead.archived_at ? "restoreLeadBody" : "archiveLeadBody", { name: lead.full_name })}
        confirmLabel={t(lead.archived_at ? "restore" : "archive")}
        confirmVariant={lead.archived_at ? "default" : "destructive"}
        onConfirm={() => archiveMutation.mutate(!lead.archived_at)}
      />
    </div>
  );
}

type LeadWithInventoryLinks = {
  id: string;
  interested_project: string | null;
  interested_project_id?: string | null;
  interested_property_id?: string | null;
  budget_min: number | null;
  budget_max: number | null;
  preferred_area: string | null;
};

function LeadInventoryPanel({
  lead,
  workspaceId,
}: {
  lead: LeadWithInventoryLinks;
  workspaceId: string;
}) {
  const { t, dir } = useI18n();
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState(lead.interested_project_id ?? "");
  const [propertyId, setPropertyId] = useState(lead.interested_property_id ?? "");
  const [search, setSearch] = useState("");
  const projects = useQuery({
    queryKey: ["inventory", "projects", workspaceId],
    queryFn: async () => {
      const { data, error } = await inventoryDb
        .from("projects")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("name")
        .limit(1000);
      if (error) throw error;
      return data as Project[];
    },
  });
  const properties = useQuery({
    queryKey: ["inventory", "properties", workspaceId],
    queryFn: async () => {
      const { data, error } = await inventoryDb
        .from("properties")
        .select("*, project:projects(name, location)")
        .eq("workspace_id", workspaceId)
        .order("price")
        .limit(1000);
      if (error) throw error;
      return data as Property[];
    },
  });
  const linkedProperty = (properties.data ?? []).find((p) => p.id === propertyId);
  const linkedProject = (projects.data ?? []).find((p) => p.id === projectId);
  const suggestions = (properties.data ?? [])
    .filter((item) => matchesLeadPreferences(item, lead, search))
    .slice(0, 5);

  if (projects.isError || properties.isError) {
    return (
      <ErrorState
        error={projects.error || properties.error}
        onRetry={() => {
          void qc.invalidateQueries({ queryKey: ["inventory", "projects", workspaceId] });
          void qc.invalidateQueries({ queryKey: ["inventory", "properties", workspaceId] });
        }}
      />
    );
  }

  async function saveLink(nextProjectId = projectId, nextPropertyId = propertyId) {
    try {
      const { error } = await inventoryDb
        .from("leads")
        .update({
          interested_project_id: nextProjectId || null,
          interested_property_id: nextPropertyId || null,
        })
        .eq("id", lead.id)
        .eq("workspace_id", workspaceId);
      if (error) throw error;
      setProjectId(nextProjectId);
      setPropertyId(nextPropertyId);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["lead", lead.id] }),
        qc.invalidateQueries({ queryKey: ["lead-activities"] }),
      ]);
      toast.success(t("inventoryLeadLinkSaved"));
    } catch {
      toast.error(t("somethingWrong"));
    }
  }

  return (
    <div className="space-y-3 rounded-xl border bg-card p-4" dir={dir}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">{t("properties")}</h3>
        <span className="text-xs text-muted-foreground">
          {linkedProject?.name || lead.interested_project || t("noProject")}
          {linkedProperty ? ` · ${linkedProperty.unit_code}` : ""}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <NativeSelect
          value={projectId}
          onChange={(event) => {
            setProjectId(event.target.value);
            setPropertyId("");
          }}
          aria-label={t("projects")}
        >
          <option value="">{t("noProject")}</option>
          {(projects.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          value={propertyId}
          onChange={(event) => setPropertyId(event.target.value)}
          aria-label={t("properties")}
        >
          <option value="">{t("noProject")}</option>
          {(properties.data ?? [])
            .filter((p) => !projectId || p.project_id === projectId)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.unit_code} · {p.project?.name} · {p.availability}
              </option>
            ))}
        </NativeSelect>
        <Button size="sm" onClick={() => void saveLink()}>
          {t("linkToLead")}
        </Button>
      </div>
      <div className="space-y-2">
        <input
          className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("searchInventory")}
          aria-label={t("searchInventory")}
        />
        <p className="text-xs font-medium text-muted-foreground">{t("recommended")}</p>
        {properties.isPending ? (
          <p className="text-xs text-muted-foreground">{t("loading")}</p>
        ) : suggestions.length ? (
          <ul className="space-y-1">
            {suggestions.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs"
              >
                <span>
                  {p.project?.name} · {p.unit_code} · {p.price ?? "—"}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void saveLink(p.project_id, p.id)}
                >
                  {t("linkToLead")}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">{t("noInventory")}</p>
        )}
      </div>
    </div>
  );
}

type LeadWithResponse = {
  id: string;
  budget_min: number | null;
  budget_max: number | null;
  next_follow_up_at: string | null;
  preferred_area: string | null;
  first_response_minutes?: number | null;
};

const phaseDb = supabase as unknown as {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (
        col: string,
        value: string,
      ) => {
        eq?: (col: string, value: string) => unknown;
        order?: (
          col: string,
          opts: { ascending: boolean },
        ) => Promise<{
          data: unknown;
          error: Error | null;
        }>;
        maybeSingle?: () => Promise<{ data: unknown; error: Error | null }>;
        single?: () => Promise<{ data: unknown; error: Error | null }>;
      };
    };
    insert: (row: Record<string, unknown>) => Promise<{ error: Error | null }>;
    delete: () => {
      eq: (
        col: string,
        value: string,
      ) => {
        eq: (col: string, value: string) => Promise<{ error: Error | null }>;
      };
    };
  };
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{
    data: unknown;
    error: Error | null;
  }>;
};

const BAND_STYLE: Record<string, string> = {
  hot: "bg-destructive/10 text-destructive",
  warm: "bg-warning/10 text-warning",
  cold: "bg-status-contacted-soft text-status-contacted",
};

/** Lead score: live scoreLead() computation + persisted lead_scores row via the recalculate_lead_score RPC. */
function LeadScorePanel({
  lead,
  workspaceId,
  interactionCount,
}: {
  lead: LeadWithResponse;
  workspaceId: string;
  interactionCount: number;
}) {
  const { t, dir } = useI18n();
  const L = (ar: string, en: string) => (dir === "rtl" ? ar : en);
  const qc = useQueryClient();
  const live = scoreLead(deriveLeadScoreInput(lead, interactionCount));

  const storedQuery = useQuery({
    queryKey: ["lead-score", lead.id],
    queryFn: async () => {
      const { data, error } = await (
        phaseDb as unknown as {
          from: (table: "lead_scores") => {
            select: (cols: string) => {
              eq: (
                col: string,
                value: string,
              ) => {
                maybeSingle: () => Promise<{
                  data: { score: number; band: string; calculated_at: string } | null;
                  error: Error | null;
                }>;
              };
            };
          };
        }
      )
        .from("lead_scores")
        .select("score, band, calculated_at")
        .eq("lead_id", lead.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const recalcMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await phaseDb.rpc("recalculate_lead_score", { _lead_id: lead.id });
      if (error) throw error;
      return data as { score: number; band: string } | null;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["lead-score", lead.id] });
      toast.success(L("تم تحديث نقاط العميل.", "Lead score updated."));
    },
    onError: () => toast.error(t("somethingWrong")),
  });

  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{L("نقاط العميل", "Lead score")}</h2>
        <Button
          size="sm"
          variant="outline"
          disabled={recalcMutation.isPending}
          onClick={() => recalcMutation.mutate()}
        >
          {L("إعادة حساب النقاط", "Recalculate score")}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className={`rounded-full px-3 py-1 text-sm font-semibold ${BAND_STYLE[live.band]}`}>
          {live.band === "hot"
            ? L("ساخن", "Hot")
            : live.band === "warm"
              ? L("دافئ", "Warm")
              : L("بارد", "Cold")}{" "}
          · {live.score}/100
        </span>
        {storedQuery.data && (
          <span className="text-xs text-muted-foreground">
            {L("المحفوظة", "Saved")}: {storedQuery.data.score}/100 ({storedQuery.data.band}) ·{" "}
            {formatDateTime(storedQuery.data.calculated_at, "en-GB")}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {L(
          "تُحسب النقاط من الميزانية وموعد المتابعة وسرعة أول رد وعدد التفاعلات.",
          "Scored from budget, follow-up timing, first-response speed and interaction count.",
        )}
      </p>
    </section>
  );
}

/** Smart unit matching: matchUnit() against workspace properties + installment calculator. */
function LeadMatchingUnits({
  lead,
  workspaceId,
}: {
  lead: LeadWithResponse & { interested_property_id?: string | null };
  workspaceId: string;
}) {
  const { t, dir, locale } = useI18n();
  const L = (ar: string, en: string) => (dir === "rtl" ? ar : en);
  const [downPct, setDownPct] = useState(20);
  const [years, setYears] = useState(5);

  const properties = useQuery({
    queryKey: ["inventory", "properties", workspaceId],
    queryFn: async () => {
      const { data, error } = await inventoryDb
        .from("properties")
        .select("*, project:projects(name, location)")
        .eq("workspace_id", workspaceId)
        .order("price")
        .limit(1000);
      if (error) throw error;
      return data as Property[];
    },
  });

  const matches = (properties.data ?? [])
    .map((unit) => ({
      unit,
      pct: matchUnit(
        {
          budget: lead.budget_max ?? lead.budget_min,
          preferredArea: lead.preferred_area,
          bedrooms: null,
        },
        { price: unit.price, area: unit.project?.location ?? null, bedrooms: unit.bedrooms },
      ),
    }))
    .filter((row) => row.pct > 0)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 5);

  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="font-semibold">{L("الوحدات المناسبة", "Matching units")}</h2>
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <div className="space-y-1">
          <Label htmlFor="match-down">{L("المقدم %", "Down payment %")}</Label>
          <Input
            id="match-down"
            type="number"
            min="0"
            max="100"
            value={downPct}
            onChange={(event) => setDownPct(Number(event.target.value) || 0)}
            className="w-24"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="match-years">{L("عدد السنوات", "Years")}</Label>
          <Input
            id="match-years"
            type="number"
            min="1"
            max="30"
            value={years}
            onChange={(event) => setYears(Number(event.target.value) || 1)}
            className="w-24"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {L(
            "القسط الشهري = (السعر − المقدم) ÷ عدد الشهور.",
            "Monthly = (price − down payment) ÷ months.",
          )}
        </p>
      </div>
      {properties.isPending ? (
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      ) : matches.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {L(
            "لا توجد وحدات مطابقة لميزانية العميل والمنطقة.",
            "No units match this lead's budget and area yet.",
          )}
        </p>
      ) : (
        <ul className="space-y-2">
          {matches.map(({ unit, pct }) => {
            let monthly: number | null = null;
            if (unit.price != null) {
              try {
                monthly = monthlyInstallment(unit.price, (unit.price * downPct) / 100, years);
              } catch {
                monthly = null;
              }
            }
            return (
              <li
                key={unit.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm"
              >
                <span>
                  <span className="font-medium">{unit.unit_code}</span>
                  {unit.project?.name ? ` · ${unit.project.name}` : ""}
                  {unit.bedrooms != null ? ` · ${unit.bedrooms} ${L("غرف", "beds")}` : ""}
                </span>
                <span className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    {pct}% {L("مطابقة", "match")}
                  </span>
                  <span>
                    {unit.price == null
                      ? "—"
                      : new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(
                          unit.price,
                        )}
                  </span>
                  {monthly != null && (
                    <span>
                      {new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(monthly)}{" "}
                      {L("ج.م/شهر", "EGP/mo")}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * Calls + visits logging for one lead. Calls write to `calls` and also to
 * `lead_activities` as `lead.response_call` (the only client-writable call
 * type, and it marks first response). Visits write to `visits` only:
 * `lead_activities` has no visit activity type, so no row is fabricated there.
 */
function LeadCallsVisits({
  lead,
  workspaceId,
  userId,
}: {
  lead: { id: string };
  workspaceId: string;
  userId: string;
}) {
  const { t, dir } = useI18n();
  const L = (ar: string, en: string) => (dir === "rtl" ? ar : en);
  const qc = useQueryClient();
  const [callOutcome, setCallOutcome] = useState("answered");
  const [callMinutes, setCallMinutes] = useState("");
  const [callNotes, setCallNotes] = useState("");
  const [visitProperty, setVisitProperty] = useState("");
  const [visitStarts, setVisitStarts] = useState("");
  const [visitStatus, setVisitStatus] = useState("scheduled");
  const [visitFeedback, setVisitFeedback] = useState("");

  const callsQuery = useQuery({
    queryKey: ["lead-calls", lead.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("calls")
        .select("id, duration_seconds, outcome, notes, created_at")
        .eq("workspace_id", workspaceId)
        .eq("lead_id", lead.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CallEntry[];
    },
  });
  const visitsQuery = useQuery({
    queryKey: ["lead-visits", lead.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("visits")
        .select("id, property_id, starts_at, ends_at, status, feedback, created_at")
        .eq("workspace_id", workspaceId)
        .eq("lead_id", lead.id)
        .order("starts_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as VisitEntry[];
    },
  });
  const propertiesQuery = useQuery({
    queryKey: ["inventory", "properties", workspaceId],
    queryFn: async () => {
      const { data, error } = await inventoryDb
        .from("properties")
        .select("id, unit_code, project:projects(name)")
        .eq("workspace_id", workspaceId)
        .order("unit_code")
        .limit(1000);
      if (error) throw error;
      return data as (Pick<Property, "id" | "unit_code"> & {
        project?: Pick<Project, "name"> | null;
      })[];
    },
  });
  const propertyLabel = (propertyId: string | null) => {
    const p = (propertiesQuery.data ?? []).find((item) => item.id === propertyId);
    return p
      ? `${p.unit_code}${p.project?.name ? ` · ${p.project.name}` : ""}`
      : L("بدون وحدة", "No unit");
  };

  const logCall = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).from("calls").insert({
        workspace_id: workspaceId,
        lead_id: lead.id,
        agent_id: userId,
        duration_seconds: callMinutes ? Math.round(Number(callMinutes) * 60) : null,
        outcome: callOutcome,
        notes: callNotes.trim() || null,
      });
      if (error) throw error;
      // Also record the response on the timeline (marks first response).
      const { error: activityError } = await (supabase as any).from("lead_activities").insert({
        lead_id: lead.id,
        workspace_id: workspaceId,
        actor_id: userId,
        activity_type: "lead.response_call",
      });
      if (activityError) throw activityError;
    },
    onSuccess: async () => {
      setCallMinutes("");
      setCallNotes("");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["lead-calls", lead.id] }),
        qc.invalidateQueries({ queryKey: ["lead-activities"] }),
        qc.invalidateQueries({ queryKey: ["lead", lead.id] }),
      ]);
      toast.success(L("تم تسجيل المكالمة.", "Call logged."));
    },
    onError: () => toast.error(t("somethingWrong")),
  });

  const logVisit = useMutation({
    mutationFn: async () => {
      const startsAt = fromLocalInput(visitStarts);
      if (!startsAt) throw new Error("invalid date");
      const { error } = await (supabase as any).from("visits").insert({
        workspace_id: workspaceId,
        lead_id: lead.id,
        property_id: visitProperty || null,
        starts_at: startsAt,
        status: visitStatus,
        feedback: visitFeedback.trim() || null,
        created_by: userId,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setVisitStarts("");
      setVisitFeedback("");
      await qc.invalidateQueries({ queryKey: ["lead-visits", lead.id] });
      toast.success(L("تم تسجيل الزيارة.", "Visit logged."));
    },
    onError: () => toast.error(t("somethingWrong")),
  });

  const deleteCall = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from("calls")
        .delete()
        .eq("id", id)
        .eq("workspace_id", workspaceId);
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["lead-calls", lead.id] });
      toast.success(L("تم حذف المكالمة.", "Call deleted."));
    },
    onError: () => toast.error(t("somethingWrong")),
  });
  const deleteVisit = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from("visits")
        .delete()
        .eq("id", id)
        .eq("workspace_id", workspaceId);
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["lead-visits", lead.id] });
      toast.success(L("تم حذف الزيارة.", "Visit deleted."));
    },
    onError: () => toast.error(t("somethingWrong")),
  });

  return (
    <section className="space-y-3">
      <h2 className="font-semibold">{L("المكالمات والزيارات", "Calls & visits")}</h2>
      <div className="grid gap-3 lg:grid-cols-2">
        <form
          className="space-y-3 rounded-xl border bg-card p-4"
          onSubmit={(event) => {
            event.preventDefault();
            logCall.mutate();
          }}
        >
          <h3 className="text-sm font-semibold">{L("تسجيل مكالمة", "Log a call")}</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{L("النتيجة", "Outcome")}</Label>
              <NativeSelect
                value={callOutcome}
                onChange={(event) => setCallOutcome(event.target.value)}
              >
                {["answered", "no_answer", "busy", "callback", "wrong_number"].map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label>{L("المدة (دقائق)", "Duration (min)")}</Label>
              <Input
                type="number"
                min="0"
                value={callMinutes}
                onChange={(event) => setCallMinutes(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>{t("notes")}</Label>
            <Textarea value={callNotes} onChange={(event) => setCallNotes(event.target.value)} />
          </div>
          <Button type="submit" size="sm" disabled={logCall.isPending}>
            {L("حفظ المكالمة", "Save call")}
          </Button>
        </form>

        <form
          className="space-y-3 rounded-xl border bg-card p-4"
          onSubmit={(event) => {
            event.preventDefault();
            logVisit.mutate();
          }}
        >
          <h3 className="text-sm font-semibold">{L("تسجيل زيارة", "Log a visit")}</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{L("الوحدة", "Unit")}</Label>
              <NativeSelect
                value={visitProperty}
                onChange={(event) => setVisitProperty(event.target.value)}
              >
                <option value="">{L("بدون وحدة", "No unit")}</option>
                {(propertiesQuery.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.unit_code}
                    {p.project?.name ? ` · ${p.project.name}` : ""}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label>{L("الحالة", "Status")}</Label>
              <NativeSelect
                value={visitStatus}
                onChange={(event) => setVisitStatus(event.target.value)}
              >
                {["scheduled", "completed", "cancelled", "no_show"].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className="space-y-1">
            <Label>{L("موعد الزيارة", "Visit time")}</Label>
            <Input
              type="datetime-local"
              required
              value={visitStarts}
              onChange={(event) => setVisitStarts(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>{L("ملاحظات الزيارة", "Visit feedback")}</Label>
            <Textarea
              value={visitFeedback}
              onChange={(event) => setVisitFeedback(event.target.value)}
            />
          </div>
          <Button type="submit" size="sm" disabled={logVisit.isPending}>
            {L("حفظ الزيارة", "Save visit")}
          </Button>
        </form>
      </div>
      <ActivityLog
        calls={callsQuery.data ?? []}
        visits={visitsQuery.data ?? []}
        propertyLabel={propertyLabel}
        onDeleteCall={(id) => deleteCall.mutate(id)}
        onDeleteVisit={(id) => deleteVisit.mutate(id)}
      />
    </section>
  );
}
