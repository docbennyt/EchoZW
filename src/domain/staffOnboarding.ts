import type {
  AdminSessionAssignment,
  AdminSessionResponse,
} from "../api/adminSession.js";

export type StaffOnboardingRole = "founder" | "admin" | "class_rep";

export type ResolvedStaffOnboarding = {
  role: StaffOnboardingRole;
  roleLabel: string;
  destination: "/admin";
  summary: string;
  assignment: AdminSessionAssignment | null;
};

export class StaffOnboardingAccessError extends Error {
  constructor(
    message = "CalenderZW staff access is not ready for this account.",
  ) {
    super(message);
    this.name = "STAFF_ONBOARDING_ACCESS_INVALID";
  }
}

function classRepSummary(assignments: AdminSessionAssignment[]) {
  if (assignments.length === 1) {
    const assignment = assignments[0];
    return `Your Class Rep access is ready for ${assignment.classGroupLabel} · ${assignment.academicPeriodName}.`;
  }
  return `Your Class Rep access is ready for ${assignments.length} assigned classes.`;
}

export function resolveStaffOnboarding(
  session: AdminSessionResponse,
): ResolvedStaffOnboarding {
  const { staff, assignments } = session;

  if (staff.role === "superadmin") {
    if (!staff.isFounder) throw new StaffOnboardingAccessError();
    return {
      role: "founder",
      roleLabel: "Founder / Superadmin",
      destination: "/admin",
      summary:
        "Your protected Founder / Superadmin access is ready. Installing the app changes the device experience, not your permissions.",
      assignment: null,
    };
  }

  if (staff.isFounder) {
    // Founder authority must remain coupled to the protected superadmin role.
    throw new StaffOnboardingAccessError();
  }

  if (staff.role === "admin") {
    if (!session.permissions.canManageAllTimetables) {
      throw new StaffOnboardingAccessError();
    }
    return {
      role: "admin",
      roleLabel: "Admin",
      destination: "/admin",
      summary:
        "Your operational Admin access is ready. Founder-only authority remains protected.",
      assignment: null,
    };
  }

  if (staff.role === "class_rep") {
    if (
      assignments.length === 0 ||
      !session.permissions.canEditAssignedTimetables
    ) {
      throw new StaffOnboardingAccessError();
    }
    return {
      role: "class_rep",
      roleLabel: "Class Rep",
      destination: "/admin",
      summary: classRepSummary(assignments),
      assignment: assignments.length === 1 ? assignments[0] : null,
    };
  }

  throw new StaffOnboardingAccessError();
}
