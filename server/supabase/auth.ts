import type { IncomingMessage, ServerResponse } from "node:http";
import { createSupabaseAdminClient } from "./adminClient.js";
import { createSupabaseUserClient } from "./userClient.js";

export type AdminAuthErrorCode =
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "SUPERADMIN_REQUIRED"
  | "TIMETABLE_ACCESS_DENIED"
  | "AUTH_CONFIGURATION_ERROR"
  | "DATABASE_UNAVAILABLE";

export class AdminAuthError extends Error {
  constructor(
    public readonly code: AdminAuthErrorCode,
    message: string,
    public readonly status: 401 | 403 | 500 | 503,
  ) {
    super(message);
  }
}

export type AuthenticatedUser = {
  id: string;
  email: string | null;
};

export type StaffRole = "superadmin" | "class_rep";

export type StaffPermissions = {
  canManageStaff: boolean;
  canManageInstitutions: boolean;
  canManageProgrammes: boolean;
  canManageClassGroups: boolean;
  canManageAllTimetables: boolean;
  canEditAssignedTimetables: boolean;
  canPublishAssignedTimetables: boolean;
};

export type StaffUser = {
  id: string;
  role: StaffRole;
  displayName: string | null;
  email: string | null;
};

export type StaffAssignment = {
  id: string;
  timetableId: string;
  publicSlug: string;
  institutionName: string;
  programmeName: string;
  classGroupLabel: string;
  academicPeriodName: string;
};

export type StaffAuthContext = {
  user: AuthenticatedUser;
  staff: StaffUser;
  permissions: StaffPermissions;
  assignments: StaffAssignment[];
};

type SupabaseUserShape = {
  id: string;
  email?: string | null;
};

type UserLookupClient = {
  auth: {
    getUser: (token: string) => Promise<{
      data: { user: SupabaseUserShape | null };
      error: unknown;
    }>;
  };
};

type AdminLookupClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string | boolean) => QueryEqBuilder;
      in?: (column: string, values: string[]) => QueryEqBuilder;
      order?: (
        column: string,
        options?: { ascending?: boolean },
      ) => QueryEqBuilder;
    };
  };
};

type QueryEqBuilder = {
  eq: (column: string, value: string | boolean) => QueryEqBuilder;
  order?: (column: string, options?: { ascending?: boolean }) => QueryEqBuilder;
  maybeSingle: () => Promise<{
    data: AdminLookupRow | null;
    error: unknown;
  }>;
};

type AdminUserRow = {
  user_id?: string;
  active?: boolean;
};

type StaffUserRow = {
  id?: string;
  user_id?: string;
  role?: StaffRole;
  active?: boolean;
  display_name?: string | null;
  email?: string | null;
};

type ClassRepAssignmentRow = {
  id?: string;
  active?: boolean;
  timetable_id?: string;
  timetables?: JsonRecord | JsonRecord[] | null;
};

type AdminLookupRow = AdminUserRow | StaffUserRow | ClassRepAssignmentRow;
type JsonRecord = Record<string, unknown>;

function isStaffUserRow(
  value: AdminLookupRow | null,
): value is StaffUserRow & { id: string; role: StaffRole; active: boolean } {
  return (
    Boolean(value) &&
    typeof (value as StaffUserRow).id === "string" &&
    ((value as StaffUserRow).role === "superadmin" ||
      (value as StaffUserRow).role === "class_rep") &&
    typeof (value as StaffUserRow).active === "boolean"
  );
}

function isActiveLegacyAdminRow(
  value: AdminLookupRow | null,
): value is AdminUserRow {
  return Boolean(value) && (value as AdminUserRow).active === true;
}

function permissionsForRole(role: StaffRole): StaffPermissions {
  const isSuperadmin = role === "superadmin";
  return {
    canManageStaff: isSuperadmin,
    canManageInstitutions: isSuperadmin,
    canManageProgrammes: isSuperadmin,
    canManageClassGroups: isSuperadmin,
    canManageAllTimetables: isSuperadmin,
    canEditAssignedTimetables: isSuperadmin || role === "class_rep",
    canPublishAssignedTimetables: isSuperadmin || role === "class_rep",
  };
}

