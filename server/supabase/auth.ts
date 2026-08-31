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
};

export type StaffAuthContext = {
  user: AuthenticatedUser;
  staff: StaffUser;
  permissions: StaffPermissions;
  assignments: [];
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
  from: (table: "admin_users" | "staff_users" | "class_rep_assignments") => {
    select: (columns: string) => {
      eq: (column: string, value: string | boolean) => QueryEqBuilder;
    };
  };
};

type QueryEqBuilder = {
  eq: (column: string, value: string | boolean) => QueryEqBuilder;
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
};

type ClassRepAssignmentRow = {
  id?: string;
  active?: boolean;
};

type AdminLookupRow = AdminUserRow | StaffUserRow | ClassRepAssignmentRow;

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
): StaffAuthContext {
  return {
    user,
    staff,
    permissions: permissionsForRole(staff.role),
    assignments: [],
  };
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
    .select("id, user_id, role, active")
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
    return staffContext(user, {
      id: data.id,
      role: data.role,
    });
  }

  if (await lookupActiveLegacyAdmin(user, adminClient)) {
    return staffContext(user, {
      id: user.id,
      role: "superadmin",
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
