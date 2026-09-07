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

export function setStaffRepositoryEnv(env: NodeJS.ProcessEnv) {
  repositoryEnv = env;
}

function client() {
  return createSupabaseAdminClient(repositoryEnv ?? process.env);
}

export function staffMutationActor(context: StaffAuthContext): StaffMutationActor {
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
  return (
    repositoryEnv?.PUBLIC_SITE_URL ??
    repositoryEnv?.VITE_PUBLIC_SITE_URL ??
    process.env.PUBLIC_SITE_URL ??
    process.env.VITE_PUBLIC_SITE_URL ??
    "https://calender.aido.co.zw"
  ).replace(/\/$/, "");
}

function staffSetupRedirect() {
  return `${publicOrigin()}/account/update-password`;
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

async function assertFounder(actor: StaffMutationActor, action: string, targetId?: string) {
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
  return null;
}

async function sendStaffSetupEmail(email: string) {
  const { error } = await client().auth.resetPasswordForEmail(email, {
    redirectTo: staffSetupRedirect(),
  });
  if (error) {
    throw new StaffApiError(
      "INVITE_FAILED",
      "Could not send the staff setup email.",
      502,
      error,
    );
  }
}

async function ensureInvitedAuthUser(email: string, displayName: string) {
  const existing = await findAuthUserByEmail(email);
  if (existing) {
    await sendStaffSetupEmail(email);
    return { userId: existing.id, invited: false, setupEmailSent: true };
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
  return { userId: data.user.id, invited: true, setupEmailSent: true };
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

async function revokeActiveAssignments(actorId: string, staffUserId: string) {
  const now = new Date().toISOString();
  await expectData(
    client()
      .from("class_rep_assignments")
      .update({ active: false, revoked_at: now })
      .eq("staff_user_id", staffUserId)
      .eq("active", true)
      .select("id"),
    "Could not revoke previous Class Rep assignments.",
  );
  await audit({
    actorId,
    action: "class_rep.assignments_revoked_for_role_change",
    entityType: "staff_user",
    entityId: staffUserId,
  });
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

  const authUser = await ensureInvitedAuthUser(email, displayName);
  const now = new Date().toISOString();
  const admin = client();
  const existing = await getStaffRecordByUserId(authUser.userId);

  if (existing && existing.role !== "class_rep") {
    await auditRejected({
      actor: input.actor,
      action: "staff.role_change_rejected",
      targetId: String(existing.id),
      reason: "class_rep_invite_cannot_demote_privileged_staff",
    });
    throw new StaffApiError(
      existing.is_founder ? "FOUNDER_PROTECTED" : "ROLE_CHANGE_REQUIRED",
      existing.is_founder
        ? "Founder authority cannot be changed through a Class Rep invitation."
        : "Use the founder role controls before assigning this staff member as a Class Rep.",
      409,
    );
  }

  const staff = existing
    ? await expectData<JsonRecord>(
        admin
          .from("staff_users")
          .update({
            email,
            display_name: displayName,
            active: true,
            last_invited_at: now,
            disabled_at: null,
            updated_at: now,
          })
          .eq("id", String(existing.id))
          .select("id, user_id")
          .single(),
        "Could not update the Class Rep staff record.",
      )
    : await expectData<JsonRecord>(
        admin
          .from("staff_users")
          .insert({
            user_id: authUser.userId,
            email,
            display_name: displayName,
            role: "class_rep",
            is_founder: false,
            active: true,
            invited_at: now,
            last_invited_at: now,
            disabled_at: null,
            created_by: input.actor.userId,
            updated_at: now,
          })
          .select("id, user_id")
          .single(),
        "Could not save the Class Rep staff record.",
      );

  const assignment = await assignClassRep({
    actor: input.actor,
    staffUserId: String(staff?.id),
    timetableId: input.timetableId,
    auditAction: "class_rep.invited",
  });

  await audit({
    actorId: input.actor.userId,
    action: "class_rep.invite_email_sent",
    entityType: "staff_user",
    entityId: String(staff?.id),
    metadata: {
      invited: authUser.invited,
      setupEmailSent: authUser.setupEmailSent,
      assignmentId: assignment.id,
    },
  });

  return { staffUserId: String(staff?.id), assignmentId: assignment.id };
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

  const authUser = await ensureInvitedAuthUser(email, displayName);
  const existing = await getStaffRecordByUserId(authUser.userId);
  if (existing?.is_founder) {
    throw new StaffApiError(
      "FOUNDER_PROTECTED",
      "Founder authority cannot be changed through an Admin invitation.",
      409,
    );
  }

  const now = new Date().toISOString();
  const admin = client();
  let staff: JsonRecord | null;
  if (existing) {
    if (existing.role === "class_rep") {
      await revokeActiveAssignments(input.actor.userId, String(existing.id));
    }
    staff = await expectData<JsonRecord>(
      admin
        .from("staff_users")
        .update({
          email,
          display_name: displayName,
          role: "admin",
          active: true,
          disabled_at: null,
          last_invited_at: now,
          updated_at: now,
        })
        .eq("id", String(existing.id))
        .select("id, user_id")
        .single(),
      "Could not grant Admin access.",
    );
  } else {
    staff = await expectData<JsonRecord>(
      admin
        .from("staff_users")
        .insert({
          user_id: authUser.userId,
          email,
          display_name: displayName,
          role: "admin",
          is_founder: false,
          active: true,
          invited_at: now,
          last_invited_at: now,
          disabled_at: null,
          created_by: input.actor.userId,
          updated_at: now,
        })
        .select("id, user_id")
        .single(),
      "Could not save the Admin staff record.",
    );
  }

  await audit({
    actorId: input.actor.userId,
    action: existing?.role === "admin" ? "admin.invite_resent" : "admin.role_granted",
    entityType: "staff_user",
    entityId: String(staff?.id),
    metadata: {
      invited: authUser.invited,
      setupEmailSent: authUser.setupEmailSent,
      existingAuthUser: !authUser.invited,
    },
  });

  return { staffUserId: String(staff?.id) };
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

  await sendStaffSetupEmail(String(staff.email));
  await expectData(
    client()
      .from("staff_users")
      .update({ last_invited_at: new Date().toISOString() })
      .eq("id", input.staffUserId)
      .select("id")
      .single(),
    "Could not update invitation timestamp.",
  );
  await audit({
    actorId: input.actor.userId,
    action: staff.role === "admin" ? "admin.invite_resent" : "class_rep.invite_resent",
    entityType: "staff_user",
    entityId: input.staffUserId,
  });
}

export async function assignClassRep(input: {
  actor: StaffMutationActor;
  staffUserId: string;
  timetableId: string;
  auditAction?: string;
}) {
  assertCanManageClassReps(input.actor);
  const staff = await getStaffRecord(input.staffUserId);
  if (!staff || staff.role !== "class_rep" || staff.is_founder) {
    throw new StaffApiError("NOT_FOUND", "Class Rep not found.", 404);
  }

  const now = new Date().toISOString();
  const admin = client();
  await expectData(
    admin
      .from("class_rep_assignments")
      .update({ active: false, revoked_at: now })
      .eq("staff_user_id", input.staffUserId)
      .eq("active", true)
      .select("id"),
    "Could not revoke previous Class Rep assignments.",
  );
  const row = await expectData<JsonRecord>(
    admin
      .from("class_rep_assignments")
      .insert({
        staff_user_id: input.staffUserId,
        timetable_id: input.timetableId,
        active: true,
        created_by: input.actor.userId,
      })
      .select("id")
      .single(),
    "Could not assign the Class Rep.",
  );
  await audit({
    actorId: input.actor.userId,
    action: input.auditAction ?? "class_rep.assigned",
    entityType: "class_rep_assignment",
    entityId: String(row?.id),
    metadata: {
      staffUserId: input.staffUserId,
      timetableId: input.timetableId,
      actorRole: input.actor.role,
    },
  });
  return { id: String(row?.id) };
}

export async function revokeClassRepAssignment(input: {
  actor: StaffMutationActor;
  assignmentId: string;
}) {
  assertCanManageClassReps(input.actor);
  await expectData(
    client()
      .from("class_rep_assignments")
      .update({
        active: false,
        revoked_at: new Date().toISOString(),
      })
      .eq("id", input.assignmentId)
      .select("id")
      .single(),
    "Could not revoke the Class Rep assignment.",
  );
  await audit({
    actorId: input.actor.userId,
    action: "class_rep.assignment_revoked",
    entityType: "class_rep_assignment",
    entityId: input.assignmentId,
    metadata: { actorRole: input.actor.role },
  });
}

export async function setStaffActive(input: {
  actor: StaffMutationActor;
  staffUserId: string;
  active: boolean;
}) {
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
    await assertFounder(input.actor, "change_admin_active_state", input.staffUserId);
  } else {
    assertCanManageClassReps(input.actor);
  }

  await expectData(
    client()
      .from("staff_users")
      .update({
        active: input.active,
        disabled_at: input.active ? null : new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.staffUserId)
      .select("id")
      .single(),
    "Could not update staff access.",
  );
  await audit({
    actorId: input.actor.userId,
    action:
      staff.role === "admin"
        ? input.active
          ? "admin.reactivated"
          : "admin.deactivated"
        : input.active
          ? "class_rep.reactivated"
          : "class_rep.deactivated",
    entityType: "staff_user",
    entityId: input.staffUserId,
  });
}

export async function setStaffRole(input: {
  actor: StaffMutationActor;
  staffUserId: string;
  role: "admin" | "class_rep";
}) {
  await assertFounder(input.actor, "change_staff_role", input.staffUserId);
  const staff = await getStaffRecord(input.staffUserId);
  if (!staff) {
    throw new StaffApiError("NOT_FOUND", "Staff member not found.", 404);
  }
  if (staff.is_founder || staff.role === "superadmin") {
    throw new StaffApiError(
      "FOUNDER_PROTECTED",
      "Founder authority cannot be demoted, replaced, or transferred.",
      403,
    );
  }
  if (staff.user_id === input.actor.userId) {
    throw new StaffApiError(
      "SELF_PRIVILEGE_CHANGE_FORBIDDEN",
      "You cannot change your own privileged role.",
      403,
    );
  }
  if (staff.role === input.role) return;

  if (input.role === "admin") {
    await revokeActiveAssignments(input.actor.userId, input.staffUserId);
  }

  const now = new Date().toISOString();
  await expectData(
    client()
      .from("staff_users")
      .update({
        role: input.role,
        active: input.role === "admin",
        disabled_at: input.role === "admin" ? null : now,
        updated_at: now,
      })
      .eq("id", input.staffUserId)
      .select("id")
      .single(),
    "Could not update staff role.",
  );

  await audit({
    actorId: input.actor.userId,
    action: input.role === "admin" ? "admin.role_granted" : "admin.role_revoked",
    entityType: "staff_user",
    entityId: input.staffUserId,
    metadata: {
      previousRole: String(staff.role),
      newRole: input.role,
      classRepRequiresAssignmentAfterDemotion: input.role === "class_rep",
    },
  });
}
