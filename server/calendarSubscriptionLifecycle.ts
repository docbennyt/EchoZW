import {
  PilotApiError,
  getCalendarSubscriptionById,
} from "./pilotRepository.js";
import { createSupabaseAdminClient } from "./supabase/adminClient.js";

export async function revokeOwnedFeedSubscription(
  subscriptionId: string,
  anonymousSessionId: string | null,
  env: NodeJS.ProcessEnv,
) {
  const subscription = (await getCalendarSubscriptionById(
    subscriptionId,
    env,
  )) as Record<string, unknown> | null;
  if (!subscription)
    throw new PilotApiError(
      "SUBSCRIPTION_NOT_FOUND",
      "Calendar subscription not found.",
      404,
    );
  if (
    !anonymousSessionId ||
    subscription.anonymous_session_id !== anonymousSessionId
  )
    throw new PilotApiError(
      "FORBIDDEN",
      "This calendar subscription belongs to another session.",
      403,
    );
  if (subscription.provider === "google_api")
    throw new PilotApiError(
      "GOOGLE_DISCONNECT_REQUIRED",
      "Disconnect Google Calendar through its connection settings.",
      409,
    );
  if (!subscription.revoked_at) {
    const { error } = await createSupabaseAdminClient(env)
      .from("calendar_subscriptions")
      .update({
        revoked_at: new Date().toISOString(),
        status: "disconnected",
        token_hash: null,
      })
      .eq("id", subscriptionId)
      .eq("anonymous_session_id", anonymousSessionId);
    if (error)
      throw new PilotApiError(
        "DATABASE_UNAVAILABLE",
        "Could not revoke this calendar subscription.",
        503,
      );
  }
  return {
    ok: true,
    message:
      "Calendar subscription revoked. Future feed requests will not work.",
  };
}
