import { describe, expect, it } from "vitest";
import {
  canChangeMemberRole,
  canDeleteWorkspace,
  canManageAssignments,
  canManageBilling,
  canManageTeam,
  canRemoveMember,
  canViewTeamWorkload,
  isManagerOrAbove,
  roleRank,
} from "./team-permissions";

describe("workspace team permissions", () => {
  it("allows only owners to manage the team", () => {
    expect(canManageTeam("owner")).toBe(true);
    expect(canManageTeam("manager")).toBe(false);
    expect(canManageTeam("agent")).toBe(false);
  });

  it("prevents removing yourself or an owner", () => {
    expect(canRemoveMember("owner", "owner-id", "agent", "agent-id")).toBe(true);
    expect(canRemoveMember("owner", "owner-id", "manager", "manager-id")).toBe(true);
    expect(canRemoveMember("manager", "manager-id", "agent", "agent-id")).toBe(false);
    expect(canRemoveMember("agent", "agent-id", "agent", "other-id")).toBe(false);
    expect(canRemoveMember("owner", "owner-id", "owner", "other-owner")).toBe(false);
    expect(canRemoveMember("owner", "owner-id", "agent", "owner-id")).toBe(false);
  });

  it("ranks owner above manager above agent", () => {
    expect(roleRank("owner")).toBeGreaterThan(roleRank("manager"));
    expect(roleRank("manager")).toBeGreaterThan(roleRank("agent"));
    expect(isManagerOrAbove("owner")).toBe(true);
    expect(isManagerOrAbove("manager")).toBe(true);
    expect(isManagerOrAbove("agent")).toBe(false);
  });

  it("lets managers view team workload and manage assignments, not agents", () => {
    expect(canViewTeamWorkload("manager")).toBe(true);
    expect(canViewTeamWorkload("agent")).toBe(false);
    expect(canViewTeamWorkload("owner")).toBe(true);
    expect(canManageAssignments("manager")).toBe(true);
    expect(canManageAssignments("agent")).toBe(false);
    expect(canManageAssignments("owner")).toBe(true);
  });

  it("lets only the owner change roles, and only between agent and manager", () => {
    // Owner promotes an agent to manager and demotes a manager to agent.
    expect(canChangeMemberRole("owner", "owner-id", "agent", "agent-id", "manager")).toBe(true);
    expect(canChangeMemberRole("owner", "owner-id", "manager", "manager-id", "agent")).toBe(true);
    // A manager cannot change anyone's role (including their own or an agent's).
    expect(canChangeMemberRole("manager", "manager-id", "agent", "agent-id", "manager")).toBe(
      false,
    );
    expect(canChangeMemberRole("manager", "manager-id", "manager", "manager-id", "agent")).toBe(
      false,
    );
    expect(canChangeMemberRole("agent", "agent-id", "agent", "other-id", "manager")).toBe(false);
    // Nobody can be changed to owner: ownership transfer is not supported.
    expect(canChangeMemberRole("owner", "owner-id", "agent", "agent-id", "owner")).toBe(false);
    expect(canChangeMemberRole("owner", "owner-id", "manager", "manager-id", "owner")).toBe(false);
    // The owner's own role cannot be changed, and neither can another owner's.
    expect(canChangeMemberRole("owner", "owner-id", "owner", "owner-id", "manager")).toBe(false);
    expect(canChangeMemberRole("owner", "owner-id", "owner", "other-owner", "agent")).toBe(false);
  });

  it("keeps billing and workspace deletion owner-only for managers", () => {
    expect(canManageBilling("owner")).toBe(true);
    expect(canManageBilling("manager")).toBe(false);
    expect(canManageBilling("agent")).toBe(false);
    expect(canDeleteWorkspace("owner")).toBe(true);
    expect(canDeleteWorkspace("manager")).toBe(false);
    expect(canDeleteWorkspace("agent")).toBe(false);
  });
});
