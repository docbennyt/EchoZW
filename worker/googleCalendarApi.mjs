/* global Headers, Response, URL, TextDecoder */

import { z } from "zod";
import { isAnalyticsUuid } from "../src/domain/analytics.ts";
import { getPublicAppUrl } from "../src/domain/publicUrl.ts";
import {
  beginGoogleCalendarConnection,
  checkGoogleCredentialCompatibility,
  completeGoogleCalendarConnection,
  disconnectGoogleCalendar,
  getPublicGoogleCalendarStatus,
  previewGoogleSubscriptionSync,
} from "../server/googleCalendarSync.ts";
import {
  getCalendarSubscriptionById,
  PilotApiError,
} from "../server/pilotRepository.ts";
import {
  AdminAuthError,
  requireOperationalAdmin,
} from "../server/supabase/auth.ts";
import { createSupabaseAdminClient } from "../server/supabase/adminClient.ts";
import { createSupabaseUserClient } from "../server/supabase/userClient.ts";
import {
  googleCanaryScope,
  googleRecoveryScope,
  googleSubscriptionAllowed,
} from "../server/googleDeliveryPolicy.ts";

const disconnectSchema = z
  .object({
    subscriptionId: z.string().uuid(),
    deleteCreatedCalendar: z.boolean().optional().default(false),
  })
  .strict();
const syncSchema = z
  .object({
    subscriptionId: z.string().uuid(),
    dryRun: z.boolean(),
    credentialCheckOnly: z.boolean().optional().default(false),
  })
  .strict()
  .refine((input) => !input.credentialCheckOnly || input.dryRun);

function respond(body, status = 200, extra = {}) {
  const headers = new Headers({
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    ...extra,
  });
  if (body !== null)
    headers.set("content-type", "application/json; charset=utf-8");
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers,
  });
}

function redirect(location) {
  return respond(null, 302, { location });
}

function sessionOwner(request) {
  const header = request.headers.get("x-calenderzw-anonymous-id");
  if (isAnalyticsUuid(header)) return header;
  const cookie = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("calenderzw_anon_session="))
    ?.slice("calenderzw_anon_session=".length);
  return isAnalyticsUuid(cookie) ? cookie : null;
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

function validate(schema, value) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new PilotApiError(
      "VALIDATION_FAILED",
      "Choose a valid subscription and explicit options.",
      422,
    );
  }
  return parsed.data;
}

async function targetedSync(request, env, timetableId, options) {
  await requireOperationalAdmin(
    {
      headers: {
        authorization: request.headers.get("authorization") ?? undefined,
      },
      method: request.method,
      url: new URL(request.url).pathname,
    },
    {
      createUserClient: (token) => createSupabaseUserClient(token, env),
      createAdminClient: () => createSupabaseAdminClient(env),
    },
  );
  const input = validate(syncSchema, await readJson(request));
  const subscription = await getCalendarSubscriptionById(
    input.subscriptionId,
    env,
  );
  if (!subscription?.id) {
    throw new PilotApiError(
      "SUBSCRIPTION_NOT_FOUND",
      "Google Calendar setup not found.",
      404,
    );
  }
  if (subscription.provider !== "google_api") {
    throw new PilotApiError(
      "SUBSCRIPTION_PROVIDER_INVALID",
      "This subscription is not a Google Calendar connection.",
      400,
    );
  }
  if (String(subscription.timetable_id) !== timetableId) {
    throw new PilotApiError(
      "SUBSCRIPTION_TIMETABLE_MISMATCH",
      "This Google Calendar connection does not belong to the requested timetable.",
      403,
    );
  }
  if (subscription.revoked_at || subscription.status === "disconnected") {
    throw new PilotApiError(
      "SUBSCRIPTION_DISCONNECTED",
      "This Google Calendar connection is disconnected and must be reconnected.",
      409,
    );
  }
  if (input.credentialCheckOnly) {
    return respond({
      googleCalendarSync: await checkGoogleCredentialCompatibility(
        input.subscriptionId,
        env,
      ),
    });
  }
  if (input.dryRun) {
    return respond({
      googleCalendarSync: await previewGoogleSubscriptionSync(
        input.subscriptionId,
        env,
      ),
    });
  }
  if (
    !options.deliveryEnabled ||
    !googleSubscriptionAllowed(env, subscription) ||
    typeof options.enqueueReconciliation !== "function"
  ) {
    throw new PilotApiError(
      "GOOGLE_RECONCILIATION_UNAVAILABLE",
      "Google Calendar reconciliation is temporarily unavailable.",
      503,
    );
  }
  await options.enqueueReconciliation(
    { subscriptionId: input.subscriptionId, timetableId },
    env,
  );
  return respond(
    {
      googleCalendarSync: {
        queued: true,
        subscriptionId: input.subscriptionId,
        timetableId,
      },
    },
    202,
  );
}

