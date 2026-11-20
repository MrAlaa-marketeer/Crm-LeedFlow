import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bell, CheckCheck, Clock3, RotateCw, Workflow } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toast } from "sonner";

import { EmptyState, ErrorState, ListSkeleton, PageHeader } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { memberName, useWorkspaceData } from "@/hooks/use-workspace";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useI18n } from "@/lib/i18n";
import { isEscalated } from "@/lib/reminders";

export const Route = createFileRoute("/_authenticated/automation")({
  head: () => ({ meta: [{ title: "Automation & notifications — LeadFlow" }] }),
  component: AutomationPage,
});

type Rule = {
  id: string;
  workspace_id: string;
  name: string;
  trigger_event: EventType;
  action_type: ActionType;
  enabled: boolean;
  created_by: string;
  created_at: string;
};
type EventType =
  | "lead.created"
  | "lead.status_changed"
  | "follow_up.created"
  | "follow_up.completed"
  | "follow_up.overdue"
  | "follow_up.escalated";
type ActionType = "notify_assignee" | "round_robin_unassigned";
type Notification = {
  id: string;
  event_type: EventType;
  entity_id: string;
  created_at: string;
  read_at: string | null;
};
type Execution = {
  id: string;
  event_type: EventType;
  action_type: ActionType;
  outcome: "succeeded" | "skipped" | "failed";
  error_message: string | null;
  created_at: string;
};
type DueReminderRow = {
  follow_up_id: string;
  lead_id: string;
  lead_name: string;
  lead_phone: string;
  follow_up_title: string;
  due_at: string;
  assigned_to: string | null;
  assignee_name: string | null;
  status: string;
  overdue_hours: number;
};
type EscalationRow = {
  workspace_id: string;
  follow_up_id: string;
  lead_id: string;
  assigned_to: string | null;
  overdue_hours: number;
  notifications_created: number;
};
type RowTable<Row, Insert, Update = Partial<Insert>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};
type AutomationDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables" | "Functions"> & {
    Functions: Database["public"]["Functions"] & {
      retry_automation_execution: { Args: { _execution_id: string }; Returns: undefined };
      due_follow_up_reminders: {
        Args: { _workspace_id: string; _due_within_hours?: number };
        Returns: DueReminderRow[];
      };
      escalate_overdue_follow_ups: {
        Args: { _workspace_id?: string | null };
        Returns: EscalationRow[];
      };
    };
    Tables: Database["public"]["Tables"] & {
      automation_rules: RowTable<
        Rule,
        Omit<Rule, "id" | "created_at"> & { id?: string; created_at?: string }
      >;
      in_app_notifications: RowTable<
        Notification & {
          workspace_id: string;
          recipient_id: string;
          rule_id: string | null;
          event_id: string;
        },
        never,
        { read_at?: string | null }
      >;
      automation_executions: RowTable<
        Execution & { workspace_id: string; rule_id: string | null; event_id: string },
        never
      >;
      notification_preferences: RowTable<
        { workspace_id: string; user_id: string; in_app_enabled: boolean; updated_at: string },
        { workspace_id: string; user_id: string; in_app_enabled?: boolean },
        { in_app_enabled?: boolean }
      >;
    };
  };
};
const automationDb = supabase as unknown as SupabaseClient<AutomationDatabase>;
const ruleKey = (workspaceId: string) => ["automation-rules", workspaceId] as const;
const notificationKey = (workspaceId: string, userId: string) =>
  ["notifications", workspaceId, userId] as const;
const executionKey = (workspaceId: string) => ["automation-executions", workspaceId] as const;
const escalationKey = (workspaceId: string) => ["escalated-follow-ups", workspaceId] as const;
const EVENT_TYPES: EventType[] = [
  "lead.created",
  "lead.status_changed",
  "follow_up.created",
  "follow_up.completed",
];

