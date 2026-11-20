import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { billingDb } from "@/lib/billing/client";

const invitationInput = z.object({
  workspaceId: z.string().uuid(),
  email: z.string().trim().email().max(255),
  fullName: z.string().trim().min(1).max(120),
});

const memberInput = z.object({ workspaceId: z.string().uuid(), userId: z.string().uuid() });
const invitationIdInput = z.object({
  workspaceId: z.string().uuid(),
  invitationId: z.string().uuid(),
});

async function requireWorkspaceOwner(
  supabase: {
    // This client is cast narrowly because workspace_members is already fully typed.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    from: (table: "workspace_members") => any;
  },
  workspaceId: string,
  userId: string,
) {
  const { data, error } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("Could not verify workspace role");
  if (data?.role !== "owner") throw new Error("Only the workspace owner can manage team members");
}

export const inviteWorkspaceAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => invitationInput.parse(input))
  .handler(async ({ data, context }) => {
    await requireWorkspaceOwner(context.supabase, data.workspaceId, context.userId);
    const { data: open, error: billingError } = await billingDb(context.supabase).rpc(
      "billing_crm_open",
      { cid: data.workspaceId },
    );
    if (billingError || open !== true) throw new Error("CRM access unavailable");

    const email = data.email.toLowerCase();
    const invitationId = crypto.randomUUID();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const adminDb = supabaseAdmin as unknown as {
      // The invitations table is introduced by the paired migration.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      from: (table: "workspace_invitations") => any;
    };

    const { error: insertError } = await adminDb.from("workspace_invitations").insert({
      id: invitationId,
      workspace_id: data.workspaceId,
      email,
      role: "agent",
      invited_by: context.userId,
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    if (insertError)
      throw new Error(
        "An active invitation for this email already exists, or the invitation could not be saved.",
      );

    const { error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: data.fullName, workspace_invitation_id: invitationId },
    });
    if (inviteError) {
      await adminDb.from("workspace_invitations").delete().eq("id", invitationId);
      throw new Error("Could not send the invitation. Verify the email settings and try again.");
    }
    return { invitationId };
  });

export const removeWorkspaceAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => memberInput.parse(input))
  .handler(async ({ data, context }) => {
    const userDb = context.supabase as unknown as {
      rpc: (
        name: "remove_workspace_member",
        args: { _workspace_id: string; _user_id: string },
      ) => Promise<{ error: Error | null }>;
    };
    const { error } = await userDb.rpc("remove_workspace_member", {
      _workspace_id: data.workspaceId,
      _user_id: data.userId,
    });
    if (error)
      throw new Error("Could not remove this team member. Check your access and try again.");
    return { success: true };
  });

export const cancelWorkspaceInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => invitationIdInput.parse(input))
  .handler(async ({ data, context }) => {
    const userDb = context.supabase as unknown as {
      rpc: (
        name: "cancel_workspace_invitation",
        args: { _workspace_id: string; _invitation_id: string },
      ) => Promise<{ error: Error | null }>;
    };
    const { error } = await userDb.rpc("cancel_workspace_invitation", {
      _workspace_id: data.workspaceId,
      _invitation_id: data.invitationId,
    });
    if (error)
      throw new Error("Could not cancel this invitation. Check your access and try again.");
    return { success: true };
  });
