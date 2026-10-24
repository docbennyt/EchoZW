export function enqueueNativeGoogleSync(
  input: { subscriptionId: string },
  env: Record<string, unknown>,
): Promise<{ queued: boolean; remotelySynchronized: boolean }>;
export function scheduleGoogleDelivery(
  env: Record<string, unknown>,
): Promise<void>;
export function consumeGoogleDeliveryMessage(
  message: {
    body: { type: string; subscriptionId: string };
    ack(): void;
    retry(options?: { delaySeconds: number }): void;
  },
  env: Record<string, unknown>,
): Promise<boolean>;
