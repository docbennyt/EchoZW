import { AsyncLocalStorage } from "node:async_hooks";
import { createSupabaseAdminClient } from "./supabase/adminClient.js";
import type {
  StaffAuthContext,
  StaffPermissions,
  StaffRole,
} from "./supabase/auth.js";

type JsonRecord = Record<string, unknown>;
type SupabaseErrorLike = { code?: string; message?: string };

export class StaffApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export type StaffMutationActor = {
  userId: string;
  staffUserId: string;
  role: StaffRole;
  isFounder: boolean;
  permissions: StaffPermissions;
};

export type StaffEnrollmentOutcome =
  | "invited_new_user"
  | "invite_resent_pending_user"
  | "access_granted_existing_user";

type StaffAuthEnrollment = {
  userId: string;
  enrollment: StaffEnrollmentOutcome;
  invitationSent: boolean;
  existingAuthUser: boolean;
};

export type StaffMember = {
  id: string;
  userId: string;
  email: string | null;
  displayName: string | null;
  role: StaffRole;
  isFounder: boolean;
  active: boolean;
  invitedAt: string | null;
  lastInvitedAt: string | null;
  acceptedAt: string | null;
  disabledAt: string | null;
  assignments: StaffAssignmentSummary[];
};

export type StaffAssignmentSummary = {
  id: string;
  timetableId: string;
  active: boolean;
  revokedAt: string | null;
  publicSlug: string;
  institutionName: string;
  programmeName: string;
  classGroupLabel: string;
  academicPeriodName: string;
};

let repositoryEnv: NodeJS.ProcessEnv | undefined;
const requestContext = new AsyncLocalStorage<{
  env: NodeJS.ProcessEnv;
  invitationOrigin?: string;
}>();

export function withStaffRepositoryContext<T>(
  context: { env: NodeJS.ProcessEnv; invitationOrigin?: string },
  operation: () => T,
): T {
  return requestContext.run(context, operation);
}

export function setStaffRepositoryEnv(env: NodeJS.ProcessEnv) {
  repositoryEnv = env;
}

function client() {
  return createSupabaseAdminClient(
    requestContext.getStore()?.env ?? repositoryEnv ?? process.env,
  );
}

export function staffMutationActor(
  context: StaffAuthContext,
): StaffMutationActor {
  return {
    userId: context.user.id,
    staffUserId: context.staff.id,
    role: context.staff.role,
    isFounder: context.staff.isFounder,
    permissions: context.permissions,
  };
}

function asSingle<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function safeEmail(value: string) {
  return value.trim().toLowerCase();
}

function publicOrigin() {
  const env = requestContext.getStore()?.env ?? repositoryEnv;
  return (
    env?.PUBLIC_APP_URL ??
    process.env.PUBLIC_APP_URL ??
    env?.VITE_PUBLIC_APP_URL ??
    process.env.VITE_PUBLIC_APP_URL ??
    env?.PUBLIC_SITE_URL ??
    process.env.PUBLIC_SITE_URL ??
    env?.VITE_PUBLIC_SITE_URL ??
    process.env.VITE_PUBLIC_SITE_URL ??
    "https://calender.aido.co.zw"
  ).replace(/\/$/, "");
}

function staffSetupRedirect() {
  return `${requestContext.getStore()?.invitationOrigin ?? publicOrigin()}/account/update-password`;
}

function mapAssignment(row: JsonRecord): StaffAssignmentSummary {
  const timetable = asSingle(
    row.timetables as JsonRecord | JsonRecord[] | null,
  );
  const institution = asSingle(
    timetable?.institutions as JsonRecord | JsonRecord[] | null,
  );
  const programme = asSingle(
    timetable?.programmes as JsonRecord | JsonRecord[] | null,
  );
  const cohort = asSingle(
    timetable?.cohorts as JsonRecord | JsonRecord[] | null,
  );
  const period = asSingle(
    timetable?.academic_periods as JsonRecord | JsonRecord[] | null,
  );
  return {
    id: String(row.id),
    timetableId: String(row.timetable_id),
    active: Boolean(row.active),
    revokedAt: row.revoked_at ? String(row.revoked_at) : null,
    publicSlug: timetable?.public_slug ? String(timetable.public_slug) : "",
    institutionName: institution?.name ? String(institution.name) : "",
    programmeName: programme?.name ? String(programme.name) : "",
    classGroupLabel: cohort?.label ? String(cohort.label) : "",
    academicPeriodName: period?.name ? String(period.name) : "",
  };
}

