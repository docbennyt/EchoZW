/* global Response, URL */
import { z } from "zod";
import { recoverGoogleCredentialEncryption } from "../server/googleCredentialRecovery.ts";
import {
  AdminAuthError,
  requireOperationalAdmin,
} from "../server/supabase/auth.ts";
import { createSupabaseAdminClient } from "../server/supabase/adminClient.ts";
import { createSupabaseUserClient } from "../server/supabase/userClient.ts";
import { PilotApiError } from "../server/pilotRepository.ts";

const operationSchema = z
  .object({ mode: z.enum(["compatibility", "migrate"]) })
  .strict();

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

export async function handleGoogleCredentialRecovery(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== "/api/admin/google-credential-recovery") return null;
  if (request.method !== "POST")
    return json({ error: { code: "METHOD_NOT_ALLOWED" } }, 405, {
      allow: "POST",
    });
  if (
    request.headers.get("origin") !== url.origin ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    return json({ error: { code: "ORIGIN_NOT_ALLOWED" } }, 403);

  try {
    await requireOperationalAdmin(
      {
        headers: {
          authorization: request.headers.get("authorization") ?? undefined,
        },
      },
      {
        createUserClient: (token) => createSupabaseUserClient(token, env),
        createAdminClient: () => createSupabaseAdminClient(env),
      },
    );
    const contentType = request.headers.get("content-type") ?? "";
    if (!/^application\/json(?:\s*;|\s*$)/i.test(contentType))
      return json({ error: { code: "UNSUPPORTED_MEDIA_TYPE" } }, 415);
    const body = operationSchema.parse(await request.json());
    return json({
      credentialRecovery: await recoverGoogleCredentialEncryption(
        body.mode,
        env,
      ),
    });
  } catch (error) {
    if (error instanceof AdminAuthError)
      return json(
        { error: { code: error.code, message: error.message } },
        error.status,
      );
    if (error instanceof z.ZodError)
      return json({ error: { code: "VALIDATION_FAILED" } }, 422);
    if (error instanceof PilotApiError)
      return json(
        { error: { code: error.code, message: error.message } },
        error.status,
      );
    return json({ error: { code: "GOOGLE_CREDENTIAL_RECOVERY_FAILED" } }, 500);
  }
}
