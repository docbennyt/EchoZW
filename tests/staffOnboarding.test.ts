import { describe, expect, it } from "vitest";
import type { AdminSessionResponse } from "../src/api/adminSession";
import {
  resolveStaffOnboarding,
  StaffOnboardingAccessError,
} from "../src/domain/staffOnboarding";

function session(
  role: AdminSessionResponse["staff"]["role"],
  options: { founder?: boolean; assignments?: number } = {},
): AdminSessionResponse {
  const assignments = Array.from(
    { length: options.assignments ?? 0 },
    (_, i) => ({
      id: `assignment-${i}`,
      timetableId: `timetable-${i}`,
      publicSlug: `class-${i}`,
      institutionName: "Harare Institute of Technology",
      programmeName: "Computer Science",
      classGroupLabel: `CS.${i + 1}`,
      academicPeriodName: "August Semester 2026",
    }),
  );
  const operational = role === "admin" || role === "superadmin";
  return {
    authenticated: true,
    admin: true,
    user: { id: "user-1", email: "staff@example.com" },
    staff: {
      id: "staff-1",
      role,
      isFounder: options.founder === true,
      displayName: "Staff Test",
      email: "staff@example.com",
    },
    permissions: {
      canManageStaff: operational,
      canManageAdmins: role === "superadmin" && options.founder === true,
      canManageClassReps: operational,
      canManageInstitutions: operational,
      canManageProgrammes: operational,
      canManageClassGroups: operational,
      canManageAcademicPeriods: operational,
      canManageAllTimetables: operational,
      canEditAllTimetables: operational,
      canPublishAllTimetables: operational,
      canManageSources: operational,
      canViewOperationalAnalytics: operational,
      canManageFounderAuthority:
        role === "superadmin" && options.founder === true,
      canEditAssignedTimetables: operational || role === "class_rep",
      canPublishAssignedTimetables: operational || role === "class_rep",
    },
    assignments,
  };
}

describe("staff onboarding authorization mapping", () => {
  it("maps only protected founder superadmin authority to founder onboarding", () => {
    expect(
      resolveStaffOnboarding(session("superadmin", { founder: true })),
    ).toMatchObject({
      role: "founder",
      roleLabel: "Founder / Superadmin",
      destination: "/admin",
    });
    expect(() => resolveStaffOnboarding(session("superadmin"))).toThrow(
      StaffOnboardingAccessError,
    );
  });

  it("maps operational Admin without granting founder authority", () => {
    const resolved = resolveStaffOnboarding(session("admin"));
    expect(resolved.role).toBe("admin");
    expect(resolved.summary).toContain(
      "Founder-only authority remains protected",
    );
    expect(() =>
      resolveStaffOnboarding(session("admin", { founder: true })),
    ).toThrow(StaffOnboardingAccessError);
  });

  it("requires an active Class Rep assignment before onboarding can complete", () => {
    expect(() => resolveStaffOnboarding(session("class_rep"))).toThrow(
      StaffOnboardingAccessError,
    );
    expect(
      resolveStaffOnboarding(session("class_rep", { assignments: 1 })),
    ).toMatchObject({
      role: "class_rep",
      roleLabel: "Class Rep",
      destination: "/admin",
      assignment: { classGroupLabel: "CS.1" },
    });
  });
});