// The parent supplies a durable enqueue hook; importing delivery here would
// couple the provider service back to its job dispatcher.
export async function handleGoogleCalendarRequest(request, env, options = {}) {
  const hasRecoveryScope = Boolean(googleRecoveryScope(env)?.subscription);
  options = {
    ...options,
    deliveryEnabled:
      options.deliveryEnabled ??
      (env.ENABLE_GOOGLE_DELIVERY === "true" ||
        Boolean(googleCanaryScope(env)?.subscription) ||
        hasRecoveryScope),
  };
  const url = new URL(request.url);
  const route = url.pathname.match(
    /^\/api\/calendar\/google\/(status|connect|callback|disconnect)$/,
  )?.[1];
  const syncMatch = url.pathname.match(
    /^\/api\/admin\/timetables\/([^/]+)\/google-calendar-sync$/,
  );
  if (!route && !syncMatch) return null;
  const method = syncMatch || route === "disconnect" ? "POST" : "GET";
  if (request.method !== method) {
    return respond(
      { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } },
      405,
      { allow: method },
    );
  }
  try {
    const origin = request.headers.get("origin");
    if (
      (method === "POST" || route === "connect") &&
      origin &&
      origin !== url.origin
    ) {
      throw new PilotApiError(
        "ORIGIN_NOT_ALLOWED",
        "Use the application origin.",
        403,
      );
    }
    if (syncMatch)
      return await targetedSync(
        request,
        env,
        decodeURIComponent(syncMatch[1]),
        options,
      );
    if (route === "status") {
      const status = getPublicGoogleCalendarStatus(env);
      const scope = googleCanaryScope(env);
      return respond({
        ...status,
        enabled:
          status.enabled &&
          ((options.deliveryEnabled && env.ENABLE_GOOGLE_DELIVERY === "true") ||
            Boolean(scope && sessionOwner(request) === scope.owner)),
      });
    }
    if (route === "connect") {
      if (!options.deliveryEnabled) {
        throw new PilotApiError(
          "GOOGLE_INITIAL_SYNC_UNAVAILABLE",
          "Google Calendar connection is temporarily unavailable.",
          503,
        );
      }
      const subscriptionId = validate(
        z.string().uuid(),
        url.searchParams.get("subscriptionId"),
      );
      if (
        env.ENABLE_GOOGLE_DELIVERY !== "true" &&
        !googleSubscriptionAllowed(
          env,
          (await getCalendarSubscriptionById(subscriptionId, env)) ?? {},
        )
      ) {
        throw new PilotApiError(
          "GOOGLE_INITIAL_SYNC_UNAVAILABLE",
          "Google Calendar connection is temporarily unavailable.",
          503,
        );
      }
      const location = await beginGoogleCalendarConnection({
        subscriptionId,
        anonymousSessionId: sessionOwner(request),
        env,
      });
      return redirect(location.toString());
    }
    if (route === "disconnect") {
      const input = validate(disconnectSchema, await readJson(request));
      return respond(
        await disconnectGoogleCalendar({
          ...input,
          anonymousSessionId: sessionOwner(request),
          env,
        }),
      );
    }
    // Redirects use configured application origin (or the actual request origin),
    // never forwarded host headers or provider-controlled redirect parameters.
    const publicOrigin = getPublicAppUrl(
      {
        ...env,
        PUBLIC_APP_URL:
          env.APP_ENV === "cloudflare-staging" &&
          env.STAGING_ORIGIN === url.origin
            ? url.origin
            : (env.PUBLIC_APP_URL ?? url.origin),
      },
      "production",
    );
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (url.searchParams.has("error") || !code || !state) {
      return redirect(`${publicOrigin}/find?calendar=google-cancelled`);
    }
    if (
      !options.deliveryEnabled ||
      typeof options.enqueueInitialSync !== "function"
    ) {
      throw new PilotApiError(
        "GOOGLE_INITIAL_SYNC_UNAVAILABLE",
        "Google Calendar connection is temporarily unavailable.",
        503,
      );
    }
    try {
      const result = await completeGoogleCalendarConnection({
        code,
        state,
        env,
        enqueueInitialSync: options.enqueueInitialSync,
      });
      return redirect(
        `${publicOrigin}/t/${encodeURIComponent(result.publicSlug)}?calendar=google-success&subscriptionId=${encodeURIComponent(result.subscriptionId)}`,
      );
    } catch {
      return redirect(`${publicOrigin}/find?calendar=google-failed`);
    }
  } catch (error) {
    if (error instanceof PilotApiError || error instanceof AdminAuthError) {
      return respond(
        { error: { code: error.code, message: error.message } },
        error.status,
      );
    }
    return respond(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "We could not complete that request. Please try again.",
        },
      },
      500,
    );
  }
}