function mapStaff(row: JsonRecord, assignments: StaffAssignmentSummary[]) {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    email: row.email ? String(row.email) : null,
    displayName: row.display_name ? String(row.display_name) : null,
    role: row.role as StaffRole,
    isFounder: row.is_founder === true,
    active: Boolean(row.active),
    invitedAt: row.invited_at ? String(row.invited_at) : null,
    lastInvitedAt: row.last_invited_at ? String(row.last_invited_at) : null,
    acceptedAt: row.accepted_at ? String(row.accepted_at) : null,
    disabledAt: row.disabled_at ? String(row.disabled_at) : null,
    assignments,
  } satisfies StaffMember;
}

async function expectData<T>(
  query: PromiseLike<{ data: T | null; error: SupabaseErrorLike | null }>,
  message: string,
) {
  const { data, error } = await query;
  if (error)
    throw new StaffApiError("DATABASE_UNAVAILABLE", message, 503, error);
  return data;
}

async function audit(input: {
  actorId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: JsonRecord;
}) {
  const { error } = await client()
    .from("audit_logs")
    .insert({
      actor_id: input.actorId,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      metadata: input.metadata ?? {},
    });
  if (error) {
    throw new StaffApiError(
      "DATABASE_UNAVAILABLE",
      "Could not record the staff audit log.",
      503,
      error,
    );
  }
}

async function auditRejected(input: {
  actor: StaffMutationActor;
  action: string;
  targetId?: string;
  reason: string;
}) {
  try {
    await audit({
      actorId: input.actor.userId,
      action: input.action,
      entityType: "staff_user",
      entityId: input.targetId ?? null,
      metadata: { reason: input.reason, actorRole: input.actor.role },
    });
  } catch {
    // Authorization must still fail closed if the audit sink is unavailable.
    console.warn("CalenderZW staff authorization rejection audit unavailable.");
  }
}

function assertCanManageClassReps(actor: StaffMutationActor) {
  if (!actor.permissions.canManageClassReps) {
    throw new StaffApiError(
      "STAFF_MANAGER_REQUIRED",
      "Class Rep management access is required.",
      403,
    );
  }
}

async function assertFounder(
  actor: StaffMutationActor,
  action: string,
  targetId?: string,
) {
  if (
    actor.role !== "superadmin" ||
    !actor.isFounder ||
    !actor.permissions.canManageAdmins ||
    !actor.permissions.canManageFounderAuthority
  ) {
    await auditRejected({
      actor,
      action: "staff.privilege_escalation_rejected",
      targetId,
      reason: action,
    });
    throw new StaffApiError(
      "FOUNDER_REQUIRED",
      "Founder superadmin access is required for this staff change.",
      403,
    );
  }
}

async function findAuthUserByEmail(email: string) {
  const admin = client();
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) {
      throw new StaffApiError(
        "AUTH_ADMIN_UNAVAILABLE",
        "Could not check Supabase Auth users.",
        503,
        error,
      );
    }
    const user = data.users.find(
      (candidate) => candidate.email?.toLowerCase() === email,
    );
    if (user) return user;
    if (data.users.length < 1000) return null;
  }
  throw new StaffApiError(
    "AUTH_LOOKUP_INCOMPLETE",
    "Could not safely complete the staff account lookup.",
    503,
  );
}

function authUserIsConfirmed(user: {
  email_confirmed_at?: string | null;
  confirmed_at?: string | null;
}) {
  return Boolean(user.email_confirmed_at ?? user.confirmed_at);
}

