/* global console */
import {
  enqueueSubscriptionReconciliation,
  recoverGoogleCalendarDelivery,
  claimGoogleCalendarSubscriptionDelivery,
  deliverGoogleCalendarJob,
  listReadyGoogleCalendarDeliveries,
} from "../server/googleCalendarDelivery.ts";
import { syncGoogleSubscription } from "../server/googleCalendarSync.ts";
import { PilotApiError } from "../server/pilotRepository.ts";

const enabled = (env) => env.ENABLE_GOOGLE_DELIVERY === "true";

export async function enqueueNativeGoogleSync(input, env) {
  if (!enabled(env) || !env.PUSH_QUEUE)
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
  if (!enabled(env)) return;
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
  if (!enabled(env)) {
    message.retry({ delaySeconds: 300 });
    return true;
  }
  const id = message.body.subscriptionId;
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id)) {
    message.retry({ delaySeconds: 300 });
    return true;
  }
  try {
    const job = await claimGoogleCalendarSubscriptionDelivery(id, 300, env);
    if (!job) {
      message.ack();
      return true;
    }
    const finished = await deliverGoogleCalendarJob(
      job,
      async (claimed, signal) => {
        const result = await syncGoogleSubscription(
          claimed.subscriptionId,
          env,
          { signal },
        );
        return {
          completed:
            Boolean(result.lastSyncedAt) && !(result.ownershipReviewCount > 0),
        };
      },
      { env },
    );
    if (finished) message.ack();
    else message.retry({ delaySeconds: 300 });
  } catch {
    message.retry({ delaySeconds: 300 });
  }
  return true;
}
