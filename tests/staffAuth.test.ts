import type { IncomingMessage } from "node:http";
import { describe, expect, it, vi } from "vitest";
import {
  requireFounderSuperadmin,
  requireOperationalAdmin,
  requireStaffUser,
  requireTimetableEditor,
} from "../server/supabase/auth";

function request(authorization = "Bearer valid") {
  return {
    headers: { authorization },
    method: "GET",
    url: "/api/admin/session",
  } as IncomingMessage;
}

function userClient(user?: { id: string; email?: string }, error?: Error) {
  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: user ? { id: user.id, email: user.email } : null },
        error,
      })),
    },
  };
}

function staffClient(input: {
  staff?: {
    id: string;
    user_id: string;
    role: "superadmin" | "admin" | "class_rep";
    active: boolean;
    is_founder?: boolean;
  } | null;
  legacyAdmin?: { user_id: string; active: boolean } | null;
  assignment?: { id: string; active: boolean } | null;
  error?: Error;
}) {
  return {
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => {
          const eqBuilder = {
            eq: vi.fn(() => eqBuilder),
            maybeSingle: vi.fn(async () => ({
              data:
                table === "class_rep_assignments"
                  ? (input.assignment ?? null)
                  : table === "staff_users"
                    ? (input.staff ?? null)
                    : (input.legacyAdmin ?? null),
              error: input.error,
            })),
          };
          return eqBuilder;
        }),
      })),
    })),
  };
}

describe("staff authorization helpers", () => {
  it("returns the protected founder with root and operational permissions", async () => {
    await expect(
      requireStaffUser(request(), {
        createUserClient: () =>
          userClient({ id: "user-1", email: "founder@example.test" }),
        createAdminClient: () =>
          staffClient({
            staff: {
              id: "staff-1",
              user_id: "user-1",
              role: "superadmin",
              active: true,
              is_founder: true,
            },
          }),
      }),
    ).resolves.toMatchObject({
      user: { id: "user-1", email: "founder@example.test" },
      staff: { id: "staff-1", role: "superadmin", isFounder: true },
      permissions: {
        canManageAdmins: true,
        canManageClassReps: true,
        canManageAllTimetables: true,
        canManageFounderAuthority: true,
      },
      assignments: [],
    });
  });

  it("gives Admin broad operational access without founder authority", async () => {
    await expect(
      requireOperationalAdmin(request(), {
        createUserClient: () =>
          userClient({ id: "admin-user", email: "admin@example.test" }),
        createAdminClient: () =>
          staffClient({
            staff: {
              id: "staff-admin",
              user_id: "admin-user",
              role: "admin",
              active: true,
              is_founder: false,
            },
          }),
      }),
    ).resolves.toMatchObject({
      staff: { role: "admin", isFounder: false },
      permissions: {
        canManageInstitutions: true,
        canManageAllTimetables: true,
        canManageSources: true,
        canViewOperationalAnalytics: true,
        canManageClassReps: true,
        canManageAdmins: false,
        canManageFounderAuthority: false,
      },
    });
  });

  it("never infers founder authority from the legacy admin_users fallback", async () => {
    await expect(
      requireStaffUser(request(), {
        createUserClient: () =>
          userClient({ id: "legacy-admin", email: "admin@example.test" }),
        createAdminClient: () =>
          staffClient({
            staff: null,
            legacyAdmin: { user_id: "legacy-admin", active: true },
          }),
      }),
    ).resolves.toMatchObject({
      staff: { id: "legacy-admin", role: "admin", isFounder: false },
      permissions: {
        canManageAllTimetables: true,
        canManageAdmins: false,
        canManageFounderAuthority: false,
      },
    });
  });

  it("rejects an unmarked superadmin instead of treating the role string as founder proof", async () => {
    await expect(
      requireStaffUser(request(), {
        createUserClient: () => userClient({ id: "unsafe-root" }),
        createAdminClient: () =>
          staffClient({
            staff: {
              id: "staff-unsafe",
              user_id: "unsafe-root",
              role: "superadmin",
              active: true,
              is_founder: false,
            },
          }),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("rejects normal authenticated users without staff or legacy admin authorization", async () => {
    await expect(
      requireStaffUser(request(), {
        createUserClient: () =>
          userClient({ id: "user-1", email: "user@example.test" }),
        createAdminClient: () => staffClient({ staff: null, legacyAdmin: null }),
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });
  });

  it("requires durable founder authority for root-only operations", async () => {
    await expect(
      requireFounderSuperadmin(request(), {
        createUserClient: () =>
          userClient({ id: "admin-user", email: "admin@example.test" }),
        createAdminClient: () =>
          staffClient({
            staff: {
              id: "staff-admin",
              user_id: "admin-user",
              role: "admin",
              active: true,
              is_founder: false,
            },
          }),
      }),
    ).rejects.toMatchObject({
      code: "FOUNDER_REQUIRED",
      status: 403,
    });
  });

  it("blocks Class Reps from global operational Admin access", async () => {
    await expect(
      requireOperationalAdmin(request(), {
        createUserClient: () => userClient({ id: "rep-user" }),
        createAdminClient: () =>
          staffClient({
            staff: {
              id: "staff-rep",
              user_id: "rep-user",
              role: "class_rep",
              active: true,
              is_founder: false,
            },
          }),
      }),
    ).rejects.toMatchObject({
      code: "OPERATIONAL_ADMIN_REQUIRED",
      status: 403,
    });
  });

  it("allows an Admin to edit any timetable without a Class Rep assignment", async () => {
    await expect(
      requireTimetableEditor(request(), "timetable-1", {
        createUserClient: () => userClient({ id: "admin-user" }),
        createAdminClient: () =>
          staffClient({
            staff: {
              id: "staff-admin",
              user_id: "admin-user",
              role: "admin",
              active: true,
              is_founder: false,
            },
            assignment: null,
          }),
      }),
    ).resolves.toMatchObject({
      staff: { role: "admin" },
      permissions: { canEditAllTimetables: true },
    });
  });

  it("allows a Class Rep to edit only an assigned timetable", async () => {
    await expect(
      requireTimetableEditor(request(), "timetable-1", {
        createUserClient: () =>
          userClient({ id: "rep-user", email: "rep@example.test" }),
        createAdminClient: () =>
          staffClient({
            staff: {
              id: "staff-rep",
              user_id: "rep-user",
              role: "class_rep",
              active: true,
              is_founder: false,
            },
            assignment: { id: "assignment-1", active: true },
          }),
      }),
    ).resolves.toMatchObject({
      staff: { id: "staff-rep", role: "class_rep" },
      permissions: {
        canEditAssignedTimetables: true,
        canPublishAssignedTimetables: true,
      },
    });
  });

  it("blocks Class Reps from unassigned timetables", async () => {
    await expect(
      requireTimetableEditor(request(), "other-timetable", {
        createUserClient: () => userClient({ id: "rep-user" }),
        createAdminClient: () =>
          staffClient({
            staff: {
              id: "staff-rep",
              user_id: "rep-user",
              role: "class_rep",
              active: true,
              is_founder: false,
            },
            assignment: null,
          }),
      }),
    ).rejects.toMatchObject({
      code: "TIMETABLE_ACCESS_DENIED",
      status: 403,
    });
  });
});
