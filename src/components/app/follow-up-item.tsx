import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  CheckCircle2,
  Circle,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DemoBadge, StatusBadge } from "@/components/app/badges";
import { FollowUpFormDialog } from "@/components/app/follow-up-form-dialog";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { WhatsAppDialog } from "@/components/app/whatsapp-dialog";
import { useI18n } from "@/lib/i18n";
import { useWorkspaceData } from "@/hooks/use-workspace";
import { dueBucket, formatDateTime } from "@/lib/leads";
import { formatPhone } from "@/lib/phone";
import {
  deleteFollowUp,
  invalidateLeadData,
  mutationErrorKey,
  setFollowUpDone,
  type FollowUpWithLead,
} from "@/lib/queries";
import { cn } from "@/lib/utils";

export function FollowUpItem({
  item,
  showLead = true,
  compact = false,
}: {
  item: FollowUpWithLead;
  showLead?: boolean;
  compact?: boolean;
}) {
  const { t, locale } = useI18n();
  const workspace = useWorkspaceData();
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [waOpen, setWaOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const done = !!item.completed_at;
  const bucket = done ? null : dueBucket(item.due_at);
  const assignee = item.assigned_to
    ? workspace.members.find((member) => member.user_id === item.assigned_to)?.full_name ||
      t("member")
    : t("unassigned");

  async function toggle() {
    setBusy(true);
    try {
      await setFollowUpDone(item.id, !done);
      await invalidateLeadData(qc);
      toast.success(done ? t("followUpReopened") : t("followUpCompleted"));
    } catch (e) {
      toast.error(t(mutationErrorKey(e)));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await deleteFollowUp(item.id);
      await invalidateLeadData(qc);
      toast.success(t("followUpDeleted"));
    } catch (e) {
      toast.error(t(mutationErrorKey(e)));
    } finally {
      setBusy(false);
      setDeleteOpen(false);
    }
  }

  return (
    <li
      className={cn(
        "flex items-start gap-3 rounded-lg border bg-card p-3 shadow-card",
        done && "opacity-70",
      )}
    >
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-label={done ? t("markIncomplete") : t("markComplete")}
        aria-pressed={done}
        className="mt-0.5 shrink-0 rounded-full text-muted-foreground transition-colors hover:text-success disabled:opacity-50"
      >
        {done ? <CheckCircle2 className="h-5 w-5 text-success" /> : <Circle className="h-5 w-5" />}
      </button>
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm font-medium", done && "line-through")}>{item.title}</p>
        <p
          className={cn(
            "mt-0.5 flex items-center gap-1 text-xs",
            bucket === "overdue"
              ? "font-medium text-destructive"
              : bucket === "today"
                ? "font-medium text-warning-foreground"
                : "text-muted-foreground",
          )}
        >
          <CalendarClock aria-hidden="true" className="h-3.5 w-3.5" />
          {done
            ? t("completedOn", { date: formatDateTime(item.completed_at, locale) })
            : `${bucket === "overdue" ? t("overdueBy") + " · " : ""}${formatDateTime(item.due_at, locale)}`}
        </p>
        {!compact && (
          <p className="mt-1 text-xs text-muted-foreground">
            {t("assignedTo")}: {assignee}
          </p>
        )}
        {showLead && item.lead && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Link
              to="/leads/$leadId"
              params={{ leadId: item.lead.id }}
              className="truncate text-sm font-semibold text-primary hover:underline"
            >
              {item.lead.full_name}
            </Link>
            {item.lead.is_demo && <DemoBadge />}
            {!compact && <StatusBadge status={item.lead.status} />}
            {!compact && (
              <span className="text-xs text-muted-foreground ltr-nums">
                {formatPhone(item.lead.phone)}
              </span>
            )}
            {!compact && item.lead.interested_project && (
              <span className="text-xs text-muted-foreground">
                · {item.lead.interested_project}
              </span>
            )}
          </div>
        )}
        {!compact && item.notes && (
          <p className="mt-1.5 text-xs text-muted-foreground">{item.notes}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {item.lead && !done && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("whatsapp")}
            onClick={() => setWaOpen(true)}
            className="text-whatsapp"
          >
            <MessageCircle />
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t("actions")}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setEditOpen(true)}>
              <Pencil aria-hidden="true" /> {t("edit")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={toggle} disabled={busy}>
              <CheckCircle2 aria-hidden="true" /> {done ? t("markIncomplete") : t("markComplete")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => setDeleteOpen(true)}
              disabled={busy}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 aria-hidden="true" /> {t("delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <FollowUpFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        followUp={item}
        lead={item.lead}
      />
      {item.lead && <WhatsAppDialog lead={item.lead} open={waOpen} onOpenChange={setWaOpen} />}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("deleteFollowUpTitle")}
        body={t("deleteFollowUpBody")}
        confirmLabel={t("delete")}
        onConfirm={() => void remove()}
      />
    </li>
  );
}
