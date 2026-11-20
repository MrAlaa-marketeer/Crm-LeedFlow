import { queryOptions, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { WorkspaceRole } from "@/lib/leads";

export interface WorkspaceContext {
  userId: string;
  email: string;
  workspace: { id: string; name: string };
  role: WorkspaceRole;
  profile: { full_name: string | null; phone: string | null; language: string };
  members: { user_id: string; role: WorkspaceRole; full_name: string | null }[];
}

export const workspaceQueryKey = ["workspace"] as const;

async function fetchWorkspace(): Promise<WorkspaceContext> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) throw userErr ?? new Error("Not signed in");
  const user = userData.user;

  const { data: membership, error: mErr } = await supabase
    .from("workspace_members")
    .select("role, workspace:workspaces(id, name)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (mErr) throw mErr;
  if (!membership?.workspace) throw new Error("No workspace found for this account");

  const [{ data: profile, error: pErr }, { data: members, error: memErr }] = await Promise.all([
    supabase.from("profiles").select("full_name, phone, language").eq("id", user.id).maybeSingle(),
    supabase
      .from("workspace_members")
      .select("user_id, role, profile:profiles(full_name)")
      .eq("workspace_id", membership.workspace.id),
  ]);
  if (pErr) throw pErr;
  if (memErr) throw memErr;

  return {
    userId: user.id,
    email: user.email ?? "",
    workspace: membership.workspace,
    role: membership.role,
    profile: profile ?? { full_name: null, phone: null, language: "ar" },
    members: (members ?? []).map((m) => ({
      user_id: m.user_id,
      role: m.role,
      full_name: m.profile?.full_name ?? null,
    })),
  };
}

export const workspaceQueryOptions = queryOptions({
  queryKey: workspaceQueryKey,
  queryFn: fetchWorkspace,
  staleTime: 60_000,
});

export function useWorkspace() {
  return useQuery(workspaceQueryOptions);
}

/** For components rendered inside the authenticated shell, where the workspace is already loaded. */
export function useWorkspaceData(): WorkspaceContext {
  const { data } = useWorkspace();
  if (!data) throw new Error("Workspace not loaded");
  return data;
}

export function memberName(ws: WorkspaceContext, userId: string | null | undefined): string | null {
  if (!userId) return null;
  const m = ws.members.find((x) => x.user_id === userId);
  if (!m) return null;
  return m.full_name || (m.user_id === ws.userId ? ws.email : null);
}
