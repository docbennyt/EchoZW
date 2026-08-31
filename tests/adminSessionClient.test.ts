import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAdminSession } from "../src/api/adminSession";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchAdminSession", () => {
  it("returns a verified admin session payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              authenticated: true,
              admin: true,
              user: {
                id: "admin-1",
                email: "admin@example.test",
              },
              staff: {
                id: "staff-1",
                role: "superadmin",
              },
              permissions: {
                canManageStaff: true,
                canManageInstitutions: true,
                canManageProgrammes: true,
                canManageClassGroups: true,
                canManageAllTimetables: true,
                canEditAssignedTimetables: true,
                canPublishAssignedTimetables: true,
              },
              assignments: [],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    await expect(fetchAdminSession("token")).resolves.toEqual({
      authenticated: true,
      admin: true,
      user: {
        id: "admin-1",
        email: "admin@example.test",
      },
      staff: {
        id: "staff-1",
        role: "superadmin",
      },
      permissions: {
        canManageStaff: true,
        canManageInstitutions: true,
        canManageProgrammes: true,
        canManageClassGroups: true,
        canManageAllTimetables: true,
        canEditAssignedTimetables: true,
        canPublishAssignedTimetables: true,
      },
      assignments: [],
    });
  });

  it("rejects malformed success payloads instead of treating them as valid sessions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<!doctype html><html></html>", {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          }),
      ),
    );

    await expect(fetchAdminSession("token")).rejects.toMatchObject({
      name: "INVALID_ADMIN_SESSION",
    });
  });
});
