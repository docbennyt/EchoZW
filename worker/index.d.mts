declare const worker: {
  fetch(
    request: Request,
    env: Record<string, unknown>,
    ctx: { waitUntil(promise: Promise<unknown>): void },
  ): Promise<Response>;
  queue(batch: {
    messages: Array<{
      body?: unknown;
      ack?(): void;
      retry(options?: { delaySeconds: number }): void;
    }>;
  }): Promise<void>;
};
export default worker;
