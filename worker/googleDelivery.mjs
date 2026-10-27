/* global console */
import {
  enqueueSubscriptionReconciliation,
  recoverGoogleCalendarDelivery,
  claimGoogleCalendarSubscriptionDelivery,
  deliverGoogleCalendarJob,
  listReadyGoogleCalendarDeliveries,
  recoverGoogleCalendarSubscriptionDelivery,
} from "../server/googleCalendarDelivery.ts";
import { syncGoogleSubscription } from "../server/googleCalendarSync.ts";
import {
  PilotApiError,
  getCalendarSubscriptionById,
} from "../server/pilotRepository.ts";
import {
  googleCanaryScope,
  googleDeliveryTargetAllowed,
  googleSubscriptionAllowed,
} from "../server/googleDeliveryPolicy.ts";

const enabled = (env) => env.ENABLE_GOOGLE_DELIVERY === "true";

export async function enqueueNativeGoogleSync(input, env) {
  if (
    !googleDeliveryTargetAllowed(env, input.subscriptionId) ||
    !env.PUSH_QUEUE ||
    (!enabled(env) &&
      !googleSubscriptionAllowed(
        env,
        (await getCalendarSubscriptionById(input.subscriptionId, env)) ?? {},
      ))
  )
    throw new PilotApiError(
      "GOOGLE_DELIVERY_UNAVAILABLE",
      "Google Calendar delivery is temporarily unavailable.",
      503,
    );
  if (!(await enqueueSubscriptionReconciliation(input.subscriptionId, env)))
    throw new PilotApiError(
      "GOOGLE_DELIVERY_UNAVAILABLE",
      "Google Calendar delivery could not be scheduled.",
      503,
    );
  try {
    await env.PUSH_QUEUE.send({
      type: "google_calendar_reconcile",
      subscriptionId: input.subscriptionId,
    });
  } catch {
    console.warn(
      JSON.stringify({
        event: "google.delivery.wakeup_failed",
        code: "QUEUE_SEND_FAILED",
      }),
    );
  }
  return { queued: true, remotelySynchronized: false };
}

export async function scheduleGoogleDelivery(env) {
  if (!enabled(env)) {
    const scope = googleCanaryScope(env);
    if (!scope?.subscription) return;
    if (!env.PUSH_QUEUE) throw new Error("GOOGLE_DELIVERY_QUEUE_MISSING");
    if (
      await recoverGoogleCalendarSubscriptionDelivery(scope.subscription, env)
    ) {
      await env.PUSH_QUEUE.send({
        type: "google_calendar_reconcile",
        subscriptionId: scope.subscription,
      });
    }
    return;
  }
  if (!env.PUSH_QUEUE) throw new Error("GOOGLE_DELIVERY_QUEUE_MISSING");
  await recoverGoogleCalendarDelivery(100, env);
  const ids = await listReadyGoogleCalendarDeliveries(10, env);
  if (ids.length)
    await env.PUSH_QUEUE.sendBatch(
      ids.map((subscriptionId) => ({
        body: { type: "google_calendar_reconcile", subscriptionId },
      })),
    );
}

export async function consumeGoogleDeliveryMessage(message, env) {
  if (message.body?.type !== "google_calendar_reconcile") return false;
  if (!googleDeliveryTargetAllowed(env, message.body.subscriptionId)) {
    message.retry({ delaySeconds: 300 });
    return true;
  }
  const id = message.body.subscriptionId;
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id)) {
    message.retry({ delaySeconds: 300 });
    return true;
  }
  try {
    if (
      !enabled(env) &&
      !googleSubscriptionAllowed(
        env,
        (await getCalendarSubscriptionById(id, env)) ?? {},
      )
    ) {
      message.retry({ delaySeconds: 300 });
      return true;
    }
    const job = await claimGoogleCalendarSubscriptionDelivery(id, 300, env);
    if (!job) {
      message.ack();
      return true;
    }
    let incomplete = false;
    let continuation = false;
    const finished = await deliverGoogleCalendarJob(
      job,
      async (claimed, signal) => {
        try {
          const result = await syncGoogleSubscription(
            claimed.subscriptionId,
            env,
            { signal, maxExternalRequests: 32 },
          );
          const completed =
            Boolean(result.lastSyncedAt) && !(result.ownershipReviewCount > 0);
          incomplete = !completed;
          return { completed };
        } catch (error) {
          incomplete = true;
          continuation = error?.code === "GOOGLE_SYNC_CONTINUE";
          throw error;
        }
      },
      { env },
    );
    if (finished && !incomplete) message.ack();
    else message.retry({ delaySeconds: continuation && finished ? 15 : 300 });
  } catch {
    message.retry({ delaySeconds: 300 });
  }
  return true;
}
