import { beforeEach, describe, expect, it, vi } from "vitest";

const adminClientMocks = vi.hoisted(() => ({
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock("../server/supabase/adminClient", () => ({
  createSupabaseAdminClient: adminClientMocks.createSupabaseAdminClient,
}));

import {
  assignClassRep,
  inviteAdmin,
  inviteClassRep,
  resendStaffInvite,
  setStaffActive,
  setStaffRepositoryEnv,
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

beforeEach(() => {
  vi.clearAllMocks();
  setStaffRepositoryEnv({
    PUBLIC_APP_URL: "https://calender.aido.co.zw",
  } as NodeJS.ProcessEnv);
});

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
      expect.objectContaining({
        action: "staff.privilege_escalation_rejected",
      }),
    );
  });

  // RPC stubs only return boundary responses; they never simulate table writes.
  // The independent PostgreSQL suite verifies mutation/audit contents and rollback.
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
    const from = vi.fn(() => staffLookup);
    const rpc = vi.fn().mockResolvedValue({ data: {}, error: null });
    adminClientMocks.createSupabaseAdminClient.mockReturnValue({ from, rpc });
    await expect(
      setStaffActive({
        actor: founderActor,
        staffUserId: "staff-admin",
        active: false,
      }),
    ).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledExactlyOnceWith("czw_staff_lifecycle", {
      p_actor_user_id: "founder-user",
      p_operation: "set_active",
      p_input: { staffUserId: "staff-admin", active: false },
    });
    expect(staffLookup.update).not.toHaveBeenCalled();
    expect(staffLookup.insert).not.toHaveBeenCalled();
  });

  it("lets an operational Admin reassign a Class Rep without a nonexistent revoked_by column", async () => {
    const from = vi.fn();
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: { id: "new-assignment" }, error: null });
    adminClientMocks.createSupabaseAdminClient.mockReturnValue({ from, rpc });
    await expect(
      assignClassRep({
        actor: adminActor,
        staffUserId: "staff-rep",
        timetableId: "timetable-1",
      }),
    ).resolves.toEqual({ id: "new-assignment" });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("czw_staff_lifecycle", {
      p_actor_user_id: "admin-user",
      p_operation: "assign",
      p_input: { staffUserId: "staff-rep", timetableId: "timetable-1" },
    });
    expect(rpc.mock.calls[0][1].p_input).not.toHaveProperty("revoked_by");
    expect(from).not.toHaveBeenCalled();
  });

  it("sends a genuine Supabase invitation for a brand-new Class Rep", async () => {
    const timetable = queryBuilder({ single: { id: "timetable-1" } });
    const from = vi.fn((table: string) => {
      if (table === "timetables") return timetable;
      throw new Error(`Unexpected table ${table}`);
    });
    const listUsers = vi.fn(async () => ({ data: { users: [] }, error: null }));
    const inviteUserByEmail = vi.fn(async () => ({
      data: { user: { id: "auth-new", email: "rep@example.test" } },
      error: null,
    }));
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: { reserved: true }, error: null })
      .mockResolvedValueOnce({
        data: {
          staffUserId: "staff-new",
          assignmentId: "assignment-new",
          enrollment: "invited_new_user",
        },
        error: null,
      });
    adminClientMocks.createSupabaseAdminClient.mockReturnValue({
      from,
      rpc,
      auth: { admin: { listUsers, inviteUserByEmail } },
    });
    await expect(
      inviteClassRep({
        actor: adminActor,
        email: "REP@example.test",
        displayName: "Rep",
        timetableId: "timetable-1",
      }),
    ).resolves.toEqual({
      staffUserId: "staff-new",
      assignmentId: "assignment-new",
      enrollment: "invited_new_user",
    });
    expect(inviteUserByEmail).toHaveBeenCalledWith("rep@example.test", {
      data: { display_name: "Rep", product: "CalenderZW" },
      redirectTo: "https://calender.aido.co.zw/account/update-password",
    });
    expect(rpc).toHaveBeenNthCalledWith(1, "czw_staff_lifecycle", {
      p_actor_user_id: "admin-user",
      p_operation: "reserve_invite",
      p_input: {
        email: "rep@example.test",
        role: "class_rep",
        timetableId: "timetable-1",
      },
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "czw_staff_lifecycle", {
      p_actor_user_id: "admin-user",
      p_operation: "enroll_class_rep",
      p_input: {
        userId: "auth-new",
        email: "rep@example.test",
        displayName: "Rep",
        timetableId: "timetable-1",
        enrollment: "invited_new_user",
        invitationSent: true,
        existingAuthUser: false,
      },
    });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(timetable.maybeSingle.mock.invocationCallOrder[0]).toBeLessThan(
      listUsers.mock.invocationCallOrder[0],
    );
    expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(
      inviteUserByEmail.mock.invocationCallOrder[0],
    );
    expect(inviteUserByEmail.mock.invocationCallOrder[0]).toBeLessThan(
      rpc.mock.invocationCallOrder[1],
    );
  });

  it("does not send any auth email when resending access for a confirmed Class Rep", async () => {
    const staffLookup = queryBuilder({
      single: {
        id: "staff-rep",
        user_id: "auth-rep",
        email: "rep@example.test",
        display_name: "Rep",
        role: "class_rep",
        is_founder: false,
        active: true,
      },
    });
    const from = vi.fn(() => staffLookup);
    const listUsers = vi.fn(async () => ({
      data: {
        users: [
          {
            id: "auth-rep",
            email: "rep@example.test",
            email_confirmed_at: "2026-09-01T10:00:00.000Z",
          },
        ],
      },
      error: null,
    }));
    const inviteUserByEmail = vi.fn();
    const rpc = vi.fn().mockResolvedValue({
      data: { enrollment: "access_granted_existing_user" },
      error: null,
    });
    adminClientMocks.createSupabaseAdminClient.mockReturnValue({
      from,
      rpc,
      auth: { admin: { listUsers, inviteUserByEmail } },
    });
    await expect(
      resendStaffInvite({
        actor: adminActor,
        staffUserId: "staff-rep",
      }),
    ).resolves.toEqual({ enrollment: "access_granted_existing_user" });
    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(staffLookup.update).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledExactlyOnceWith("czw_staff_lifecycle", {
      p_actor_user_id: "admin-user",
      p_operation: "record_resend",
      p_input: {
        staffUserId: "staff-rep",
        userId: "auth-rep",
        email: "rep@example.test",
        enrollment: "access_granted_existing_user",
        invitationSent: false,
      },
    });
  });

  it("resends a real invite for an existing pending Class Rep", async () => {
    const staffLookup = queryBuilder({
      single: {
        id: "staff-rep",
        user_id: "auth-rep",
        email: "rep@example.test",
        display_name: "Rep",
        role: "class_rep",
        is_founder: false,
        active: true,
      },
    });
    const from = vi.fn(() => staffLookup);
    const listUsers = vi.fn(async () => ({
      data: {
        users: [
          {
            id: "auth-rep",
            email: "rep@example.test",
            invited_at: "2026-09-28T10:00:00.000Z",
            email_confirmed_at: null,
          },
        ],
      },
      error: null,
    }));
    const inviteUserByEmail = vi.fn(async () => ({
      data: { user: { id: "auth-rep", email: "rep@example.test" } },
      error: null,
    }));
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: { reserved: true }, error: null })
      .mockResolvedValueOnce({
        data: { enrollment: "invite_resent_pending_user" },
        error: null,
      });
    adminClientMocks.createSupabaseAdminClient.mockReturnValue({
      from,
      rpc,
      auth: { admin: { listUsers, inviteUserByEmail } },
    });
    await expect(
      resendStaffInvite({
        actor: adminActor,
        staffUserId: "staff-rep",
      }),
    ).resolves.toEqual({ enrollment: "invite_resent_pending_user" });
    expect(inviteUserByEmail).toHaveBeenCalledWith("rep@example.test", {
      data: { display_name: "Rep", product: "CalenderZW" },
      redirectTo: "https://calender.aido.co.zw/account/update-password",
    });
    expect(rpc).toHaveBeenNthCalledWith(1, "czw_staff_lifecycle", {
      p_actor_user_id: "admin-user",
      p_operation: "reserve_invite",
      p_input: {
        email: "rep@example.test",
        role: "class_rep",
        userId: "auth-rep",
        staffUserId: "staff-rep",
      },
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "czw_staff_lifecycle", {
      p_actor_user_id: "admin-user",
      p_operation: "record_resend",
      p_input: {
        userId: "auth-rep",
        staffUserId: "staff-rep",
        email: "rep@example.test",
        enrollment: "invite_resent_pending_user",
        invitationSent: true,
      },
    });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(staffLookup.update).not.toHaveBeenCalled();
  });

  it("reuses a confirmed Supabase Auth identity without forcing recovery when the founder grants Admin access", async () => {
    const staffLookup = queryBuilder({ single: null });
    const from = vi.fn(() => staffLookup);
    const listUsers = vi.fn(async () => ({
      data: {
        users: [
          {
            id: "auth-existing",
            email: "ops@example.test",
            email_confirmed_at: "2026-09-01T10:00:00.000Z",
          },
        ],
      },
      error: null,
    }));
    const inviteUserByEmail = vi.fn();
    const rpc = vi.fn().mockResolvedValue({
      data: {
        staffUserId: "staff-new-admin",
        enrollment: "access_granted_existing_user",
      },
      error: null,
    });
    adminClientMocks.createSupabaseAdminClient.mockReturnValue({
      from,
      rpc,
      auth: { admin: { listUsers, inviteUserByEmail } },
    });
    await expect(
      inviteAdmin({
        actor: founderActor,
        email: "OPS@example.test",
        displayName: "Operations Admin",
      }),
    ).resolves.toEqual({
      staffUserId: "staff-new-admin",
      enrollment: "access_granted_existing_user",
    });
    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledExactlyOnceWith("czw_staff_lifecycle", {
      p_actor_user_id: "founder-user",
      p_operation: "enroll_admin",
      p_input: {
        userId: "auth-existing",
        email: "ops@example.test",
        displayName: "Operations Admin",
        enrollment: "access_granted_existing_user",
        invitationSent: false,
        existingAuthUser: true,
      },
    });
    expect(staffLookup.insert).not.toHaveBeenCalled();
    expect(rpc.mock.calls[0][1].p_input).not.toHaveProperty("is_founder");
  });

  it("rejects a missing timetable before Auth lookup, email or enrollment", async () => {
    const timetable = queryBuilder({ single: null });
    const from = vi.fn(() => timetable);
    const listUsers = vi.fn(),
      inviteUserByEmail = vi.fn(),
      rpc = vi.fn();
    adminClientMocks.createSupabaseAdminClient.mockReturnValue({
      from,
      rpc,
      auth: { admin: { listUsers, inviteUserByEmail } },
    });
    await expect(
      inviteClassRep({
        actor: adminActor,
        email: "rep@example.test",
        displayName: "Rep",
        timetableId: "missing",
      }),
    ).rejects.toMatchObject({ code: "TIMETABLE_NOT_FOUND", status: 404 });
    expect(listUsers).not.toHaveBeenCalled();
    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed when Auth pagination reaches its safety bound", async () => {
    const from = vi.fn(() => queryBuilder({ single: { id: "timetable-1" } }));
    const listUsers = vi.fn(async () => ({
      data: {
        users: Array.from({ length: 1000 }, (_, index) => ({
          id: `fixture-${index}`,
          email: `unrelated-${index}@example.test`,
        })),
      },
      error: null,
    }));
    const inviteUserByEmail = vi.fn(),
      rpc = vi.fn();
    adminClientMocks.createSupabaseAdminClient.mockReturnValue({
      from,
      rpc,
      auth: { admin: { listUsers, inviteUserByEmail } },
    });
    await expect(
      inviteClassRep({
        actor: adminActor,
        email: "rep@example.test",
        displayName: "Rep",
        timetableId: "timetable-1",
      }),
    ).rejects.toMatchObject({ code: "AUTH_LOOKUP_INCOMPLETE", status: 503 });
    expect(listUsers).toHaveBeenCalledTimes(20);
    expect(listUsers).toHaveBeenLastCalledWith({ page: 20, perPage: 1000 });
    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(["INVITE_RATE_LIMITED", "INVITE_ACTOR_RATE_LIMITED"])(
    "does not call Auth invitation or enrollment after %s",
    async (code) => {
      const from = vi.fn(() => queryBuilder({ single: { id: "timetable-1" } }));
      const listUsers = vi.fn(async () => ({
        data: { users: [] },
        error: null,
      }));
      const inviteUserByEmail = vi.fn();
      const rpc = vi
        .fn()
        .mockResolvedValue({ data: { error: { code } }, error: null });
      adminClientMocks.createSupabaseAdminClient.mockReturnValue({
        from,
        rpc,
        auth: { admin: { listUsers, inviteUserByEmail } },
      });
      await expect(
        inviteClassRep({
          actor: adminActor,
          email: "rep@example.test",
          displayName: "Rep",
          timetableId: "timetable-1",
        }),
      ).rejects.toMatchObject({ code, status: 429 });
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(rpc.mock.calls[0][1].p_operation).toBe("reserve_invite");
      expect(inviteUserByEmail).not.toHaveBeenCalled();
    },
  );

  it("does not release a committed reservation or create membership after provider failure", async () => {
    const from = vi.fn(() => queryBuilder({ single: { id: "timetable-1" } }));
    const listUsers = vi.fn(async () => ({ data: { users: [] }, error: null }));
    const inviteUserByEmail = vi.fn(async () => ({
      data: { user: null },
      error: { message: "synthetic-provider-failure" },
    }));
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: { reserved: true }, error: null });
    adminClientMocks.createSupabaseAdminClient.mockReturnValue({
      from,
      rpc,
      auth: { admin: { listUsers, inviteUserByEmail } },
    });
    await expect(
      inviteClassRep({
        actor: adminActor,
        email: "rep@example.test",
        displayName: "Rep",
        timetableId: "timetable-1",
      }),
    ).rejects.toMatchObject({ code: "INVITE_FAILED", status: 502 });
    expect(inviteUserByEmail).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][1].p_operation).toBe("reserve_invite");
  });
});
