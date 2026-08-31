import type { IncomingMessage } from "node:http";
import { describe, expect, it, vi } from "vitest";
import {
  requireStaffUser,
  requireSuperadmin,
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
    role: "superadmin" | "class_rep";
    active: boolean;
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
  it("returns active superadmin staff with global permissions", async () => {
    await expect(
      requireStaffUser(request(), {
        createUserClient: () =>
          userClient({ id: "user-1", email: "admin@example.test" }),
        createAdminClient: () =>
          staffClient({
            staff: {
              id: "staff-1",
              user_id: "user-1",
              role: "superadmin",
              active: true,
            },
          }),
      }),
    ).resolves.toMatchObject({
      user: { id: "user-1", email: "admin@example.test" },
      staff: { id: "staff-1", role: "superadmin" },
      permissions: {
        canManageStaff: true,
        canManageAllTimetables: true,
      },
      assignments: [],
    });
  });

  it("falls back to legacy active admin_users as superadmin during migration", async () => {
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
      staff: { id: "legacy-admin", role: "superadmin" },
      permissions: { canManageStaff: true },
    });
  });

  it("rejects normal authenticated users without staff or legacy admin authorization", async () => {
    await expect(
      requireStaffUser(request(), {
        createUserClient: () =>
          userClient({ id: "user-1", email: "user@example.test" }),
        createAdminClient: () =>
          staffClient({ staff: null, legacyAdmin: null }),
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });
  });

  it("requires superadmin role for staff management", async () => {
    await expect(
      requireSuperadmin(request(), {
        createUserClient: () =>
          userClient({ id: "rep-user", email: "rep@example.test" }),
        createAdminClient: () =>
          staffClient({
            staff: {
              id: "staff-rep",
              user_id: "rep-user",
              role: "class_rep",
              active: true,
            },
          }),
      }),
    ).rejects.toMatchObject({
      code: "SUPERADMIN_REQUIRED",
      status: 403,
    });
  });

  it("allows a class rep to edit only an assigned timetable", async () => {
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

  it("blocks class reps from unassigned timetables", async () => {
    await expect(
      requireTimetableEditor(request(), "other-timetable", {
        createUserClient: () =>
          userClient({ id: "rep-user", email: "rep@example.test" }),
        createAdminClient: () =>
          staffClient({
            staff: {
              id: "staff-rep",
              user_id: "rep-user",
              role: "class_rep",
              active: true,
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
