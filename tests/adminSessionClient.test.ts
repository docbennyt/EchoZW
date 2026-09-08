import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAdminSession } from "../src/api/adminSession";

const operationalPermissions = {
  canManageStaff: true,
  canManageAdmins: false,
  canManageClassReps: true,
  canManageInstitutions: true,
  canManageProgrammes: true,
  canManageClassGroups: true,
  canManageAcademicPeriods: true,
  canManageAllTimetables: true,
  canEditAllTimetables: true,
  canPublishAllTimetables: true,
  canManageSources: true,
  canViewOperationalAnalytics: true,
  canManageFounderAuthority: false,
  canEditAssignedTimetables: true,
  canPublishAssignedTimetables: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchAdminSession", () => {
  it("returns a verified protected-founder session payload", async () => {
    const payload = {
      authenticated: true,
      admin: true,
      user: {
        id: "founder-1",
        email: "founder@example.test",
      },
      staff: {
        id: "staff-founder",
        role: "superadmin",
        isFounder: true,
        displayName: null,
        email: "founder@example.test",
      },
      permissions: {
        ...operationalPermissions,
        canManageAdmins: true,
        canManageFounderAuthority: true,
      },
      assignments: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(payload), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );

    await expect(fetchAdminSession("token")).resolves.toEqual(payload);
  });

  it("accepts a real operational Admin role without founder authority", async () => {
    const payload = {
      authenticated: true,
      admin: true,
      user: { id: "admin-1", email: "admin@example.test" },
      staff: {
        id: "staff-admin",
        role: "admin",
        isFounder: false,
        displayName: "Ops Admin",
        email: "admin@example.test",
      },
      permissions: operationalPermissions,
      assignments: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(payload), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );

    await expect(fetchAdminSession("token")).resolves.toEqual(payload);
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
