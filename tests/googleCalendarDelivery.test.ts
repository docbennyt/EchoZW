import { describe, expect, it, vi } from "vitest";
import {
  classifyGoogleCalendarDeliveryError,
  deliverGoogleCalendarJob,
  type GoogleCalendarDeliveryJob,
} from "../server/googleCalendarDelivery.js";

const job: GoogleCalendarDeliveryJob = {
  subscriptionId: "subscription",
  revision: 4,
  leaseToken: "token",
  attemptCount: 2,
  leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
};

describe("Google durable delivery", () => {
  it.each([
    [{ code: "GOOGLE_REFRESH_FAILED", status: 409 }, "retry"],
    [{ code: "GOOGLE_API_FAILED", details: { status: 503 } }, "retry"],
    [{ code: "GOOGLE_API_FAILED", details: { status: 429 } }, "retry"],
    [
      {
        code: "GOOGLE_API_FAILED",
        details: {
          status: 403,
          error: { errors: [{ reason: "rateLimitExceeded" }] },
        },
      },
      "retry",
    ],
    [{ details: { error: "invalid_grant" } }, "reconnect"],
    [{ code: "GOOGLE_CREDENTIAL_INVALID" }, "reconnect"],
    [{ code: "GOOGLE_NOT_CONNECTED" }, "reconnect"],
    [new TypeError("network error"), "retry"],
  ])("classifies %j as %s", (error, outcome) => {
    expect(classifyGoogleCalendarDeliveryError(error)).toBe(outcome);
  });

  it("acknowledges only a completed sync and passes cancellation to the adapter", async () => {
    const finish = vi.fn().mockResolvedValue(true);
    const sync = vi.fn().mockResolvedValue({ completed: true });
    expect(await deliverGoogleCalendarJob(job, sync, { finish })).toBe(true);
    expect(sync).toHaveBeenCalledWith(job, expect.any(AbortSignal));
    expect(finish).toHaveBeenCalledWith(job, "success", null);
  });

  it("does not count a disconnected/skipped sync as success", async () => {
    const finish = vi.fn().mockResolvedValue(true);
    await deliverGoogleCalendarJob(job, async () => ({ completed: false }), {
      finish,
    });
    expect(finish).toHaveBeenCalledWith(job, "retry", "GOOGLE_SYNC_INCOMPLETE");
  });

  it("retains ambiguous refresh failures for retry without exposing error text", async () => {
    const finish = vi.fn().mockResolvedValue(true);
    await deliverGoogleCalendarJob(
      job,
      async () => {
        throw { code: "GOOGLE_REFRESH_FAILED", message: "sensitive" };
      },
      { finish },
    );
    expect(finish).toHaveBeenCalledWith(job, "retry", "GOOGLE_REFRESH_FAILED");
  });

  it("leaves failed acknowledgments recoverable by lease expiry", async () => {
    const finish = vi.fn().mockRejectedValue(new Error("database offline"));
    await expect(
      deliverGoogleCalendarJob(job, async () => ({ completed: true }), {
        finish,
      }),
    ).rejects.toThrow("database offline");
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it("does not start provider work on an expired lease", async () => {
    const sync = vi.fn();
    const finish = vi.fn();
    expect(
      await deliverGoogleCalendarJob(
        { ...job, leaseExpiresAt: "2000-01-01T00:00:00Z" },
        sync,
        { finish },
      ),
    ).toBe(false);
    expect(sync).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
  });

  it("aborts five seconds before expiry and never acknowledges late provider completion as success", async () => {
    vi.useFakeTimers();
    try {
      const finish = vi.fn().mockResolvedValue(true);
      let complete!: (result: { completed: boolean }) => void;
      let signal!: AbortSignal;
      const pending = deliverGoogleCalendarJob(
        { ...job, leaseExpiresAt: new Date(Date.now() + 10_000).toISOString() },
        async (_job, abortSignal) => {
          signal = abortSignal;
          return new Promise((resolve) => {
            complete = resolve;
          });
        },
        { finish },
      );
      await vi.advanceTimersByTimeAsync(4_999);
      expect(signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(signal.aborted).toBe(true);
      expect(finish).not.toHaveBeenCalled();
      complete({ completed: true });
      await pending;
      expect(finish).toHaveBeenCalledWith(
        expect.anything(),
        "retry",
        "GOOGLE_SYNC_INCOMPLETE",
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
