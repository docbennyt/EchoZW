/* global Response, URL, TextDecoder */
import { Buffer } from "node:buffer";
import { Readable } from "node:stream";
import { handleStaffAdminApi } from "../server/staffAdminApi.ts";
import { withStaffRepositoryContext } from "../server/staffRepository.ts";
import {
  AdminAuthError,
  requireFounderSuperadmin,
  requireStaffManager,
} from "../server/supabase/auth.ts";
import { createSupabaseAdminClient } from "../server/supabase/adminClient.ts";
import { createSupabaseUserClient } from "../server/supabase/userClient.ts";

function json(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
  });
}

async function boundedBody(request) {
  const reader = request.body?.getReader();
  const chunks = [];
  let size = 0;
  try {
    if (reader) {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 16384) {
          await reader.cancel();
          return {
            error: json(
              {
                error: {
                  code: "BODY_TOO_LARGE",
                  message: "Request body is too large.",
                },
              },
              413,
            ),
          };
        }
        chunks.push(Buffer.from(value));
      }
    }
    const bytes = Buffer.concat(chunks);
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return { bytes };
  } catch {
    return {
      error: json(
        {
          error: {
            code: "VALIDATION_FAILED",
            message: "Invalid JSON request.",
          },
        },
        422,
      ),
    };
  } finally {
    reader?.releaseLock();
  }
}

function trustedInvitationOrigin(url, env) {
  if (!env.STAGING_ORIGIN) return undefined;
  try {
    const trusted = new URL(env.STAGING_ORIGIN);
    if (
      trusted.protocol === "https:" &&
      !trusted.username &&
      !trusted.password &&
      trusted.pathname === "/" &&
      !trusted.search &&
      !trusted.hash &&
      trusted.origin === url.origin
    )
      return trusted.origin;
  } catch {
    // Invalid staging configuration must never become an invitation redirect.
  }
  return undefined;
}

// Staff reads, schema, enrollment, membership and audit stay in the server handler.
export async function handleNativeStaffInvitation(request, env) {
  const url = new URL(request.url);
  const isStaffRead = url.pathname === "/api/admin/staff";
  const isAdminInvite = url.pathname === "/api/admin/staff/invite-admin";
  const isClassRepInvite = url.pathname === "/api/admin/staff/invite";
  const isRoleChange = /^\/api\/admin\/staff\/[^/]+\/role$/.test(url.pathname);
  const isActiveChange =
    !isStaffRead &&
    !isAdminInvite &&
    !isClassRepInvite &&
    /^\/api\/admin\/staff\/[^/]+$/.test(url.pathname);
  const isAssignment = /^\/api\/admin\/staff\/[^/]+\/assignments$/.test(
    url.pathname,
  );
  const isRevoke = /^\/api\/admin\/staff\/assignments\/[^/]+$/.test(
    url.pathname,
  );
  const isResend = /^\/api\/admin\/staff\/[^/]+\/resend-invite$/.test(
    url.pathname,
  );
  if (
    !isStaffRead &&
    !isAdminInvite &&
    !isClassRepInvite &&
    !isRoleChange &&
    !isActiveChange &&
    !isAssignment &&
    !isRevoke &&
    !isResend
  )
    return null;
  const allowedMethod = isStaffRead
    ? "GET"
    : isRevoke
      ? "DELETE"
      : isRoleChange || isActiveChange
        ? "PATCH"
        : "POST";
  if (request.method !== allowedMethod) {
    return json(
      { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } },
      405,
      { allow: allowedMethod },
    );
  }
  const origin = request.headers.get("origin");
  if (
    (origin !== null && origin !== url.origin) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  ) {
    return json(
      {
        error: {
          code: "ORIGIN_NOT_ALLOWED",
          message: isStaffRead
            ? "Cross-origin staff reads are not allowed."
            : "Cross-origin writes are not allowed.",
        },
      },
      403,
    );
  }
  try {
    const authRequest = {
      headers: {
        authorization: request.headers.get("authorization") ?? undefined,
      },
      method: request.method,
      url: url.pathname,
    };
    // Target-specific Admin/founder protections remain in the shared repository.
    const authorize =
      isAdminInvite || isRoleChange
        ? requireFounderSuperadmin
        : requireStaffManager;
    const actor = await authorize(authRequest, {
      createUserClient: (token) => createSupabaseUserClient(token, env),
      createAdminClient: () => createSupabaseAdminClient(env),
    });
    let chunks = [];
    if (
      isAdminInvite ||
      isClassRepInvite ||
      isRoleChange ||
      isActiveChange ||
      isAssignment
    ) {
      if (
        !/^application\/json(?:\s*;|\s*$)/i.test(
          request.headers.get("content-type") ?? "",
        )
      ) {
        return json(
          {
            error: {
              code: "UNSUPPORTED_MEDIA_TYPE",
              message: "Use application/json.",
            },
          },
          415,
        );
      }
      const body = await boundedBody(request);
      if (body.error) return body.error;
      chunks = [body.bytes];
    }
    const req = Object.assign(Readable.from(chunks), authRequest);
    let response;
    let status = 500;
    const res = {
      writeHead(code) {
        status = code;
      },
      end(raw) {
        response = json(JSON.parse(raw), status);
      },
    };
    await withStaffRepositoryContext(
      { env, invitationOrigin: trustedInvitationOrigin(url, env) },
      () => handleStaffAdminApi(req, res, actor),
    );
    return response;
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return json(
        { error: { code: error.code, message: error.message } },
        error.status,
      );
    }
    return json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "We could not complete that staff request.",
        },
      },
      500,
    );
  }
}
