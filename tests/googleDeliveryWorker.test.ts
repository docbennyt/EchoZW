// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(),
  recover: vi.fn(),
  ready: vi.fn(),
  claim: vi.fn(),
  deliver: vi.fn(),
  sync: vi.fn(),
}));
vi.mock("../server/googleCalendarDelivery.ts", () => ({
  enqueueSubscriptionReconciliation: mocks.enqueue,
  recoverGoogleCalendarDelivery: mocks.recover,
  listReadyGoogleCalendarDeliveries: mocks.ready,
  claimGoogleCalendarSubscriptionDelivery: mocks.claim,
  deliverGoogleCalendarJob: mocks.deliver,
}));
vi.mock("../server/googleCalendarSync.ts", () => ({
  syncGoogleSubscription: mocks.sync,
}));
import {
  consumeGoogleDeliveryMessage,
  enqueueNativeGoogleSync,
  scheduleGoogleDelivery,
} from "../worker/googleDelivery.mjs";
const id = "6a734b01-c7c2-4b47-90ba-d865f7da8230";
const env = () => ({
  ENABLE_GOOGLE_DELIVERY: "true",
  PUSH_QUEUE: { send: vi.fn(), sendBatch: vi.fn() },
});
const message = () => ({
  body: { type: "google_calendar_reconcile", subscriptionId: id },
  ack: vi.fn(),
  retry: vi.fn(),
});
describe("Google durable delivery Worker handoff", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.enqueue.mockResolvedValue(true);
    mocks.recover.mockResolvedValue(1);
    mocks.ready.mockResolvedValue([id]);
    mocks.claim.mockResolvedValue({ subscriptionId: id, revision: 1 });
    mocks.deliver.mockResolvedValue(true);
    mocks.sync.mockResolvedValue({ lastSyncedAt: "2026-10-23T12:00:00Z" });
  });
  it("persists before queue send and leaves durable intent recoverable on queue failure", async () => {
    const config = env();
    config.PUSH_QUEUE.send.mockImplementation(async () => {
      expect(mocks.enqueue).toHaveBeenCalledWith(id, config);
      throw new Error("private-queue-error");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      await enqueueNativeGoogleSync({ subscriptionId: id }, config),
    ).toEqual({ queued: true, remotelySynchronized: false });
    expect(warn.mock.calls.flat().join(" ")).not.toContain(
      "private-queue-error",
    );
    warn.mockRestore();
  });
  it("never reports queued when persistence fails", async () => {
    const config = env();
    mocks.enqueue.mockResolvedValue(false);
    await expect(
      enqueueNativeGoogleSync({ subscriptionId: id }, config),
    ).rejects.toMatchObject({ code: "GOOGLE_DELIVERY_UNAVAILABLE" });
    expect(config.PUSH_QUEUE.send).not.toHaveBeenCalled();
  });
  it("recovers and queues only due bounded jobs; quiet periods enqueue nothing", async () => {
    const config = env();
    await scheduleGoogleDelivery(config);
    expect(mocks.ready).toHaveBeenCalledWith(10, config);
    expect(config.PUSH_QUEUE.sendBatch).toHaveBeenCalledWith([
      { body: { type: "google_calendar_reconcile", subscriptionId: id } },
    ]);
    config.PUSH_QUEUE.sendBatch.mockClear();
    mocks.ready.mockResolvedValue([]);
    await scheduleGoogleDelivery(config);
    expect(config.PUSH_QUEUE.sendBatch).not.toHaveBeenCalled();
  });
  it("acks only after fenced durable completion", async () => {
    const item = message();
    mocks.deliver.mockImplementation(async (_job, sync) => {
      expect(item.ack).not.toHaveBeenCalled();
      await sync({ subscriptionId: id }, new AbortController().signal);
      return true;
    });
    expect(await consumeGoogleDeliveryMessage(item, env())).toBe(true);
    expect(mocks.sync).toHaveBeenCalledWith(id, expect.anything(), {
      signal: expect.any(AbortSignal),
      maxExternalRequests: 32,
    });
    expect(item.ack).toHaveBeenCalledOnce();
    expect(item.retry).not.toHaveBeenCalled();
  });

  it("retries a durable continuation without acknowledging incomplete provider work", async () => {
    const item = message();
    mocks.sync.mockRejectedValue({ code: "GOOGLE_SYNC_CONTINUE" });
    mocks.deliver.mockImplementation(async (_job, sync) => {
      try {
        await sync({ subscriptionId: id }, new AbortController().signal);
      } catch {
        /* The service persists the continuation before returning accepted. */
      }
      return true;
    });
    await consumeGoogleDeliveryMessage(item, env());
    expect(item.ack).not.toHaveBeenCalled();
    expect(item.retry).toHaveBeenCalledWith({ delaySeconds: 15 });
  });
  it("processes mixed Google outcomes without acknowledging source jobs", async () => {
    const { default: worker } = await import("../worker/index.mjs");
    const success = message();
    const failure = message();
    const source = {
      ...message(),
      body: { type: "source_document_uploaded", subscriptionId: id },
    };
    mocks.deliver
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error("temporary failure"));
    await worker.queue({ messages: [success, source, failure] }, env());
    expect(success.ack).toHaveBeenCalledOnce();
    expect(success.retry).not.toHaveBeenCalled();
    expect(source.ack).not.toHaveBeenCalled();
    expect(source.retry).toHaveBeenCalledWith({ delaySeconds: 300 });
    expect(failure.ack).not.toHaveBeenCalled();
    expect(failure.retry).toHaveBeenCalledWith({ delaySeconds: 300 });
    expect(mocks.deliver).toHaveBeenCalledTimes(2);
  });
  it.each(["lost-lease", "database-failure"])(
    "retries %s without acknowledging",
    async (failure) => {
      const item = message();
      if (failure === "lost-lease") mocks.deliver.mockResolvedValue(false);
      else mocks.deliver.mockRejectedValue(new Error("DB unavailable"));
      await consumeGoogleDeliveryMessage(item, env());
      expect(item.ack).not.toHaveBeenCalled();
      expect(item.retry).toHaveBeenCalledWith({ delaySeconds: 300 });
    },
  );
  it("treats duplicate wakes as harmless and leaves unrelated queue messages untouched", async () => {
    const item = message();
    mocks.claim.mockResolvedValue(null);
    await consumeGoogleDeliveryMessage(item, env());
    expect(item.ack).toHaveBeenCalledOnce();
    expect(mocks.deliver).not.toHaveBeenCalled();
    item.body.type = "source_document_uploaded";
    expect(await consumeGoogleDeliveryMessage(item, env())).toBe(false);
  });
  it("does not execute provider work while disabled", async () => {
    const item = message();
    await consumeGoogleDeliveryMessage(item, {
      ENABLE_GOOGLE_DELIVERY: "false",
    });
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(item.retry).toHaveBeenCalled();
  });
  it.each([
    { lastSyncedAt: "2026-10-23T12:00:00Z", ownershipReviewCount: 1 },
    { ownershipReviewCount: 0 },
  ])("does not acknowledge incomplete reconciliation %#", async (result) => {
    const item = message();
    mocks.sync.mockResolvedValue(result);
    mocks.deliver.mockImplementation(async (_job, sync) => {
      const result = await sync(
        { subscriptionId: id },
        new AbortController().signal,
      );
      expect(result.completed).toBe(false);
      return false;
    });
    await consumeGoogleDeliveryMessage(item, env());
    expect(item.ack).not.toHaveBeenCalled();
    expect(item.retry).toHaveBeenCalled();
  });
});