function staffContext(
  user: AuthenticatedUser,
  staff: StaffUser,
  assignments: StaffAssignment[] = [],
): StaffAuthContext {
  return {
    user,
    staff,
    permissions: permissionsForRole(staff.role),
    assignments,
  };
}

function asSingle<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function mapAssignment(row: AdminLookupRow): StaffAssignment | null {
  const assignment = row as ClassRepAssignmentRow;
  if (!assignment.id || !assignment.timetable_id) return null;
  const timetable = asSingle(assignment.timetables);
  if (!timetable) return null;
  const institution = asSingle(
    timetable.institutions as JsonRecord | JsonRecord[] | null,
  );
  const programme = asSingle(
    timetable.programmes as JsonRecord | JsonRecord[] | null,
  );
  const cohort = asSingle(
    timetable.cohorts as JsonRecord | JsonRecord[] | null,
  );
  const period = asSingle(
    timetable.academic_periods as JsonRecord | JsonRecord[] | null,
  );
  return {
    id: assignment.id,
    timetableId: assignment.timetable_id,
    publicSlug: timetable.public_slug ? String(timetable.public_slug) : "",
    institutionName: institution?.name ? String(institution.name) : "",
    programmeName: programme?.name ? String(programme.name) : "",
    classGroupLabel: cohort?.label ? String(cohort.label) : "",
    academicPeriodName: period?.name ? String(period.name) : "",
  };
}

async function listActiveAssignments(
  staffId: string,
  adminClient: AdminLookupClient,
) {
  const query = adminClient
    .from("class_rep_assignments")
    .select(
      "id, timetable_id, active, timetables(id, public_slug, institutions(name), programmes(name), cohorts(label), academic_periods(name))",
    )
    .eq("staff_user_id", staffId)
    .eq("active", true);
  const { data, error } = await (query as unknown as Promise<{
    data: AdminLookupRow[] | null;
    error: unknown;
  }>);
  if (error) {
    throw new AdminAuthError(
      "DATABASE_UNAVAILABLE",
      "CalenderZW staff assignments are temporarily unavailable.",
      503,
    );
  }
  return (data ?? [])
    .map((row) => mapAssignment(row))
    .filter((row): row is StaffAssignment => Boolean(row));
}

function createAdminLookupClient(deps: AuthDependencies): AdminLookupClient {
  try {
    return (
      deps.createAdminClient?.() ??
      (createSupabaseAdminClient() as unknown as AdminLookupClient)
    );
  } catch {
    throw new AdminAuthError(
      "AUTH_CONFIGURATION_ERROR",
      "CalenderZW staff authorization is temporarily unavailable.",
      500,
    );
  }
}

async function lookupActiveLegacyAdmin(
  user: AuthenticatedUser,
  adminClient: AdminLookupClient,
) {
  const { data, error } = await adminClient
    .from("admin_users")
    .select("user_id, active")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    throw new AdminAuthError(
      "DATABASE_UNAVAILABLE",
      "CalenderZW staff authorization is temporarily unavailable.",
      503,
    );
  }

  return isActiveLegacyAdminRow(data);
}

export type AuthDependencies = {
  createUserClient?: (accessToken: string) => UserLookupClient;
  createAdminClient?: () => AdminLookupClient;
};

function extractBearerToken(req: IncomingMessage) {
  const header = req.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) {
    throw new AdminAuthError(
      "AUTH_REQUIRED",
      "CalenderZW staff sign-in is required.",
      401,
    );
  }

  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  if (!match?.[1]) {
    throw new AdminAuthError(
      "AUTH_REQUIRED",
      "CalenderZW staff sign-in is required.",
      401,
    );
  }

  return match[1];
}

function normalizeUser(user: SupabaseUserShape): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email ?? null,
  };
}