function AutomationPage() {
  const { t, dir, locale } = useI18n();
  const ws = useWorkspaceData();
  const qc = useQueryClient();
  const owner = ws.role === "owner";
  const [ruleName, setRuleName] = useState("");
  const [eventType, setEventType] = useState<EventType>("lead.created");
  const [actionType, setActionType] = useState<ActionType>("notify_assignee");
  const rules = useQuery({
    queryKey: ruleKey(ws.workspace.id),
    enabled: owner,
    queryFn: async () => {
      const { data, error } = await automationDb
        .from("automation_rules")
        .select("*")
        .eq("workspace_id", ws.workspace.id)
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });
  const inbox = useQuery({
    queryKey: notificationKey(ws.workspace.id, ws.userId),
    queryFn: async () => {
      const { data, error } = await automationDb
        .from("in_app_notifications")
        .select("*")
        .eq("workspace_id", ws.workspace.id)
        .eq("recipient_id", ws.userId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });
  const preference = useQuery({
    queryKey: ["notification-preferences", ws.workspace.id, ws.userId],
    queryFn: async () => {
      const { data, error } = await automationDb
        .from("notification_preferences")
        .select("in_app_enabled")
        .eq("workspace_id", ws.workspace.id)
        .eq("user_id", ws.userId)
        .maybeSingle();
      if (error) throw error;
      return data?.in_app_enabled ?? true;
    },
  });
  const executions = useQuery({
    queryKey: executionKey(ws.workspace.id),
    enabled: owner,
    queryFn: async () => {
      const { data, error } = await automationDb
        .from("automation_executions")
        .select("*")
        .eq("workspace_id", ws.workspace.id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });
  // 24h escalation (owner view): open follow-ups overdue >= 24h, via the
  // due_follow_up_reminders RPC. This is a live list, not a sent-message
  // log — nothing is emailed or WhatsApp'd; escalation only writes rows
  // into the in-app inbox (here + the bell) when the owner runs it below
  // or the scheduled sweep runs.
  const escalations = useQuery({
    queryKey: escalationKey(ws.workspace.id),
    enabled: owner,
    queryFn: async () => {
      const { data, error } = await automationDb.rpc("due_follow_up_reminders", {
        _workspace_id: ws.workspace.id,
        _due_within_hours: 24,
      });
      if (error) throw error;
      return (data ?? []).filter(
        (row) => row.status === "overdue" && isEscalated({ due_at: row.due_at }),
      );
    },
  });

  const refresh = async () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ruleKey(ws.workspace.id) }),
      qc.invalidateQueries({ queryKey: notificationKey(ws.workspace.id, ws.userId) }),
      qc.invalidateQueries({ queryKey: executionKey(ws.workspace.id) }),
      qc.invalidateQueries({ queryKey: escalationKey(ws.workspace.id) }),
    ]);
  const addRule = useMutation({
    mutationFn: async () => {
      const cleanName = ruleName.trim();
      if (!cleanName) throw new Error(t("automationNameRequired"));
      if (actionType === "round_robin_unassigned" && eventType !== "lead.created")
        throw new Error(t("automationRoundRobinOnlyLead"));
      const { error } = await automationDb.from("automation_rules").insert({
        workspace_id: ws.workspace.id,
        name: cleanName,
        trigger_event: eventType,
        action_type: actionType,
        enabled: true,
        created_by: ws.userId,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setRuleName("");
      await refresh();
      toast.success(t("automationRuleSaved"));
    },
    onError: () => toast.error(t("somethingWrong")),
  });
  const toggleRule = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await automationDb
        .from("automation_rules")
        .update({ enabled })
        .eq("id", id)
        .eq("workspace_id", ws.workspace.id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: () => toast.error(t("somethingWrong")),
  });
  const deleteRule = useMutation({
    mutationFn: async (id: string) => {
      if (!window.confirm(t("automationDeleteConfirm"))) return;
      const { error } = await automationDb
        .from("automation_rules")
        .delete()
        .eq("id", id)
        .eq("workspace_id", ws.workspace.id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: () => toast.error(t("somethingWrong")),
  });
  const setPreference = useMutation({
    mutationFn: async (enabled: boolean) => {
      const { error } = await automationDb.from("notification_preferences").upsert(
        {
          workspace_id: ws.workspace.id,
          user_id: ws.userId,
          in_app_enabled: enabled,
        },
        { onConflict: "workspace_id,user_id" },
      );
      if (error) throw error;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["notification-preferences", ws.workspace.id, ws.userId] }),
    onError: () => toast.error(t("somethingWrong")),
  });
  const markRead = useMutation({
    mutationFn: async (id: string | null) => {
      let query = automationDb
        .from("in_app_notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("workspace_id", ws.workspace.id)
        .eq("recipient_id", ws.userId)
        .is("read_at", null);
      if (id) query = query.eq("id", id);
      const { error } = await query;
      if (error) throw error;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: notificationKey(ws.workspace.id, ws.userId) }),
    onError: () => toast.error(t("somethingWrong")),
  });
  const retryExecution = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await automationDb.rpc("retry_automation_execution", { _execution_id: id });
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: () => toast.error(t("somethingWrong")),
  });
  // Owner-triggered escalation: writes one 'follow_up.escalated' inbox row
  // per workspace owner per overdue follow-up (idempotent — re-running
  // creates nothing new). Same function the pg_cron sweep calls.
  const runEscalation = useMutation({
    mutationFn: async () => {
      const { data, error } = await automationDb.rpc("escalate_overdue_follow_ups", {
        _workspace_id: ws.workspace.id,
      });
      if (error) throw error;
      return (data ?? []).reduce((sum, row) => sum + (row.notifications_created ?? 0), 0);
    },
    onSuccess: async (created) => {
      await refresh();
      toast.success(
        dir === "rtl"
          ? `تم إشعار المالكين بالمتابعات المتأخرة (${created} إشعارات جديدة داخل التطبيق)`
          : `Owners notified about overdue follow-ups (${created} new in-app notifications)`,
      );
    },
    onError: () => toast.error(t("somethingWrong")),
  });

  const eventLabel = (event: EventType) => {
    // Reminder event types have no i18n-dict key (the dict is not edited by
    // this module); label them inline instead.
    if (event === "follow_up.overdue") return dir === "rtl" ? "متابعة مستحقة" : "Follow-up overdue";
    if (event === "follow_up.escalated")
      return dir === "rtl" ? "تصعيد متابعة متأخرة" : "Overdue follow-up escalated";
    return t(
      (
        {
          "lead.created": "automationLeadCreated",
          "lead.status_changed": "automationLeadStatus",
          "follow_up.created": "automationFollowupCreated",
          "follow_up.completed": "automationFollowupCompleted",
        } as const
      )[event],
    );
  };
  const actionLabel = (action: ActionType) =>
    action === "notify_assignee" ? t("automationNotifyAssignee") : t("automationRoundRobin");
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(value),
    );

  if (
    inbox.isPending ||
    (owner && (rules.isPending || executions.isPending || escalations.isPending))
  )
    return <ListSkeleton rows={5} />;
  if (inbox.isError || (owner && (rules.isError || executions.isError || escalations.isError)))
    return (
      <ErrorState
        error={inbox.error ?? rules.error ?? executions.error ?? escalations.error}
        onRetry={() => void refresh()}
      />
    );

  return (
    <div dir={dir} className="space-y-6">
      <PageHeader title={t("automationTitle")} description={t("automationSubtitle")} />

      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">{t("notificationInbox")}</h2>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={markRead.isPending || !inbox.data?.some((n) => !n.read_at)}
            onClick={() => markRead.mutate(null)}
          >
            <CheckCheck className="me-2 h-4 w-4" />
            {t("markAllRead")}
          </Button>
        </div>
        <div className="mb-4 flex items-center justify-between rounded-lg bg-slate-50 p-3">
          <div>
            <p className="text-sm font-medium">{t("inAppNotifications")}</p>
            <p className="text-xs text-muted-foreground">{t("notificationPreferenceHint")}</p>
          </div>
          <Switch
            checked={preference.data ?? true}
            disabled={setPreference.isPending}
            onCheckedChange={(checked) => setPreference.mutate(checked)}
            aria-label={t("inAppNotifications")}
          />
        </div>
        {inbox.data?.length ? (
          <ul className="divide-y">
            {inbox.data.map((n) => (
              <li
                key={n.id}
                className={`flex items-start justify-between gap-4 py-3 ${n.read_at ? "opacity-70" : ""}`}
              >
                <div>
                  <p className="text-sm font-medium">{eventLabel(n.event_type)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{date(n.created_at)}</p>
                </div>
                {!n.read_at && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={markRead.isPending}
                    onClick={() => markRead.mutate(n.id)}
                  >
                    {t("markRead")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={Bell}
            title={t("noNotifications")}
            body={t("automationNoNotificationsHint")}
          />
        )}
      </section>

      {owner && (
        <section className="rounded-xl border bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <h2 className="font-semibold">
                {dir === "rtl" ? "تصعيد المتابعات المتأخرة" : "Overdue follow-up escalation"}
              </h2>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={runEscalation.isPending || !escalations.data?.length}
              onClick={() => runEscalation.mutate()}
            >
              {dir === "rtl" ? "إشعار المالكين الآن" : "Notify owners now"}
            </Button>
          </div>
          <p className="mb-4 text-sm text-muted-foreground">
            {dir === "rtl"
              ? "المتابعات المفتوحة المتأخرة أكثر من 24 ساعة. التصعيد ينشئ إشعاراً داخل التطبيق للمالكين فقط."
              : "Open follow-ups overdue more than 24 hours. Escalation creates an in-app notification for owners only."}{" "}
            {t("inAppOnly")}
          </p>
          {escalations.data?.length ? (
            <ul className="divide-y">
              {escalations.data.map((row) => (
                <li
                  key={row.follow_up_id}
                  className="flex flex-wrap items-start justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{row.follow_up_title}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {row.lead_name}
                      {row.lead_phone ? ` · ${row.lead_phone}` : ""}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t("assignedTo")}:{" "}
                      {memberName(ws, row.assigned_to) ?? row.assignee_name ?? t("unassigned")}
                    </p>
                  </div>
                  <div className="text-end text-xs">
                    <p className="font-medium text-destructive">{date(row.due_at)}</p>
                    <p className="mt-0.5 text-muted-foreground">
                      {dir === "rtl"
                        ? `متأخرة ${Math.floor(row.overdue_hours)} ساعة`
                        : `${Math.floor(row.overdue_hours)}h overdue`}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={AlertTriangle}
              title={dir === "rtl" ? "لا توجد متابعات تستدعي التصعيد" : "Nothing to escalate"}
              body={
                dir === "rtl"
                  ? "لا توجد متابعات مفتوحة متأخرة أكثر من 24 ساعة في مساحة العمل هذه."
                  : "No open follow-ups are more than 24 hours overdue in this workspace."
              }
            />
          )}
        </section>
      )}

      {owner && (
        <>
          <section className="rounded-xl border bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <Workflow className="h-5 w-5 text-primary" />
              <h2 className="font-semibold">{t("automationRules")}</h2>
            </div>
            <form
              className="grid gap-3 md:grid-cols-4"
              onSubmit={(e) => {
                e.preventDefault();
                addRule.mutate();
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="rule-name">{t("automationRuleName")}</Label>
                <Input
                  id="rule-name"
                  value={ruleName}
                  maxLength={120}
                  onChange={(e) => setRuleName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rule-event">{t("automationWhen")}</Label>
                <select
                  id="rule-event"
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={eventType}
                  onChange={(e) => setEventType(e.target.value as EventType)}
                >
                  {EVENT_TYPES.map((event) => (
                    <option key={event} value={event}>
                      {eventLabel(event)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="rule-action">{t("automationDo")}</Label>
                <select
                  id="rule-action"
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={actionType}
                  onChange={(e) => setActionType(e.target.value as ActionType)}
                >
                  <option value="notify_assignee">{actionLabel("notify_assignee")}</option>
                  <option value="round_robin_unassigned">
                    {actionLabel("round_robin_unassigned")}
                  </option>
                </select>
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={addRule.isPending}>
                  {addRule.isPending ? t("saving") : t("automationAddRule")}
                </Button>
              </div>
            </form>
            <p className="mt-3 text-xs text-muted-foreground">{t("automationRoundRobinHint")}</p>
            {rules.data?.length ? (
              <ul className="mt-5 divide-y">
                {rules.data.map((rule) => (
                  <li
                    key={rule.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div>
                      <p className="font-medium">{rule.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {eventLabel(rule.trigger_event)} · {actionLabel(rule.action_type)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Switch
                        checked={rule.enabled}
                        disabled={toggleRule.isPending}
                        onCheckedChange={(enabled) => toggleRule.mutate({ id: rule.id, enabled })}
                        aria-label={`${t("automationToggle")} ${rule.name}`}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        disabled={deleteRule.isPending}
                        onClick={() => deleteRule.mutate(rule.id)}
                      >
                        {t("delete")}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={Workflow}
                title={t("automationNoRules")}
                body={t("automationNoRulesHint")}
              />
            )}
          </section>

          <section className="rounded-xl border bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <Clock3 className="h-5 w-5 text-primary" />
              <h2 className="font-semibold">{t("automationHistory")}</h2>
            </div>
            {executions.data?.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-start text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="py-2 pe-4 font-medium">{t("automationWhen")}</th>
                      <th className="py-2 pe-4 font-medium">{t("automationEvent")}</th>
                      <th className="py-2 pe-4 font-medium">{t("automationDo")}</th>
                      <th className="py-2 pe-4 font-medium">{t("automationResult")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {executions.data.map((run) => (
                      <tr key={run.id} className="border-b last:border-0">
                        <td className="py-3 pe-4">{date(run.created_at)}</td>
                        <td className="py-3 pe-4">{eventLabel(run.event_type)}</td>
                        <td className="py-3 pe-4">{actionLabel(run.action_type)}</td>
                        <td className="py-3 pe-4">
                          <span className={run.outcome === "failed" ? "text-destructive" : ""}>
                            {t(
                              run.outcome === "succeeded"
                                ? "automationSucceeded"
                                : run.outcome === "skipped"
                                  ? "automationSkipped"
                                  : "automationFailed",
                            )}
                          </span>
                          {run.error_message && (
                            <p className="max-w-sm break-words text-xs text-destructive">
                              {run.error_message}
                            </p>
                          )}
                          {run.outcome === "failed" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="mt-1 h-8 px-2"
                              disabled={retryExecution.isPending}
                              onClick={() => retryExecution.mutate(run.id)}
                            >
                              <RotateCw className="me-1 h-3 w-3" />
                              {t("automationRetry")}
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                icon={Clock3}
                title={t("automationNoRuns")}
                body={t("automationNoRunsHint")}
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}
