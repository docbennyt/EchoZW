export type AdminSessionUser = {
  id: string;
  email: string | null;
};

export type StaffRole = "superadmin" | "class_rep";

export type AdminSessionStaff = {
  id: string;
  role: StaffRole;
  displayName: string | null;
  email: string | null;
};

export type AdminSessionAssignment = {
  id: string;
  timetableId: string;
  publicSlug: string;
  institutionName: string;
  programmeName: string;
  classGroupLabel: string;
  academicPeriodName: string;
};

export type AdminSessionPermissions = {
  canManageStaff: boolean;
  canManageInstitutions: boolean;
  canManageProgrammes: boolean;
  canManageClassGroups: boolean;
  canManageAllTimetables: boolean;
  canEditAssignedTimetables: boolean;
  canPublishAssignedTimetables: boolean;
};

export type AdminSessionResponse = {
  authenticated: true;
  admin: true;
  user: AdminSessionUser;
  staff: AdminSessionStaff;
  permissions: AdminSessionPermissions;
  assignments: AdminSessionAssignment[];
};

function isAdminSessionStaff(value: unknown): value is AdminSessionStaff {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AdminSessionStaff>;
  return (
    typeof candidate.id === "string" &&
    (candidate.role === "superadmin" || candidate.role === "class_rep") &&
    (typeof candidate.displayName === "string" ||
      candidate.displayName === null) &&
    (typeof candidate.email === "string" || candidate.email === null)
  );
}

function isAdminSessionPermissions(
  value: unknown,
): value is AdminSessionPermissions {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AdminSessionPermissions>;
  return (
    typeof candidate.canManageStaff === "boolean" &&
    typeof candidate.canManageInstitutions === "boolean" &&
    typeof candidate.canManageProgrammes === "boolean" &&
    typeof candidate.canManageClassGroups === "boolean" &&
    typeof candidate.canManageAllTimetables === "boolean" &&
    typeof candidate.canEditAssignedTimetables === "boolean" &&
    typeof candidate.canPublishAssignedTimetables === "boolean"
  );
}

function isAdminSessionAssignment(
  value: unknown,
): value is AdminSessionAssignment {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AdminSessionAssignment>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.timetableId === "string" &&
    typeof candidate.publicSlug === "string" &&
    typeof candidate.institutionName === "string" &&
    typeof candidate.programmeName === "string" &&
    typeof candidate.classGroupLabel === "string" &&
    typeof candidate.academicPeriodName === "string"
  );
}

function isAdminSessionAssignments(
  value: unknown,
): value is AdminSessionAssignment[] {
  return Array.isArray(value) && value.every(isAdminSessionAssignment);
}

function isAdminSessionResponse(value: unknown): value is AdminSessionResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AdminSessionResponse>;
  return (
    candidate.authenticated === true &&
    candidate.admin === true &&
    Boolean(candidate.user) &&
    typeof candidate.user?.id === "string" &&
    (typeof candidate.user?.email === "string" ||
      candidate.user?.email === null) &&
    isAdminSessionStaff(candidate.staff) &&
    isAdminSessionPermissions(candidate.permissions) &&
    isAdminSessionAssignments(candidate.assignments)
  );
}

export async function fetchAdminSession(accessToken: string) {
  const response = await fetch("/api/admin/session", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const body = (await response.json().catch(() => null)) as
    | AdminSessionResponse
    | { error?: { code?: string; message?: string } }
    | null;

  if (!response.ok) {
    const error = new Error(
      body && "error" in body && body.error?.message
        ? body.error.message
        : "Administrator sign-in is required.",
    );
    error.name =
      body && "error" in body && body.error?.code
        ? body.error.code
        : "AUTH_REQUIRED";
    throw error;
  }

  if (!isAdminSessionResponse(body)) {
    const error = new Error(
      "Administrator session verification returned an invalid response.",
    );
    error.name = "INVALID_ADMIN_SESSION";
    throw error;
  }

  return body;
}
