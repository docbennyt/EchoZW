import { createSupabaseAdminClient } from "./supabase/adminClient.js";
import type { StaffRole } from "./supabase/auth.js";

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

export type StaffMember = {
  id: string;
  userId: string;
  email: string | null;
  displayName: string | null;
  role: StaffRole;
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

async function ensureInvitedAuthUser(email: string, displayName: string) {
  const existing = await findAuthUserByEmail(email);
  if (existing) return { userId: existing.id, invited: false };

  const { data, error } = await client().auth.admin.inviteUserByEmail(email, {
    data: { display_name: displayName, product: "CalenderZW" },
    redirectTo: `${publicOrigin()}/admin/login`,
  });
  if (error || !data.user) {
    throw new StaffApiError(
      "INVITE_FAILED",
      "Could not send the class rep invitation.",
      502,
      error,
    );
  }
  return { userId: data.user.id, invited: true };
}

export async function listStaffMembers() {
  const admin = client();
  const staffRows = await expectData<JsonRecord[]>(
    admin
      .from("staff_users")
      .select(
        "id, user_id, email, display_name, role, active, invited_at, last_invited_at, accepted_at, disabled_at",
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
  actorId: string;
  email: string;
  displayName: string;
  timetableId: string;
}) {
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
  const staff = await expectData<JsonRecord>(
    admin
      .from("staff_users")
      .upsert(
        {
          user_id: authUser.userId,
          email,
          display_name: displayName,
          role: "class_rep",
          active: true,
          invited_at: now,
          last_invited_at: now,
          disabled_at: null,
          created_by: input.actorId,
          updated_at: now,
        },
        { onConflict: "user_id" },
      )
      .select("id, user_id")
      .single(),
    "Could not save the class rep staff record.",
  );

  const assignment = await assignClassRep({
    actorId: input.actorId,
    staffUserId: String(staff?.id),
    timetableId: input.timetableId,
    auditAction: "class_rep.invited",
  });

  await audit({
    actorId: input.actorId,
    action: "class_rep.invite_email_sent",
    entityType: "staff_user",
    entityId: String(staff?.id),
    metadata: { invited: authUser.invited, assignmentId: assignment.id },
  });

  return { staffUserId: String(staff?.id), assignmentId: assignment.id };
}

export async function resendClassRepInvite(input: {
  actorId: string;
  staffUserId: string;
}) {
  const admin = client();
  const staff = await expectData<JsonRecord>(
    admin
      .from("staff_users")
      .select("id, email, display_name, role, active")
      .eq("id", input.staffUserId)
      .maybeSingle(),
    "Could not load the class rep.",
  );
  if (!staff || staff.role !== "class_rep" || !staff.email) {
    throw new StaffApiError("NOT_FOUND", "Class rep not found.", 404);
  }
  const { error } = await admin.auth.admin.inviteUserByEmail(
    String(staff.email),
    {
      data: { display_name: staff.display_name ?? "", product: "CalenderZW" },
      redirectTo: `${publicOrigin()}/admin/login`,
    },
  );
  if (error) {
    throw new StaffApiError(
      "INVITE_FAILED",
      "Could not resend the class rep invitation.",
      502,
      error,
    );
  }
  await expectData(
    admin
      .from("staff_users")
      .update({ last_invited_at: new Date().toISOString() })
      .eq("id", input.staffUserId)
      .select("id")
      .single(),
    "Could not update invitation timestamp.",
  );
  await audit({
    actorId: input.actorId,
    action: "class_rep.invite_resent",
    entityType: "staff_user",
    entityId: input.staffUserId,
  });
}

export async function assignClassRep(input: {
  actorId: string;
  staffUserId: string;
  timetableId: string;
  auditAction?: string;
}) {
  const now = new Date().toISOString();
  const admin = client();
  await expectData(
    admin
      .from("class_rep_assignments")
      .update({ active: false, revoked_at: now, revoked_by: input.actorId })
      .eq("staff_user_id", input.staffUserId)
      .eq("active", true)
      .select("id"),
    "Could not revoke previous class rep assignments.",
  );
  const row = await expectData<JsonRecord>(
    admin
      .from("class_rep_assignments")
      .insert({
        staff_user_id: input.staffUserId,
        timetable_id: input.timetableId,
        active: true,
        created_by: input.actorId,
      })
      .select("id")
      .single(),
    "Could not assign the class rep.",
  );
  await audit({
    actorId: input.actorId,
    action: input.auditAction ?? "class_rep.assigned",
    entityType: "class_rep_assignment",
    entityId: String(row?.id),
    metadata: {
      staffUserId: input.staffUserId,
      timetableId: input.timetableId,
    },
  });
  return { id: String(row?.id) };
}

export async function revokeClassRepAssignment(input: {
  actorId: string;
  assignmentId: string;
}) {
  await expectData(
    client()
      .from("class_rep_assignments")
      .update({
        active: false,
        revoked_at: new Date().toISOString(),
        revoked_by: input.actorId,
      })
      .eq("id", input.assignmentId)
      .select("id")
      .single(),
    "Could not revoke the class rep assignment.",
  );
  await audit({
    actorId: input.actorId,
    action: "class_rep.assignment_revoked",
    entityType: "class_rep_assignment",
    entityId: input.assignmentId,
  });
}

async function activeSuperadminCount() {
  const rows = await expectData<JsonRecord[]>(
    client()
      .from("staff_users")
      .select("id")
      .eq("role", "superadmin")
      .eq("active", true),
    "Could not verify superadmin safety.",
  );
  return rows?.length ?? 0;
}

export async function setStaffActive(input: {
  actorId: string;
  staffUserId: string;
  active: boolean;
}) {
  const admin = client();
  const staff = await expectData<JsonRecord>(
    admin
      .from("staff_users")
      .select("id, role, active")
      .eq("id", input.staffUserId)
      .maybeSingle(),
    "Could not load staff member.",
  );
  if (!staff)
    throw new StaffApiError("NOT_FOUND", "Staff member not found.", 404);
  if (
    staff.role === "superadmin" &&
    staff.active === true &&
    input.active === false &&
    (await activeSuperadminCount()) <= 1
  ) {
    throw new StaffApiError(
      "LAST_SUPERADMIN",
      "At least one active superadmin must remain.",
      409,
    );
  }

  await expectData(
    admin
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
    actorId: input.actorId,
    action: input.active ? "staff.reactivated" : "staff.disabled",
    entityType: "staff_user",
    entityId: input.staffUserId,
  });
}
