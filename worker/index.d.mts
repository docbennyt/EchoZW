declare const worker: {
  fetch(
    request: Request,
    env: Record<string, unknown>,
    ctx: { waitUntil(promise: Promise<unknown>): void },
  ): Promise<Response>;
  queue(
    batch: {
      messages: Array<{
        body?: unknown;
        ack?(): void;
        retry(options?: { delaySeconds: number }): void;
      }>;
    },
    env?: Record<string, unknown>,
  ): Promise<void>;
  scheduled(controller: unknown, env: Record<string, unknown>): Promise<void>;
};
export default worker;