async function staffLifecycle<T>(
  actor: StaffMutationActor,
  operation: string,
  input: JsonRecord,
): Promise<T> {
  const { data, error } = await client().rpc("czw_staff_lifecycle", {
    p_actor_user_id: actor.userId,
    p_operation: operation,
    p_input: input,
  });
  if (error || !data || typeof data !== "object") {
    throw new StaffApiError(
      "DATABASE_UNAVAILABLE",
      "Could not complete the staff lifecycle transaction.",
      503,
    );
  }
  const failure = (data as JsonRecord).error as { code?: string } | undefined;
  if (failure) {
    const errors: Record<string, [number, string]> = {
      STAFF_MANAGER_REQUIRED: [403, "Staff management access is required."],
      FOUNDER_REQUIRED: [
        403,
        "Founder superadmin access is required for this staff change.",
      ],
      FOUNDER_PROTECTED: [
        operation === "set_role" || operation === "set_active" ? 403 : 409,
        "Founder authority cannot be changed through staff controls.",
      ],
      ROLE_CHANGE_REQUIRED: [
        409,
        "Use the founder role controls before assigning privileged staff as a Class Rep.",
      ],
      SELF_PRIVILEGE_CHANGE_FORBIDDEN: [
        403,
        "You cannot change your own privileged role.",
      ],
      NOT_FOUND: [404, "Staff member or assignment not found."],
      TIMETABLE_NOT_FOUND: [404, "Timetable not found."],
      AUTH_IDENTITY_MISMATCH: [
        409,
        "The staff identity changed. Review the account before retrying.",
      ],
      INVITE_RATE_LIMITED: [
        429,
        "Wait at least 60 seconds before sending another staff invitation to this recipient.",
      ],
      INVITE_ACTOR_RATE_LIMITED: [
        429,
        "Staff invitation limit reached. Wait for the 10-minute sending window to reset.",
      ],
      VALIDATION_FAILED: [422, "Invalid staff lifecycle request."],
    };
    const code = failure.code ?? "";
    const [status, message] = errors[code] ?? [
      503,
      "Could not complete the staff lifecycle transaction.",
    ];
    throw new StaffApiError(
      errors[code] ? code : "DATABASE_UNAVAILABLE",
      message,
      status,
    );
  }
  return data as T;
}

async function validateTimetable(timetableId: string) {
  const timetable = await expectData<JsonRecord>(
    client()
      .from("timetables")
      .select("id")
      .eq("id", timetableId)
      .maybeSingle(),
    "Could not validate the Class Rep timetable.",
  );
  if (!timetable) {
    throw new StaffApiError("TIMETABLE_NOT_FOUND", "Timetable not found.", 404);
  }
}

async function sendStaffInvitation(
  email: string,
  displayName: string,
  actor: StaffMutationActor,
  role: "admin" | "class_rep",
  target: { userId?: string; staffUserId?: string; timetableId?: string } = {},
) {
  // The reservation commits before the provider call and is never refunded on failure.
  const reservation = await staffLifecycle<{ reserved: boolean }>(
    actor,
    "reserve_invite",
    { email, role, ...target },
  );
  if (reservation.reserved !== true) {
    throw new StaffApiError(
      "DATABASE_UNAVAILABLE",
      "Could not reserve the staff invitation.",
      503,
    );
  }
  const { data, error } = await client().auth.admin.inviteUserByEmail(email, {
    data: { display_name: displayName, product: "CalenderZW" },
    redirectTo: staffSetupRedirect(),
  });
  if (error || !data.user) {
    throw new StaffApiError(
      "INVITE_FAILED",
      "Could not send the staff invitation.",
      502,
      error,
    );
  }
  return data.user;
}

/**
 * Staff provisioning and password recovery are intentionally separate domains.
 * New or still-pending invitees receive Supabase invite semantics. Confirmed
 * users keep their existing credentials and only receive the new staff role.
 * Explicit user-initiated password recovery must never be introduced here.
 */
async function resolveStaffAuthEnrollment(
  email: string,
  displayName: string,
  actor: StaffMutationActor,
  role: "admin" | "class_rep",
  timetableId?: string,
): Promise<StaffAuthEnrollment> {
  const existing = await findAuthUserByEmail(email);
  if (existing) {
    const staff = await getStaffRecordByUserId(existing.id);
    if (
      staff?.is_founder ||
      (staff && role === "class_rep" && staff.role !== "class_rep")
    ) {
      if (!staff.is_founder) {
        await auditRejected({
          actor,
          action: "staff.role_change_rejected",
          targetId: String(staff.id),
          reason: "class_rep_invite_cannot_demote_privileged_staff",
        });
      }
      throw new StaffApiError(
        staff.is_founder ? "FOUNDER_PROTECTED" : "ROLE_CHANGE_REQUIRED",
        "Use the founder role controls before changing privileged staff.",
        409,
      );
    }
  }
  if (!existing) {
    const invited = await sendStaffInvitation(email, displayName, actor, role, {
      timetableId,
    });
    return {
      userId: invited.id,
      enrollment: "invited_new_user",
      invitationSent: true,
      existingAuthUser: false,
    };
  }

  if (authUserIsConfirmed(existing)) {
    return {
      userId: existing.id,
      enrollment: "access_granted_existing_user",
      invitationSent: false,
      existingAuthUser: true,
    };
  }

  if (existing.invited_at) {
    const reinvited = await sendStaffInvitation(
      email,
      displayName,
      actor,
      role,
      { userId: existing.id, timetableId },
    );
    if (reinvited.id !== existing.id) {
      throw new StaffApiError(
        "AUTH_IDENTITY_MISMATCH",
        "Could not safely resend the existing staff invitation.",
        409,
      );
    }
    return {
      userId: existing.id,
      enrollment: "invite_resent_pending_user",
      invitationSent: true,
      existingAuthUser: true,
    };
  }

  throw new StaffApiError(
    "ACCOUNT_CONFIRMATION_REQUIRED",
    "This email already has an unconfirmed CalenderZW account that was not created by a staff invitation. Ask the user to finish confirming that account, then grant staff access again.",
    409,
  );
}

