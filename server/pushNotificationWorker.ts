import webpush from "web-push";
import { getWebPushConfig } from "./pushConfig.js";
import {
  claimPushDeliveries,
  claimPushOutbox,
  finalizePushOutbox,
  recordPushDelivery,
  type ClaimedPushDelivery,
  type ClaimedPushOutbox,
} from "./pushNotificationRepository.js";
import {
  buildPushPayload,
  classifyWebPushFailure,
  webPushSubscriptionFor,
} from "./pushNotificationService.js";

export type PushNotificationWorker = { stop: () => void };

type DeliveryDecision =
  | { result: "delivered"; errorCode: null; retryAfterSeconds: null }
  | ReturnType<typeof classifyWebPushFailure>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function deliveryTopic(outboxId: string) {
  return `czw-${outboxId.replace(/-/g, "").slice(0, 24)}`;
}

async function persistDeliveryResult(
  input: Parameters<typeof recordPushDelivery>[0],
  env: NodeJS.ProcessEnv,
) {
  let lastError: unknown;
  for (const delayMs of [0, 100, 500]) {
    if (delayMs) await sleep(delayMs);
    try {
      return await recordPushDelivery(input, env);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function deliverTarget(
  outbox: ClaimedPushOutbox,
  delivery: ClaimedPushDelivery,
  env: NodeJS.ProcessEnv,
) {
  let decision: DeliveryDecision;

  try {
    await webpush.sendNotification(
      webPushSubscriptionFor(delivery),
      buildPushPayload(outbox),
      {
        TTL: 60 * 60,
        urgency: "high",
        topic: deliveryTopic(outbox.id),
        timeout: 10_000,
      },
    );
    decision = {
      result: "delivered",
      errorCode: null,
      retryAfterSeconds: null,
    };
  } catch (error) {
    decision = classifyWebPushFailure(error);
  }

  await persistDeliveryResult(
    {
      deliveryId: delivery.deliveryId,
      result: decision.result,
      errorCode: decision.errorCode,
      retryAfterSeconds: decision.retryAfterSeconds,
    },
    env,
  );
}

async function deliverOutbox(
  outbox: ClaimedPushOutbox,
  env: NodeJS.ProcessEnv,
) {
  const deliveries = await claimPushDeliveries(outbox.id, 100, env);
  const concurrency = 10;

  for (let offset = 0; offset < deliveries.length; offset += concurrency) {
    const batch = deliveries.slice(offset, offset + concurrency);
    const results = await Promise.allSettled(
      batch.map((delivery) => deliverTarget(outbox, delivery, env)),
    );
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (rejected) throw rejected.reason;
  }

  await finalizePushOutbox(outbox.id, env);
}

export function startPushNotificationWorker(
  env: NodeJS.ProcessEnv = process.env,
): PushNotificationWorker {
  if (env.PUSH_NOTIFICATION_WORKER_ENABLED === "false") {
    return { stop: () => undefined };
  }

  let config;
  try {
    config = getWebPushConfig(env);
  } catch (error) {
    console.warn("push.notification.worker.disabled", {
      code: error instanceof Error ? error.message : "PUSH_CONFIG_INVALID",
    });
    return { stop: () => undefined };
  }
  if (!config.enabled) return { stop: () => undefined };

  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);

  const intervalMs = Math.max(
    Number(env.PUSH_NOTIFICATION_WORKER_INTERVAL_MS ?? 10_000),
    1_000,
  );
  let stopped = false;
  let processing = false;
  let timer: NodeJS.Timeout | null = null;

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => void tick(), intervalMs);
    timer.unref?.();
  };

  const tick = async () => {
    if (processing || stopped) {
      schedule();
      return;
    }
    processing = true;
    try {
      const outboxItems = await claimPushOutbox(10, env);
      for (const outbox of outboxItems) {
        try {
          await deliverOutbox(outbox, env);
        } catch (error) {
          console.warn("push.notification.delivery.failed", {
            code:
              error instanceof Error
                ? error.name || "PUSH_DELIVERY_FAILED"
                : "PUSH_DELIVERY_FAILED",
            outboxId: outbox.id,
          });
        }
      }
    } catch (error) {
      console.warn("push.notification.worker.failed", {
        code:
          error instanceof Error
            ? error.name || "PUSH_WORKER_FAILED"
            : "PUSH_WORKER_FAILED",
      });
    } finally {
      processing = false;
      schedule();
    }
  };

  void tick();
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
