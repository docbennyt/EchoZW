/* global Headers, Response, URL, crypto, TextDecoder */
import { z } from "zod";
import { applyEditorMutation } from "../server/correctionsCore.ts";
import { listTimetableCorrections } from "../server/correctionsRepository.ts";
import { PilotApiError } from "../server/pilotRepository.ts";
import {
  AdminAuthError,
  requireTimetableEditor,
} from "../server/supabase/auth.ts";
import { createSupabaseAdminClient } from "../server/supabase/adminClient.ts";
import { createSupabaseUserClient } from "../server/supabase/userClient.ts";

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const routePattern = new RegExp(
  `^/api/admin/timetables/(${uuid})/(corrections|exceptions)(?:/(dedupe|${uuid}))?$`,
  "i",
);

function json(body, status = 200, extraHeaders = {}) {
  const headers = new Headers(extraHeaders);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  return new Response(JSON.stringify(body), { status, headers });
}

async function readJson(request) {
  if (
    !/^application\/json(?:\s*;|\s*$)/i.test(
      request.headers.get("content-type") ?? "",
    )
  ) {
    throw new PilotApiError(
      "UNSUPPORTED_MEDIA_TYPE",
      "Use application/json.",
      415,
    );
  }
  const reader = request.body?.getReader();
  const chunks = [];
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 16384) {
          await reader.cancel();
          throw new PilotApiError(
            "BODY_TOO_LARGE",
            "Request body is too large.",
            413,
          );
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new PilotApiError("VALIDATION_FAILED", "Invalid JSON request.", 422);
  }
}

export async function handleEditorMutations(request, env) {
  const url = new URL(request.url);
  const match = url.pathname.match(routePattern);
  if (!match) return null;
  const [, timetableId, rawCollection, target] = match;
  const collection = rawCollection.toLowerCase();
  const dedupe = target === "dedupe";
  const methods = target
    ? dedupe
      ? ["POST"]
      : ["PATCH", "DELETE", "POST"]
    : collection === "corrections"
      ? ["GET", "POST"]
      : ["POST"];
  if (!methods.includes(request.method)) {
    return json(
      { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } },
      405,
      { allow: methods.join(", ") },
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
          message: "Use the application origin.",
        },
      },
      403,
    );
  }
  try {
    const actor = await requireTimetableEditor(
      {
        headers: {
          authorization: request.headers.get("authorization") ?? undefined,
        },
      },
      timetableId,
      {
        createUserClient: (token) => createSupabaseUserClient(token, env),
        createAdminClient: () => createSupabaseAdminClient(env),
      },
    );
    if (request.method === "GET") {
      return json({
        corrections: await listTimetableCorrections(timetableId, env),
      });
    }
    const body =
      request.method === "DELETE" && !request.body
        ? {}
        : await readJson(request);
    const operation = dedupe
      ? "dedupe"
      : !target
        ? "create"
        : request.method === "PATCH"
          ? "edit"
          : request.method === "DELETE"
            ? "remove"
            : "undo";
    const key = request.headers.get("idempotency-key");
    const result = await applyEditorMutation(
      {
        timetableId,
        collection,
        operation,
        itemId: target,
        actor,
        body,
        mutationKey: key === null ? crypto.randomUUID() : key.trim(),
      },
      env,
    );
    return json(
      {
        ...result.body,
        // Durable propagation is owned by the parent integration, not this adapter.
        googleCalendarSync: {
          attempted: 0,
          succeeded: 0,
          failed: 0,
          skipped: true,
        },
      },
      result.created ? 201 : 200,
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return json(
        {
          error: {
            code: "VALIDATION_FAILED",
            message: "Check the highlighted fields.",
            details: error.flatten().fieldErrors,
          },
        },
        422,
      );
    }
    if (error instanceof AdminAuthError || error instanceof PilotApiError) {
      return json(
        { error: { code: error.code, message: error.message } },
        error.status,
      );
    }
    return json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "We could not complete that timetable correction.",
        },
      },
      500,
    );
  }
}
