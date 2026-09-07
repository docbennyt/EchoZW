import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import type { StaffAuthContext } from "./supabase/auth.js";
import {
  assignClassRep,
  inviteAdmin,
  inviteClassRep,
  listStaffMembers,
  resendStaffInvite,
  revokeClassRepAssignment,
  setStaffActive,
  setStaffRole,
  staffMutationActor,
  StaffApiError,
} from "./staffRepository.js";

const inviteClassRepSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1),
  timetableId: z.string().uuid(),
});

const inviteAdminSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1),
});

const assignmentSchema = z.object({
  timetableId: z.string().uuid(),
});

const activeSchema = z.object({
  active: z.boolean(),
});

const roleSchema = z.object({
  role: z.enum(["admin", "class_rep"]),
});

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? (JSON.parse(raw) as unknown) : {};
}

function sendStaffError(res: ServerResponse, error: unknown) {
  if (error instanceof z.ZodError) {
    sendJson(res, 422, {
      error: {
        code: "VALIDATION_FAILED",
        message: "Check the highlighted fields.",
        details: error.flatten().fieldErrors,
      },
    });
    return;
  }
  if (error instanceof StaffApiError) {
    sendJson(res, error.status, {
      error: {
        code: error.code,
        message: error.message,
      },
    });
    return;
  }
  sendJson(res, 500, {
    error: {
      code: "INTERNAL_ERROR",
      message: "We could not complete that staff request.",
    },
  });
}

export async function handleStaffAdminApi(
  req: IncomingMessage,
  res: ServerResponse,
  context: StaffAuthContext,
) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const actor = staffMutationActor(context);

  try {
    if (req.method === "GET" && url.pathname === "/api/admin/staff") {
      sendJson(res, 200, { staff: await listStaffMembers() });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/admin/staff/invite") {
      const parsed = inviteClassRepSchema.parse(await readJson(req));
      sendJson(res, 201, {
        invite: await inviteClassRep({ actor, ...parsed }),
      });
      return true;
    }

    if (
      req.method === "POST" &&
      url.pathname === "/api/admin/staff/invite-admin"
    ) {
      const parsed = inviteAdminSchema.parse(await readJson(req));
      sendJson(res, 201, {
        invite: await inviteAdmin({ actor, ...parsed }),
      });
      return true;
    }

    const roleMatch = url.pathname.match(
      /^\/api\/admin\/staff\/([^/]+)\/role$/,
    );
    if (req.method === "PATCH" && roleMatch) {
      const parsed = roleSchema.parse(await readJson(req));
      await setStaffRole({
        actor,
        staffUserId: decodeURIComponent(roleMatch[1]),
        role: parsed.role,
      });
      sendJson(res, 200, { ok: true });
      return true;
    }

    const staffMatch = url.pathname.match(/^\/api\/admin\/staff\/([^/]+)$/);
    if (req.method === "PATCH" && staffMatch) {
      const parsed = activeSchema.parse(await readJson(req));
      await setStaffActive({
        actor,
        staffUserId: decodeURIComponent(staffMatch[1]),
        active: parsed.active,
      });
      sendJson(res, 200, { ok: true });
      return true;
    }

    const resendMatch = url.pathname.match(
      /^\/api\/admin\/staff\/([^/]+)\/resend-invite$/,
    );
    if (req.method === "POST" && resendMatch) {
      await resendStaffInvite({
        actor,
        staffUserId: decodeURIComponent(resendMatch[1]),
      });
      sendJson(res, 200, { ok: true });
      return true;
    }

    const assignmentMatch = url.pathname.match(
      /^\/api\/admin\/staff\/([^/]+)\/assignments$/,
    );
    if (req.method === "POST" && assignmentMatch) {
      const parsed = assignmentSchema.parse(await readJson(req));
      sendJson(res, 201, {
        assignment: await assignClassRep({
          actor,
          staffUserId: decodeURIComponent(assignmentMatch[1]),
          timetableId: parsed.timetableId,
        }),
      });
      return true;
    }

    const revokeMatch = url.pathname.match(
      /^\/api\/admin\/staff\/assignments\/([^/]+)$/,
    );
    if (req.method === "DELETE" && revokeMatch) {
      await revokeClassRepAssignment({
        actor,
        assignmentId: decodeURIComponent(revokeMatch[1]),
      });
      sendJson(res, 200, { ok: true });
      return true;
    }
  } catch (error) {
    sendStaffError(res, error);
    return true;
  }
  return false;
}
