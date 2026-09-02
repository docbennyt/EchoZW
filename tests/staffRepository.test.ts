import { describe, expect, it, vi } from "vitest";

const adminClientMocks = vi.hoisted(() => ({
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock("../server/supabase/adminClient", () => ({
  createSupabaseAdminClient: adminClientMocks.createSupabaseAdminClient,
}));

import {
  assignClassRep,
  resendClassRepInvite,
  setStaffActive,
} from "../server/staffRepository";

function queryBuilder(input: {
  single?: Record<string, unknown> | null;
  list?: Record<string, unknown>[];
}) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
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

describe("staff repository safety", () => {
  it("does not disable the last active superadmin", async () => {
    const staffLookup = queryBuilder({
      single: { id: "staff-super", role: "superadmin", active: true },
    });
    const superadminCount = queryBuilder({
      list: [{ id: "staff-super" }],
    });
    const updateBuilder = queryBuilder({ single: { id: "staff-super" } });
    const from = vi
      .fn()
      .mockReturnValueOnce(staffLookup)
      .mockReturnValueOnce(superadminCount)
      .mockReturnValue(updateBuilder);
    adminClientMocks.createSupabaseAdminClient.mockReturnValue({
      from,
    });

    await expect(
      setStaffActive({
        actorId: "actor-1",
        staffUserId: "staff-super",
        active: false,
      }),
    ).rejects.toMatchObject({
      code: "LAST_SUPERADMIN",
      status: 409,
    });

    expect(updateBuilder.update).not.toHaveBeenCalled();
  });

  it("reassigns a class rep without writing a nonexistent revoked_by column", async () => {
    const revokeBuilder = queryBuilder({ list: [{ id: "old-assignment" }] });
    const insertBuilder = queryBuilder({ single: { id: "new-assignment" } });
    const auditBuilder = queryBuilder({ single: { id: "audit-1" } });
    let assignmentCalls = 0;
    const from = vi.fn((table: string) => {
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
        actorId: "actor-1",
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
    expect(insertBuilder.insert).toHaveBeenCalledWith({
      staff_user_id: "staff-rep",
      timetable_id: "timetable-1",
      active: true,
      created_by: "actor-1",
    });
  });

  it("resends class rep access through the password setup flow", async () => {
    const staffLookup = queryBuilder({
      single: {
        id: "staff-rep",
        email: "rep@example.test",
        display_name: "Rep",
        role: "class_rep",
        active: true,
      },
    });
    const timestampUpdate = queryBuilder({ single: { id: "staff-rep" } });
    const auditBuilder = queryBuilder({ single: { id: "audit-1" } });
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
      resendClassRepInvite({
        actorId: "actor-1",
        staffUserId: "staff-rep",
      }),
    ).resolves.toBeUndefined();

    expect(resetPasswordForEmail).toHaveBeenCalledWith("rep@example.test", {
      redirectTo: "https://calender.aido.co.zw/account/update-password",
    });
  });
});