async function getStaffRecord(staffUserId: string) {
  return expectData<JsonRecord>(
    client()
      .from("staff_users")
      .select(
        "id, user_id, email, display_name, role, is_founder, active, invited_at, last_invited_at, accepted_at, disabled_at",
      )
      .eq("id", staffUserId)
      .maybeSingle(),
    "Could not load staff member.",
  );
}

async function getStaffRecordByUserId(userId: string) {
  return expectData<JsonRecord>(
    client()
      .from("staff_users")
      .select("id, user_id, role, is_founder, active")
      .eq("user_id", userId)
      .maybeSingle(),
    "Could not load existing staff authorization.",
  );
}

export async function listStaffMembers() {
  const admin = client();
  const staffRows = await expectData<JsonRecord[]>(
    admin
      .from("staff_users")
      .select(
        "id, user_id, email, display_name, role, is_founder, active, invited_at, last_invited_at, accepted_at, disabled_at",
      )
      .order("created_at", { ascending: false }),
    "Could not load staff members.",
  );
  const staffIds = (staffRows ?? []).map((row) => String(row.id));
  const assignmentRows = staffIds.length
    ? await expectData<JsonRecord[]>(
        admin
          .from("class_rep_assignments")
          .select(
            "id, staff_user_id, timetable_id, active, revoked_at, timetables(id, public_slug, institutions(name), programmes(name), cohorts(label), academic_periods(name))",
          )
          .in("staff_user_id", staffIds)
          .order("created_at", { ascending: false }),
        "Could not load staff assignments.",
      )
    : [];

  const assignmentsByStaff = new Map<string, StaffAssignmentSummary[]>();
  for (const assignment of assignmentRows ?? []) {
    const staffUserId = String(assignment.staff_user_id);
    const existing = assignmentsByStaff.get(staffUserId) ?? [];
    existing.push(mapAssignment(assignment));
    assignmentsByStaff.set(staffUserId, existing);
  }

  return (staffRows ?? []).map((row) =>
    mapStaff(row, assignmentsByStaff.get(String(row.id)) ?? []),
  );
}

export async function inviteClassRep(input: {
  actor: StaffMutationActor;
  email: string;
  displayName: string;
  timetableId: string;
}) {
  assertCanManageClassReps(input.actor);
  const email = safeEmail(input.email);
  const displayName = input.displayName.trim();
  if (!email.includes("@")) {
    throw new StaffApiError("VALIDATION_FAILED", "Enter a valid email.", 422);
  }
  if (!displayName) {
    throw new StaffApiError("VALIDATION_FAILED", "Name is required.", 422);
  }
  await validateTimetable(input.timetableId);
  const enrollment = await resolveStaffAuthEnrollment(
    email,
    displayName,
    input.actor,
    "class_rep",
    input.timetableId,
  );
  return staffLifecycle<{
    staffUserId: string;
    assignmentId: string;
    enrollment: StaffEnrollmentOutcome;
  }>(input.actor, "enroll_class_rep", {
    email,
    displayName,
    timetableId: input.timetableId,
    ...enrollment,
  });
}

export async function inviteAdmin(input: {
  actor: StaffMutationActor;
  email: string;
  displayName: string;
}) {
  await assertFounder(input.actor, "invite_admin");
  const email = safeEmail(input.email);
  const displayName = input.displayName.trim();
  if (!email.includes("@")) {
    throw new StaffApiError("VALIDATION_FAILED", "Enter a valid email.", 422);
  }
  if (!displayName) {
    throw new StaffApiError("VALIDATION_FAILED", "Name is required.", 422);
  }
  const enrollment = await resolveStaffAuthEnrollment(
    email,
    displayName,
    input.actor,
    "admin",
  );
  return staffLifecycle<{
    staffUserId: string;
    enrollment: StaffEnrollmentOutcome;
  }>(input.actor, "enroll_admin", { email, displayName, ...enrollment });
}