export async function requireAuthenticatedUser(
  req: IncomingMessage,
  deps: AuthDependencies = {},
): Promise<AuthenticatedUser> {
  const token = extractBearerToken(req);
  let userClient: UserLookupClient;
  try {
    userClient =
      deps.createUserClient?.(token) ??
      (createSupabaseUserClient(token) as unknown as UserLookupClient);
  } catch {
    throw new AdminAuthError(
      "AUTH_CONFIGURATION_ERROR",
      "CalenderZW staff sign-in is temporarily unavailable.",
      500,
    );
  }

  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data.user) {
    throw new AdminAuthError(
      "AUTH_REQUIRED",
      "CalenderZW staff sign-in is required.",
      401,
    );
  }

  return normalizeUser(data.user);
}

export async function requireAdmin(
  req: IncomingMessage,
  deps: AuthDependencies = {},
): Promise<AuthenticatedUser> {
  const context = await requireSuperadmin(req, deps);
  return context.user;
}

export async function requireStaffUser(
  req: IncomingMessage,
  deps: AuthDependencies = {},
): Promise<StaffAuthContext> {
  const user = await requireAuthenticatedUser(req, deps);
  const adminClient = createAdminLookupClient(deps);

  const { data, error } = await adminClient
    .from("staff_users")
    .select("id, user_id, role, active, display_name, email")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    throw new AdminAuthError(
      "DATABASE_UNAVAILABLE",
      "CalenderZW staff authorization is temporarily unavailable.",
      503,
    );
  }

  if (isStaffUserRow(data)) {
    if (!data.active) {
      throw new AdminAuthError(
        "FORBIDDEN",
        "This account does not have active CalenderZW staff access.",
        403,
      );
    }
    return staffContext(
      user,
      {
        id: data.id,
        role: data.role,
        displayName: data.display_name ?? null,
        email: data.email ?? user.email,
      },
      await listActiveAssignments(data.id, adminClient),
    );
  }

  if (await lookupActiveLegacyAdmin(user, adminClient)) {
    return staffContext(user, {
      id: user.id,
      role: "superadmin",
      displayName: null,
      email: user.email,
    });
  }

  throw new AdminAuthError(
    "FORBIDDEN",
    "This account does not have CalenderZW staff access.",
    403,
  );
}

export async function requireSuperadmin(
  req: IncomingMessage,
  deps: AuthDependencies = {},
): Promise<StaffAuthContext> {
  const context = await requireStaffUser(req, deps);
  if (context.staff.role !== "superadmin") {
    throw new AdminAuthError(
      "SUPERADMIN_REQUIRED",
      "Superadmin access is required.",
      403,
    );
  }
  return context;
}

export async function requireTimetableEditor(
  req: IncomingMessage,
  timetableId: string,
  deps: AuthDependencies = {},
): Promise<StaffAuthContext> {
  const context = await requireStaffUser(req, deps);
  if (context.permissions.canManageAllTimetables) return context;

  const adminClient = createAdminLookupClient(deps);
  const { data, error } = await adminClient
    .from("class_rep_assignments")
    .select("id, active")
    .eq("staff_user_id", context.staff.id)
    .eq("timetable_id", timetableId)
    .eq("active", true)
    .maybeSingle();

  if (error) {
    throw new AdminAuthError(
      "DATABASE_UNAVAILABLE",
      "CalenderZW timetable authorization is temporarily unavailable.",
      503,
    );
  }

  if (!data?.active) {
    throw new AdminAuthError(
      "TIMETABLE_ACCESS_DENIED",
      "You do not have access to this timetable.",
      403,
    );
  }

  return context;
}

export function sendAdminAuthError(res: ServerResponse, error: unknown) {
  const authError =
    error instanceof AdminAuthError
      ? error
      : new AdminAuthError(
          "DATABASE_UNAVAILABLE",
          "Administrator authorization is temporarily unavailable.",
          503,
        );

  res.writeHead(authError.status, {
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(
    JSON.stringify({
      error: {
        code: authError.code,
        message: authError.message,
      },
    }),
  );
}
