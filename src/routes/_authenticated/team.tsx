import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  Clock3,
  MailPlus,
  ShieldCheck,
  Trash2,
  UserRound,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader, ErrorState, ListSkeleton, EmptyState } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import {
  cancelWorkspaceInvitation,
  inviteWorkspaceAgent,
  removeWorkspaceAgent,
} from "@/lib/team.functions";
import { canChangeMemberRole, canManageTeam, canRemoveMember } from "@/lib/team-permissions";
import { useI18n } from "@/lib/i18n";
import { useWorkspaceData, workspaceQueryKey } from "@/hooks/use-workspace";

export const Route = createFileRoute("/_authenticated/team")({
  head: () => ({
    meta: [
      { title: "إدارة الفريق — LeadFlow | Team management" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TeamPage,
});

type Member = {
  user_id: string;
  role: "owner" | "manager" | "agent";
  created_at: string;
  full_name: string | null;
  phone: string | null;
};
type Invitation = {
  id: string;
  email: string;
  invited_user_id: string | null;
  created_at: string;
  expires_at: string;
};
type Assignment = {
  id: string;
  changed_at: string;
  lead: { full_name: string | null } | null;
  from_profile: { full_name: string | null } | null;
  to_profile: { full_name: string | null } | null;
  actor: { full_name: string | null } | null;
};
type Metric = {
  user_id: string;
  full_name: string | null;
  role: "owner" | "manager" | "agent";
  lead_count: number;
  active_lead_count: number;
  won_lead_count: number;
  open_follow_up_count: number;
  overdue_follow_up_count: number;
  conversion_rate: number;
};

// New migration objects intentionally use a narrow local cast until Supabase types are regenerated.
const teamDb = supabase as unknown as {
  // New tables are typed by the migration and will enter generated types after introspection.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: "workspace_invitations" | "lead_assignment_history") => any;
  rpc: (
    name: "team_dashboard_stats",
    args: { _workspace_id: string },
  ) => Promise<{ data: Metric[] | null; error: Error | null }>;
};

// change_workspace_member_role() is added by migration
// 20261126000000_manager_role.sql; generated types do not include it yet.
const roleDb = supabase as unknown as {
  rpc: (
    name: "change_workspace_member_role",
    args: { _workspace_id: string; _user_id: string; _new_role: "agent" | "manager" },
  ) => Promise<{ error: Error | null }>;
};

function TeamPage() {
  const { t, dir } = useI18n();
  const ws = useWorkspaceData();
  const qc = useQueryClient();
  const owner = canManageTeam(ws.role);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [pending, setPending] = useState(false);

  const membersQuery = useQuery({
    queryKey: ["team", "members", ws.workspace.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workspace_members")
        .select("user_id, role, created_at, profile:profiles(full_name, phone)")
        .eq("workspace_id", ws.workspace.id)
        .order("created_at");
      if (error) throw error;
      return (data ?? []).map((row) => ({
        user_id: row.user_id,
        role: row.role,
        created_at: row.created_at,
        full_name: row.profile?.full_name ?? null,
        phone: row.profile?.phone ?? null,
      })) as Member[];
    },
  });
  const statsQuery = useQuery({
    queryKey: ["team", "stats", ws.workspace.id],
    queryFn: async () => {
      const { data, error } = await teamDb.rpc("team_dashboard_stats", {
        _workspace_id: ws.workspace.id,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
  const invitationsQuery = useQuery({
    queryKey: ["team", "invitations", ws.workspace.id],
    enabled: owner,
    queryFn: async () => {
      const { data, error } = await teamDb
        .from("workspace_invitations")
        .select("id, email, invited_user_id, created_at, expires_at")
        .eq("workspace_id", ws.workspace.id)
        .is("consumed_at", null)
        .is("revoked_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Invitation[];
    },
  });
  const assignmentsQuery = useQuery({
    queryKey: ["team", "assignments", ws.workspace.id],
    queryFn: async () => {
      const { data, error } = await teamDb
        .from("lead_assignment_history")
        .select(
          "id, changed_at, lead:leads(full_name), from_profile:profiles!lead_assignment_history_from_user_id_fkey(full_name), to_profile:profiles!lead_assignment_history_to_user_id_fkey(full_name), actor:profiles!lead_assignment_history_actor_id_fkey(full_name)",
        )
        .eq("workspace_id", ws.workspace.id)
        .order("changed_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data ?? []) as Assignment[];
    },
  });
  const invalidateTeam = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["team"] }),
      qc.invalidateQueries({ queryKey: workspaceQueryKey }),
    ]);
  };

  const inviteMutation = useMutation({
    mutationFn: inviteWorkspaceAgent,
    onSuccess: async () => {
      toast.success(t("invitationSent"));
      setEmail("");
      setFullName("");
      await invalidateTeam();
    },
    onError: () => toast.error(t("somethingWrong")),
  });
  const removeMutation = useMutation({
    mutationFn: removeWorkspaceAgent,
    onSuccess: async () => {
      toast.success(t("memberRemoved"));
      await invalidateTeam();
    },
    onError: () => toast.error(t("somethingWrong")),
  });
  const cancelMutation = useMutation({
    mutationFn: cancelWorkspaceInvitation,
    onSuccess: async () => {
      toast.success(t("invitationCancelled"));
      await invalidateTeam();
    },
    onError: () => toast.error(t("somethingWrong")),
  });
  // Owner-only role change (agent <-> manager). The RPC + DB guard trigger
  // reject any change to "owner" and any change attempted by a non-owner,
  // so the UI check below is only for display.
  const roleMutation = useMutation({
    mutationFn: async ({ userId, newRole }: { userId: string; newRole: "agent" | "manager" }) => {
      const { error } = await roleDb.rpc("change_workspace_member_role", {
        _workspace_id: ws.workspace.id,
        _user_id: userId,
        _new_role: newRole,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success(dir === "rtl" ? "تم تغيير الدور" : "Role changed");
      await invalidateTeam();
    },
    onError: () => toast.error(t("somethingWrong")),
  });

  const stats = useMemo(() => statsQuery.data ?? [], [statsQuery.data]);
  const pendingInviteeIds = new Set(
    (invitationsQuery.data ?? [])
      .map((item) => item.invited_user_id)
      .filter((id): id is string => Boolean(id)),
  );
  const invite = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!owner || pending) return;
    setPending(true);
    try {
      await inviteMutation.mutateAsync({ data: { workspaceId: ws.workspace.id, email, fullName } });
    } finally {
      setPending(false);
    }
  };

  if (membersQuery.isLoading || statsQuery.isLoading)
    return (
      <div className="space-y-6">
        <ListSkeleton rows={5} />
      </div>
    );
  if (membersQuery.isError || statsQuery.isError)
    return (
      <div className="p-6">
        <ErrorState
          error={membersQuery.error ?? statsQuery.error}
          onRetry={() => {
            void membersQuery.refetch();
            void statsQuery.refetch();
          }}
        />
      </div>
    );

  return (
    <main className="space-y-6" dir={dir}>
      <PageHeader title={t("teamTitle")} description={t("teamSubtitle")} />

      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <ShieldCheck className="text-blue-800" size={20} />
          <h2 className="font-semibold">{t("rolePermissions")}</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg bg-slate-50 p-4">
            <strong>{t("role_owner")}</strong>
            <p className="mt-1 text-sm text-slate-600">{t("ownerPermission")}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-4">
            <strong>{dir === "rtl" ? "مدير" : "Manager"}</strong>
            <p className="mt-1 text-sm text-slate-600">
              {dir === "rtl"
                ? "يمكنه عرض الفريق وإعادة إسناد العملاء والمتابعات. لا يمكنه تغيير الأدوار أو إدارة الفوترة أو حذف مساحة العمل."
                : "Can view the team and reassign leads and follow-ups. Cannot change roles, manage billing, or delete the workspace."}
            </p>
          </div>
          <div className="rounded-lg bg-slate-50 p-4">
            <strong>{t("role_agent")}</strong>
            <p className="mt-1 text-sm text-slate-600">{t("agentPermission")}</p>
          </div>
        </div>
      </section>

      {owner && (
        <section className="rounded-xl border bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <MailPlus className="text-blue-800" size={20} />
            <h2 className="font-semibold">{t("inviteEmployee")}</h2>
          </div>
          <form onSubmit={invite} className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
            <div className="space-y-2">
              <Label htmlFor="team-name">{t("inviteName")}</Label>
              <Input
                id="team-name"
                autoComplete="name"
                required
                maxLength={120}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="team-email">{t("inviteEmail")}</Label>
              <Input
                id="team-email"
                type="email"
                autoComplete="email"
                required
                maxLength={255}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={pending || inviteMutation.isPending}>
              {t("sendInvitation")}
            </Button>
          </form>
          <p className="mt-3 text-xs text-slate-500">{t("invitationOnlyNewUsers")}</p>
        </section>
      )}

      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <UsersRound className="text-blue-800" size={20} />
          <h2 className="font-semibold">{t("teamMembers")}</h2>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">
            {membersQuery.data?.length ?? 0}
          </span>
        </div>
        {!membersQuery.data?.length ? (
          <EmptyState icon={UsersRound} title={t("noTeamMembers")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table w-full min-w-[640px] text-start text-sm">
              <thead>
                <tr className="border-b text-slate-500">
                  <th className="p-3">{t("member")}</th>
                  <th className="p-3">{t("yourRole")}</th>
                  <th className="p-3">{t("phone")}</th>
                  <th className="p-3">{t("joinedAt")}</th>
                  <th className="p-3">{t("teamMembers")}</th>
                </tr>
              </thead>
              <tbody>
                {membersQuery.data.map((member) => (
                  <tr className="border-b last:border-0" key={member.user_id}>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <UserRound size={16} className="text-slate-400" />
                        <span>
                          {member.full_name || t("member")}
                          {member.user_id === ws.userId ? ` ${t("memberYou")}` : ""}
                        </span>
                      </div>
                    </td>
                    <td className="p-3">
                      {member.role === "manager"
                        ? dir === "rtl"
                          ? "مدير"
                          : "Manager"
                        : t(member.role === "owner" ? "role_owner" : "role_agent")}
                    </td>
                    <td className="p-3">{member.phone || "—"}</td>
                    <td className="p-3">
                      {new Date(member.created_at).toLocaleDateString(
                        dir === "rtl" ? "ar-EG" : "en-US",
                      )}
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {owner &&
                          member.role !== "owner" &&
                          member.user_id !== ws.userId &&
                          canChangeMemberRole(
                            ws.role,
                            ws.userId,
                            member.role,
                            member.user_id,
                            member.role === "manager" ? "agent" : "manager",
                          ) && (
                            <select
                              className="h-9 rounded-md border bg-background px-2 text-sm"
                              value={member.role}
                              disabled={roleMutation.isPending}
                              aria-label={dir === "rtl" ? "تغيير دور العضو" : "Change member role"}
                              onChange={(e) =>
                                roleMutation.mutate({
                                  userId: member.user_id,
                                  newRole: e.target.value as "agent" | "manager",
                                })
                              }
                            >
                              <option value="agent">{t("role_agent")}</option>
                              <option value="manager">{dir === "rtl" ? "مدير" : "Manager"}</option>
                            </select>
                          )}
                        {pendingInviteeIds.has(member.user_id) ? (
                          t("pendingConfirmation")
                        ) : canRemoveMember(ws.role, ws.userId, member.role, member.user_id) ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={removeMutation.isPending}
                            onClick={() => {
                              if (window.confirm(t("confirmRemoveMember")))
                                removeMutation.mutate({
                                  data: { workspaceId: ws.workspace.id, userId: member.user_id },
                                });
                            }}
                          >
                            <Trash2 size={15} className="me-1" />
                            {t("removeMember")}
                          </Button>
                        ) : (
                          "—"
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {owner && (
        <section className="rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-semibold">{t("activeInvitations")}</h2>
          {invitationsQuery.isLoading ? (
            <ListSkeleton rows={2} />
          ) : invitationsQuery.data?.length ? (
            <div className="space-y-3">
              {invitationsQuery.data.map((invitation) => (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 border-b pb-3 last:border-0"
                  key={invitation.id}
                >
                  <div>
                    <p>{invitation.email}</p>
                    <p className="text-xs text-slate-500">
                      {t("inviteExpires")}:{" "}
                      {new Date(invitation.expires_at).toLocaleString(
                        dir === "rtl" ? "ar-EG" : "en-US",
                      )}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={cancelMutation.isPending}
                    onClick={() => {
                      if (window.confirm(t("confirmCancelInvitation")))
                        cancelMutation.mutate({
                          data: { workspaceId: ws.workspace.id, invitationId: invitation.id },
                        });
                    }}
                  >
                    {t("cancelInvitation")}
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">{t("noActiveInvitations")}</p>
          )}
        </section>
      )}

      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <UsersRound className="text-blue-800" size={20} />
          <h2 className="font-semibold">{t("workloadOverview")}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table w-full min-w-[720px] text-start text-sm">
            <thead>
              <tr className="border-b text-slate-500">
                {[
                  "member",
                  "leadCount",
                  "activeLeadCount",
                  "wonLeadCount",
                  "openFollowups",
                  "overdueFollowups",
                  "conversionRate",
                ].map((key) => (
                  <th className="p-3" key={key}>
                    {t(key as never)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stats.map((metric) => (
                <tr className="border-b last:border-0" key={metric.user_id}>
                  <td className="p-3">{metric.full_name || t("member")}</td>
                  <td className="p-3">{metric.lead_count}</td>
                  <td className="p-3">{metric.active_lead_count}</td>
                  <td className="p-3">{metric.won_lead_count}</td>
                  <td className="p-3">{metric.open_follow_up_count}</td>
                  <td className="p-3">{metric.overdue_follow_up_count}</td>
                  <td className="p-3">{metric.conversion_rate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <ArrowRightLeft className="text-blue-800" size={20} />
          <h2 className="font-semibold">{t("recentAssignments")}</h2>
        </div>
        {assignmentsQuery.isLoading ? (
          <ListSkeleton rows={3} />
        ) : assignmentsQuery.isError ? (
          <p className="text-sm text-red-600">{t("somethingWrong")}</p>
        ) : assignmentsQuery.data?.length ? (
          <div className="space-y-3">
            {assignmentsQuery.data.map((assignment) => (
              <div
                className="flex items-start justify-between gap-4 border-b pb-3 last:border-0"
                key={assignment.id}
              >
                <div>
                  <p className="font-medium">{assignment.lead?.full_name || t("lead")}</p>
                  <p className="text-sm text-slate-600">
                    {assignment.from_profile?.full_name || t("unassigned")} →{" "}
                    {assignment.to_profile?.full_name || t("unassigned")}
                  </p>
                  <p className="text-xs text-slate-500">
                    {t("assignmentActor")}: {assignment.actor?.full_name || t("member")}
                  </p>
                </div>
                <span className="flex items-center gap-1 whitespace-nowrap text-xs text-slate-500">
                  <Clock3 size={13} />
                  {new Date(assignment.changed_at).toLocaleString(
                    dir === "rtl" ? "ar-EG" : "en-US",
                  )}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={ArrowRightLeft} title={t("noAssignmentHistory")} />
        )}
      </section>
    </main>
  );
}