export async function resendStaffInvite(input: {
  actor: StaffMutationActor;
  staffUserId: string;
}) {
  const staff = await getStaffRecord(input.staffUserId);
  if (!staff || !staff.email) {
    throw new StaffApiError("NOT_FOUND", "Staff member not found.", 404);
  }
  if (staff.is_founder) {
    throw new StaffApiError(
      "FOUNDER_PROTECTED",
      "Founder setup cannot be changed through staff invitation controls.",
      409,
    );
  }
  if (staff.role === "admin") {
    await assertFounder(input.actor, "resend_admin_invite", input.staffUserId);
  } else {
    assertCanManageClassReps(input.actor);
  }
  const email = safeEmail(String(staff.email));
  const authUser = await findAuthUserByEmail(email);
  if (!authUser || authUser.id !== String(staff.user_id)) {
    throw new StaffApiError(
      "AUTH_USER_NOT_FOUND",
      "The staff record no longer matches a Supabase Auth account. Review the account before resending access.",
      409,
    );
  }
  const target = { userId: authUser.id, staffUserId: input.staffUserId };
  if (authUserIsConfirmed(authUser)) {
    return staffLifecycle<{ enrollment: StaffEnrollmentOutcome }>(
      input.actor,
      "record_resend",
      {
        ...target,
        email,
        enrollment: "access_granted_existing_user",
        invitationSent: false,
      },
    );
  }
  if (!authUser.invited_at) {
    throw new StaffApiError(
      "ACCOUNT_CONFIRMATION_REQUIRED",
      "This staff email belongs to an unconfirmed account that was not created by a staff invitation. Ask the user to finish confirming that account first.",
      409,
    );
  }
  const reinvited = await sendStaffInvitation(
    email,
    staff.display_name ? String(staff.display_name) : "CalenderZW staff",
    input.actor,
    staff.role === "admin" ? "admin" : "class_rep",
    target,
  );
  if (reinvited.id !== authUser.id) {
    throw new StaffApiError(
      "AUTH_IDENTITY_MISMATCH",
      "Could not safely resend the existing staff invitation.",
      409,
    );
  }
  return staffLifecycle<{ enrollment: StaffEnrollmentOutcome }>(
    input.actor,
    "record_resend",
    {
      ...target,
      email,
      enrollment: "invite_resent_pending_user",
      invitationSent: true,
    },
  );
}

export async function assignClassRep(input: {
  actor: StaffMutationActor;
  staffUserId: string;
  timetableId: string;
  auditAction?: string;
}) {
  assertCanManageClassReps(input.actor);
  return staffLifecycle<{ id: string }>(input.actor, "assign", {
    staffUserId: input.staffUserId,
    timetableId: input.timetableId,
  });
}

export async function revokeClassRepAssignment(input: {
  actor: StaffMutationActor;
  assignmentId: string;
}) {
  assertCanManageClassReps(input.actor);
  await staffLifecycle(input.actor, "revoke", {
    assignmentId: input.assignmentId,
  });
}

export async function setStaffActive(input: {
  actor: StaffMutationActor;
  staffUserId: string;
  active: boolean;
}) {
  // Preserve context guards and rejection audits before the transaction rechecks roles.
  const staff = await getStaffRecord(input.staffUserId);
  if (!staff)
    throw new StaffApiError("NOT_FOUND", "Staff member not found.", 404);
  if (staff.is_founder) {
    await auditRejected({
      actor: input.actor,
      action: "staff.founder_change_rejected",
      targetId: input.staffUserId,
      reason: "founder_active_state_protected",
    });
    throw new StaffApiError(
      "FOUNDER_PROTECTED",
      "Founder access cannot be disabled or reactivated through staff controls.",
      403,
    );
  }
  if (staff.role === "admin") {
    await assertFounder(
      input.actor,
      "change_admin_active_state",
      input.staffUserId,
    );
  } else {
    assertCanManageClassReps(input.actor);
  }
  await staffLifecycle(input.actor, "set_active", {
    staffUserId: input.staffUserId,
    active: input.active,
  });
}

export async function setStaffRole(input: {
  actor: StaffMutationActor;
  staffUserId: string;
  role: "admin" | "class_rep";
}) {
  await assertFounder(input.actor, "change_staff_role", input.staffUserId);
  await staffLifecycle(input.actor, "set_role", {
    staffUserId: input.staffUserId,
    role: input.role,
  });
}
