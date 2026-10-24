// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  budgetedFetch,
  markExternalWorkProgress,
  withExternalRequestBudget,
} from "../server/externalRequestBudget.js";

afterEach(() => vi.unstubAllGlobals());

describe("per-invocation external request budget", () => {
  it("refuses the next request before network I/O and leaves completion capacity", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      withExternalRequestBudget(2, async () => {
        await budgetedFetch("https://example.test/one");
        markExternalWorkProgress();
        await budgetedFetch("https://example.test/two");
        await budgetedFetch("https://example.test/three");
      }),
    ).rejects.toMatchObject({ code: "GOOGLE_SYNC_CONTINUE" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await budgetedFetch("https://example.test/finish");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("does not hot-loop a continuation when no durable progress was made", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("ok")));
    await expect(
      withExternalRequestBudget(1, async () => {
        await budgetedFetch("https://example.test/read");
        await budgetedFetch("https://example.test/read-again");
      }),
    ).rejects.toMatchObject({ code: "GOOGLE_SYNC_BUDGET_EXHAUSTED" });
  });

  it("isolates overlapping subscriptions and denies automatic redirect amplification", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", fetcher);
    await Promise.all(
      [1, 2].map(() =>
        withExternalRequestBudget(1, async () => {
          await Promise.resolve();
          await budgetedFetch("https://example.test/read");
        }),
      ),
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(
      fetcher.mock.calls.every(([, init]) => init.redirect === "manual"),
    ).toBe(true);
  });

  it("rejects privileged redirects without following them in workerd or Node", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://unrelated.test" },
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      budgetedFetch("https://example.test/provider", { redirect: "error" }),
    ).rejects.toThrow("redirects are not allowed");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][1].redirect).toBe("manual");
  });

  it("restores the continuation signal if a client library wraps fetch errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("ok")));
    await expect(
      withExternalRequestBudget(1, async () => {
        await budgetedFetch("https://example.test/write");
        markExternalWorkProgress();
        try {
          await budgetedFetch("https://example.test/read");
        } catch {
          throw new Error("wrapped database error");
        }
      }),
    ).rejects.toMatchObject({ code: "GOOGLE_SYNC_CONTINUE" });
  });
});
