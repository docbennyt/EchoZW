import { describe, expect, it, vi } from "vitest";

const adminClientMocks = vi.hoisted(() => ({
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock("../server/supabase/adminClient", () => ({
  createSupabaseAdminClient: adminClientMocks.createSupabaseAdminClient,
}));

import {
  assignClassRep,
  inviteAdmin,
  resendStaffInvite,
  setStaffActive,
} from "../server/staffRepository";
import { permissionsForRole } from "../server/supabase/auth";

const founderActor = {
  userId: "founder-user",
  staffUserId: "staff-founder",
  role: "superadmin" as const,
  isFounder: true,
  permissions: permissionsForRole("superadmin", true),
};

const adminActor = {
  userId: "admin-user",
  staffUserId: "staff-admin",
  role: "admin" as const,
  isFounder: false,
  permissions: permissionsForRole("admin", false),
};

function queryBuilder(input: {
  single?: Record<string, unknown> | null;
  list?: Record<string, unknown>[];
}) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    order: vi.fn(() => builder),
    update: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    single: vi.fn(async () => ({ data: input.single ?? null, error: null })),
    maybeSingle: vi.fn(async () => ({
      data: input.single ?? null,
      error: null,
    })),
    then: (
      resolve: (value: {
        data: Record<string, unknown>[] | null;
        error: null;
      }) => unknown,
    ) => resolve({ data: input.list ?? [], error: null }),
  };
  return builder;
}

describe("staff repository founder and Admin safety", () => {
  it("rejects attempts to disable the protected founder before any update", async () => {
    const staffLookup = queryBuilder({
      single: {
        id: "staff-founder",
        user_id: "founder-user",
        role: "superadmin",
        is_founder: true,
        active: true,
      },
    });
    const auditBuilder = queryBuilder({ list: [] });
    const from = vi.fn((table: string) => {
      if (table === "staff_users") return staffLookup;
      if (table === "audit_logs") return auditBuilder;
      throw new Error(`Unexpected table ${table}`);
    });
    adminClientMocks.createSupabaseAdminClient.mockReturnValue({ from });

    await expect(
      setStaffActive({
        actor: adminActor,
        staffUserId: "staff-founder",
        active: false,
      }),
    ).rejects.toMatchObject({ code: "FOUNDER_PROTECTED", status: 403 });

    expect(staffLookup.update).not.toHaveBeenCalled();
    expect(auditBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ action: "staff.founder_change_rejected" }),
    );
  });

  it("prevents an operational Admin from disabling a peer Admin", async () => {
    const staffLookup = queryBuilder({
      single: {
        id: "staff-peer",
        user_id: "peer-user",
        role: "admin",
        is_founder: false,
        active: true,
      },
    });
    const auditBuilder = queryBuilder({ list: [] });
    const from = vi.fn((table: string) => {
      if (table === "staff_users") return staffLookup;
      if (table === "audit_logs") return auditBuilder;
      throw new Error(`Unexpected table ${table}`);
    });
    adminClientMocks.createSupabaseAdminClient.mockReturnValue({ from });

    await expect(
      setStaffActive({
        actor: adminActor,
        staffUserId: "staff-peer",
        active: false,
      }),
    ).rejects.toMatchObject({ code: "FOUNDER_REQUIRED", status: 403 });

    expect(staffLookup.update).not.toHaveBeenCalled();
    expect(auditBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ action: "staff.privilege_escalation_rejected" }),
    );
  });

  it("allows the founder to disable a non-founder Admin", async () => {
    const staffLookup = queryBuilder({
      single: {
        id: "staff-admin",
        user_id: "admin-user",
        role: "admin",
        is_founder: false,
        active: true,
      },
    });
    const updateBuilder = queryBuilder({ single: { id: "staff-admin" } });
    const auditBuilder = queryBuilder({ list: [] });
    let staffCalls = 0;
    const from = vi.fn((table: string) => {
      if (table === "staff_users") {
        staffCalls += 1;
        return staffCalls === 1 ? staffLookup : updateBuilder;
      }
      if (table === "audit_logs") return auditBuilder;
      throw new Error(`Unexpected table ${table}`);
    });
    adminClientMocks.createSupabaseAdminClient.mockReturnValue({ from });

    await expect(
      setStaffActive({
        actor: founderActor,
        staffUserId: "staff-admin",
        active: false,
      }),
    ).resolves.toBeUndefined();

    expect(updateBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({ active: false, disabled_at: expect.any(String) }),
    );
    expect(auditBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ action: "admin.deactivated" }),
    );
  });

  it("lets an operational Admin reassign a Class Rep without a nonexistent revoked_by column", async () => {
    const staffLookup = queryBuilder({
      single: {
        id: "staff-rep",
        user_id: "rep-user",
        role: "class_rep",
        is_founder: false,
        active: true,
      },
    });
    const revokeBuilder = queryBuilder({ list: [{ id: "old-assignment" }] });
    const insertBuilder = queryBuilder({ single: { id: "new-assignment" } });
    const auditBuilder = queryBuilder({ list: [] });
    let assignmentCalls = 0;
    const from = vi.fn((table: string) => {
      if (table === "staff_users") return staffLookup;
      if (table === "class_rep_assignments") {
        assignmentCalls += 1;
        return assignmentCalls === 1 ? revokeBuilder : insertBuilder;
      }
      if (table === "audit_logs") return auditBuilder;
      throw new Error(`Unexpected table ${table}`);
    });
    adminClientMocks.createSupabaseAdminClient.mockReturnValue({ from });

    await expect(
      assignClassRep({
        actor: adminActor,
        staffUserId: "staff-rep",
        timetableId: "timetable-1",
      }),
    ).resolves.toEqual({ id: "new-assignment" });

    expect(revokeBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        active: false,
        revoked_at: expect.any(String),
      }),
    );
    expect(revokeBuilder.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ revoked_by: expect.anything() }),
    );
  });

  it("resends Class Rep access through the shared DR-52 password setup flow", async () => {
    const staffLookup = queryBuilder({
      single: {
        id: "staff-rep",
        email: "rep@example.test",
        display_name: "Rep",
        role: "class_rep",
        is_founder: false,
        active: true,
      },
    });
    const timestampUpdate = queryBuilder({ single: { id: "staff-rep" } });
    const auditBuilder = queryBuilder({ list: [] });
    let staffCalls = 0;
    const from = vi.fn((table: string) => {
      if (table === "staff_users") {
        staffCalls += 1;
        return staffCalls === 1 ? staffLookup : timestampUpdate;
      }
      if (table === "audit_logs") return auditBuilder;
      throw new Error(`Unexpected table ${table}`);
    });
    const resetPasswordForEmail = vi.fn(async () => ({ error: null }));
    adminClientMocks.createSupabaseAdminClient.mockReturnValue({
      from,
      auth: { resetPasswordForEmail },
    });

    await expect(
      resendStaffInvite({
        actor: adminActor,
        staffUserId: "staff-rep",
      }),
    ).resolves.toBeUndefined();

    expect(resetPasswordForEmail).toHaveBeenCalledWith("rep@example.test", {
      redirectTo: "https://calender.aido.co.zw/account/update-password",
    });
  });

  it("reuses an existing Supabase Auth identity when the founder invites an Admin", async () => {
    const staffLookup = queryBuilder({ single: null });
    const staffInsert = queryBuilder({
      single: { id: "staff-new-admin", user_id: "auth-existing" },
    });
    const auditBuilder = queryBuilder({ list: [] });
    let staffCalls = 0;
    const from = vi.fn((table: string) => {
      if (table === "staff_users") {
        staffCalls += 1;
        return staffCalls === 1 ? staffLookup : staffInsert;
      }
      if (table === "audit_logs") return auditBuilder;
      throw new Error(`Unexpected table ${table}`);
    });
    const listUsers = vi.fn(async () => ({
      data: { users: [{ id: "auth-existing", email: "ops@example.test" }] },
      error: null,
    }));
    const inviteUserByEmail = vi.fn();
    const resetPasswordForEmail = vi.fn(async () => ({ error: null }));
    adminClientMocks.createSupabaseAdminClient.mockReturnValue({
      from,
      auth: {
        admin: { listUsers, inviteUserByEmail },
        resetPasswordForEmail,
      },
    });

    await expect(
      inviteAdmin({
        actor: founderActor,
        email: "OPS@example.test",
        displayName: "Operations Admin",
      }),
    ).resolves.toEqual({ staffUserId: "staff-new-admin" });

    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(resetPasswordForEmail).toHaveBeenCalledWith("ops@example.test", {
      redirectTo: "https://calender.aido.co.zw/account/update-password",
    });
    expect(staffInsert.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "auth-existing",
        role: "admin",
        is_founder: false,
      }),
    );
  });
});
