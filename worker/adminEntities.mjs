/* global Response, URL, TextDecoder */
import { Buffer } from "node:buffer";
import { Readable } from "node:stream";
import { handlePilotAdminApi } from "../server/pilotAdminApi.ts";
import {
  AdminAuthError,
  requireOperationalAdmin,
} from "../server/supabase/auth.ts";
import { createSupabaseAdminClient } from "../server/supabase/adminClient.ts";
import { createSupabaseUserClient } from "../server/supabase/userClient.ts";

const entityRoute =
  /^\/api\/admin\/(institutions|programmes|class-groups|academic-periods)(?:\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}))?$/;
function json(body, status, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extra,
    },
  });
}
async function boundedBody(request) {
  const reader = request.body?.getReader();
  const chunks = [];
  let size = 0;
  try {
    if (reader)
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

// Restrict this bridge to existing canonical CRUD; reads keep their native owner.
export async function handleNativeAdminEntities(request, env) {
  const url = new URL(request.url);
  const match = entityRoute.exec(url.pathname);
  if (!match || (!match[2] && request.method === "GET")) return null;
  const method = match[2] ? "PATCH" : "POST";
  if (request.method !== method)
    return json(
      { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } },
      405,
      { allow: method },
    );
  const origin = request.headers.get("origin");
  if (
    (origin !== null && origin !== url.origin) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    return json(
      {
        error: {
          code: "ORIGIN_NOT_ALLOWED",
          message: "Use the application origin.",
        },
      },
      403,
    );
  try {
    const authRequest = {
      headers: {
        authorization: request.headers.get("authorization") ?? undefined,
      },
      method: request.method,
      url: url.pathname,
    };
    const actor = await requireOperationalAdmin(authRequest, {
      createUserClient: (token) => createSupabaseUserClient(token, env),
      createAdminClient: () => createSupabaseAdminClient(env),
    });
    if (
      !/^application\/json(?:\s*;|\s*$)/i.test(
        request.headers.get("content-type") ?? "",
      )
    )
      return json(
        {
          error: {
            code: "UNSUPPORTED_MEDIA_TYPE",
            message: "Use application/json.",
          },
        },
        415,
      );
    const body = await boundedBody(request);
    if (body.error) return body.error;
    const req = Object.assign(Readable.from([body.bytes]), authRequest);
    let response;
    let status = 500;
    const res = {
      writeHead(code) {
        status = code;
      },
      end(raw) {
        const result = JSON.parse(raw);
        response = json(
          status >= 500
            ? {
                error: {
                  code:
                    result?.error?.code === "DATABASE_UNAVAILABLE"
                      ? "DATABASE_UNAVAILABLE"
                      : "INTERNAL_ERROR",
                  message:
                    "We could not complete that request. Please try again.",
                },
              }
            : result,
          status,
        );
      },
    };
    await handlePilotAdminApi(req, res, actor.user, env);
    return (
      response ??
      json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "We could not complete that request.",
          },
        },
        500,
      )
    );
  } catch (error) {
    if (error instanceof AdminAuthError)
      return json(
        { error: { code: error.code, message: error.message } },
        error.status,
      );
    return json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "We could not complete that request.",
        },
      },
      500,
    );
  }
}
