import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseRecoveryPlan,
  previewIsSafe,
  runGoogleRecovery,
} from "../scripts/recover-hit-google.mjs";
import { verifyStagingIdentity } from "../scripts/verify-staging-identity.mjs";
import { obtainAcceptanceToken } from "../scripts/recovery-acceptance.mjs";

vi.mock("../scripts/verify-staging-identity.mjs", () => ({
  verifyStagingIdentity: vi.fn(),
}));
vi.mock("../scripts/recovery-acceptance.mjs", () => ({
  obtainAcceptanceToken: vi.fn(),
}));
const sha = "a".repeat(40);
const now = Date.parse("2026-10-28T12:00:00Z");
const subscription = {
  subscriptionId: "10000000-0000-4000-8000-000000000001",
  timetableId: "20000000-0000-4000-8000-000000000001",
  ownerId: "30000000-0000-4000-8000-000000000001",
  status: "active",
  desiredRevision: 3,
  connectionGeneration: 2,
  mappingCount: 5,
  lastSyncedAt: null,
};
const plan = () => ({
  candidateSha: sha,
  expiresAt: new Date(now + 3600000).toISOString(),
  subscriptions: [{ ...subscription }],
});
const safePreview = {
  executionGuard: {
    revision: 3,
    connectionGeneration: 2,
    maxCreates: 0,
    maxDeletes: 0,
  },
  readOnly: true,
  ownershipReviewCount: 0,
  expectedEvents: 5,
  remoteManagedEvents: 5,
  localMappings: 5,
  wouldCreate: 0,
  wouldUpdate: 5,
  wouldDelete: 0,
  unchanged: 0,
};
const env = () => ({
  GITHUB_REF: "refs/heads/Calender",
  RECOVERY_MODE: "preflight",
  RECOVERY_INDEX: "0",
  EXPECTED_RELEASE_SHA: sha,
  EXPECTED_WORKER_VERSION: "test-version",
  RECOVERY_PLAN: JSON.stringify({
    ...plan(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  }),
  CALENDERZW_STAGING_ADMIN_ACCESS_TOKEN: "private-test-token",
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(verifyStagingIdentity).mockResolvedValue({
    sourceSha: sha,
    runtime: "cloudflare-workers",
    legacyBackendBridge: false,
    workerVersion: "test-version",
  });
  vi.mocked(obtainAcceptanceToken).mockResolvedValue("private-test-token");
});

describe("private recovery plan", () => {
  it("accepts an exact candidate and bounded private subscription snapshot", () => {
    expect(parseRecoveryPlan(JSON.stringify(plan()), sha, now)).toEqual(plan());
  });
  it.each(["{", "null", "[]", "{}"])("rejects malformed plan %s", (raw) => {
    expect(() => parseRecoveryPlan(raw, sha, now)).toThrow();
  });
  it.each([-1, 0, 86400001])(
    "rejects expiry outside the future 24-hour window: %s",
    (offset) => {
      expect(() =>
        parseRecoveryPlan(
          JSON.stringify({
            ...plan(),
            expiresAt: new Date(now + offset).toISOString(),
          }),
          sha,
          now,
        ),
      ).toThrow();
    },
  );
  it("rejects candidate mismatch and duplicate subscription identities", () => {
    expect(() =>
      parseRecoveryPlan(JSON.stringify(plan()), "b".repeat(40), now),
    ).toThrow();
    expect(() =>
      parseRecoveryPlan(
        JSON.stringify({
          ...plan(),
          subscriptions: [subscription, subscription],
        }),
        sha,
        now,
      ),
    ).toThrow();
  });
  it.each([
    { subscriptionId: "invalid" },
    { timetableId: "invalid" },
    { ownerId: "invalid" },
    { desiredRevision: 0 },
    { desiredRevision: 1.5 },
    { connectionGeneration: -1 },
    { mappingCount: -1 },
    { mappingCount: 1.5 },
    { status: "pending" },
    { lastSyncedAt: "invalid" },
  ])("rejects invalid snapshot fields %j", (change) => {
    expect(() =>
      parseRecoveryPlan(
        JSON.stringify({
          ...plan(),
          subscriptions: [{ ...subscription, ...change }],
        }),
        sha,
        now,
      ),
    ).toThrow();
  });
  it("rejects an empty or oversized batch", () => {
    for (const subscriptions of [
      [],
      Array.from({ length: 26 }, (_, index) => ({
        ...subscription,
        subscriptionId: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      })),
    ]) {
      expect(() =>
        parseRecoveryPlan(
          JSON.stringify({ ...plan(), subscriptions }),
          sha,
          now,
        ),
      ).toThrow();
    }
  });
});

describe("provider preview safety", () => {
  it("accepts an ownership-reviewed update-only diff", () =>
    expect(previewIsSafe(safePreview)).toBe(true));
  it.each([
    { readOnly: false },
    { skipped: true },
    { ownershipReviewCount: 1 },
    { expectedEvents: 0 },
    { remoteManagedEvents: 0 },
    { localMappings: 0 },
    { wouldCreate: 1 },
    { wouldDelete: 1 },
  ])("rejects unsafe preview %j", (change) =>
    expect(previewIsSafe({ ...safePreview, ...change })).toBe(false),
  );
  it("fails closed for missing, fractional, string, negative and nonfinite counters", () => {
    for (const field of [
      "ownershipReviewCount",
      "expectedEvents",
      "remoteManagedEvents",
      "localMappings",
      "wouldCreate",
      "wouldUpdate",
      "wouldDelete",
      "unchanged",
    ]) {
      for (const value of [undefined, -1, 1.5, "0", NaN, Infinity]) {
        expect(previewIsSafe({ ...safePreview, [field]: value })).toBe(false);
      }
    }
    expect(previewIsSafe(null)).toBe(false);
  });
});

describe("recovery operational boundary", () => {
  it("checks deployed identity before authenticating and preflight needs no token", async () => {
    const request = vi.fn();
    await runGoogleRecovery(env(), { request });
    expect(verifyStagingIdentity).toHaveBeenCalled();
    expect(obtainAcceptanceToken).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });
  it("blocks identity mismatch without transmitting credentials", async () => {
    vi.mocked(verifyStagingIdentity).mockRejectedValue(
      new Error("STAGING_IDENTITY_MISMATCH_AUTHENTICATION_BLOCKED"),
    );
    const request = vi.fn();
    await expect(
      runGoogleRecovery({ ...env(), RECOVERY_MODE: "preview" }, { request }),
    ).rejects.toThrow();
    expect(obtainAcceptanceToken).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });
});

describe("private provider diagnostics", () => {
  it("rejects a malformed plan before any network or authentication", async () => {
    await expect(
      runGoogleRecovery(
        { ...env(), RECOVERY_PLAN: "{}" },
        { request: vi.fn() },
      ),
    ).rejects.toThrow();
    expect(verifyStagingIdentity).not.toHaveBeenCalled();
    expect(obtainAcceptanceToken).not.toHaveBeenCalled();
  });
  it("keeps verify requests read-only, pinned to staging and reports free of private identifiers", async () => {
    const privatePreview = {
      ...safePreview,
      ...subscription,
      calendarId: "private-calendar",
      eventId: "private-event",
      remoteContentMismatchFields: {
        summary: 2,
        recurrence: 1,
        unknown: "private-field-value",
        location: "2",
        description: -1,
        end: 6,
      },
    };
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          googleCalendarSync: { decryptionCompatible: true, readOnly: true },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ googleCalendarSync: privatePreview }),
      );
    const report = await runGoogleRecovery(
      {
        ...env(),
        RECOVERY_MODE: "verify",
        API_ORIGIN: "https://attacker.invalid",
      },
      { request },
    );
    expect(request).toHaveBeenCalledTimes(2);
    expect(
      vi.mocked(verifyStagingIdentity).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(obtainAcceptanceToken).mock.invocationCallOrder[0],
    );
    for (const [url, init] of request.mock.calls) {
      expect(new URL(String(url)).origin).toBe(
        "https://next.calender.aido.co.zw",
      );
      expect(init.redirect).toBe("error");
      expect(JSON.parse(init.body).dryRun).toBe(true);
    }
    const output = JSON.stringify(report);
    for (const value of [
      subscription.subscriptionId,
      subscription.timetableId,
      subscription.ownerId,
      "private-calendar",
      "private-event",
      "private-test-token",
    ])
      expect(output).not.toContain(value);
    expect(output).toContain('"safeToProceed":true');
    expect(
      (report.results[0].preview as Record<string, unknown>)
        .remoteContentMismatchFields,
    ).toEqual({ summary: 2, recurrence: 1 });
    expect(output).not.toContain("private-field-value");
  });
  it("retains only a sanitized provider error code", async () => {
    const request = vi.fn().mockResolvedValue(
      Response.json(
        {
          error: {
            code: "GOOGLE_TOKEN_REFRESH_FAILED",
            message: "private-provider-detail",
            calendarId: "private-calendar",
          },
        },
        { status: 502 },
      ),
    );
    const report = await runGoogleRecovery(
      { ...env(), RECOVERY_MODE: "preview" },
      { request },
    );
    expect(report.results).toEqual([
      { index: 0, error: "GOOGLE_TOKEN_REFRESH_FAILED" },
    ]);
  });
});

describe("bounded canary authorization and revocation", () => {
  const operationalEnv = () => ({
    ...env(),
    RECOVERY_MODE: "canary",
    RECOVERY_PLAN: JSON.stringify({
      ...plan(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      subscriptions: [
        { ...subscription, lastSyncedAt: "2026-10-15T12:00:00Z" },
      ],
    }),
    CLOUDFLARE_ACCOUNT_ID: "f".repeat(32),
    CLOUDFLARE_API_TOKEN: "private-cloudflare-token",
  });
  const provider = (scenario: string) => {
    let scopePresent = scenario === "disable";
    let queued = false;
    return vi.fn(
      async (url: Parameters<typeof fetch>[0], init: RequestInit = {}) => {
        const target = new URL(String(url));
        expect(init.redirect).toBe("error");
        if (target.origin === "https://api.cloudflare.com") {
          expect(target.pathname).toMatch(
            /^\/client\/v4\/accounts\/f{32}\/workers\/scripts\/calenderzw-edge-staging\/(settings|deployments|versions\/new-version|secrets(?:\/GOOGLE_RECOVERY_CANARY)?)$/,
          );
          if (init.method === "PUT") {
            if (scenario === "rejected-put")
              return Response.json(
                {
                  success: false,
                  errors: [
                    { message: "private-provider-rejected-scope", code: 10000 },
                  ],
                },
                { status: 403 },
              );
            scopePresent = true;
            const scope = JSON.parse(JSON.parse(String(init.body)).text);
            expect(scope).toMatchObject({
              candidateSha: sha,
              subscriptionId: subscription.subscriptionId,
              ownerId: subscription.ownerId,
              timetableId: subscription.timetableId,
              mode: "deliver",
              revision: 3,
              connectionGeneration: 2,
              maxCreates: 0,
              maxDeletes: 0,
            });
            if (scenario === "lost-put")
              throw new Error("private-lost-response");
          }
          if (init.method === "DELETE") {
            if (!scopePresent)
              return Response.json(
                {
                  success: false,
                  errors: [{ message: "private-secret-not-found" }],
                },
                { status: 404 },
              );
            scopePresent = false;
          }
          const bindings = [
            { name: "SOURCE_SHA", text: sha },
            { name: "ENABLE_GOOGLE_DELIVERY", text: "false" },
            ...(scopePresent
              ? [{ name: "GOOGLE_RECOVERY_CANARY", type: "secret_text" }]
              : []),
          ];
          const result = target.pathname.endsWith("/versions/new-version")
            ? { resources: { bindings } }
            : target.pathname.endsWith("/settings")
              ? {
                  bindings,
                }
              : target.pathname.endsWith("/deployments")
                ? {
                    deployments: [
                      {
                        versions: [
                          { version_id: "new-version", percentage: 100 },
                        ],
                      },
                    ],
                  }
                : {};
          return Response.json({ success: true, result });
        }
        expect(target.origin).toBe("https://next.calender.aido.co.zw");
        const body = JSON.parse(String(init.body));
        if (body.credentialCheckOnly)
          return Response.json({
            googleCalendarSync: { readOnly: true, decryptionCompatible: true },
          });
        if (body.dryRun === false) {
          expect(scopePresent).toBe(true);
          queued = true;
          if (scenario === "enqueue-failure")
            throw new Error("private-provider-detail");
          return Response.json({ googleCalendarSync: { queued: true } });
        }
        return Response.json({
          googleCalendarSync: {
            ...safePreview,
            subscriptionId: subscription.subscriptionId,
            timetableId: subscription.timetableId,
            ...(scenario === "unsafe" ? { wouldDelete: 1 } : {}),
            ...(scenario === "missing-guard"
              ? { executionGuard: undefined }
              : {}),
            ...(scenario === "stale-guard"
              ? {
                  executionGuard: {
                    ...safePreview.executionGuard,
                    revision: 2,
                  },
                }
              : {}),
            ...(scenario === "stale-generation"
              ? {
                  executionGuard: {
                    ...safePreview.executionGuard,
                    connectionGeneration: 1,
                  },
                }
              : {}),
            ...(queued
              ? { wouldUpdate: 0, unchanged: 5, remoteContentsVerified: true }
              : {}),
          },
        });
      },
    );
  };
  const writes = (request: ReturnType<typeof provider>, method: string) =>
    request.mock.calls.filter(([, init]) => init?.method === method);
  const queues = (request: ReturnType<typeof provider>) =>
    request.mock.calls.filter(
      ([url, init]) =>
        new URL(String(url)).origin === "https://next.calender.aido.co.zw" &&
        JSON.parse(String(init?.body)).dryRun === false,
    );

  it("waits for public identity propagation after provisioning and revocation without repeating writes", async () => {
    let calls = 0;
    vi.mocked(verifyStagingIdentity).mockImplementation(async () => {
      calls++;
      if (calls === 3 || calls === 5)
        throw new Error("STAGING_IDENTITY_MISMATCH_AUTHENTICATION_BLOCKED");
      return {
        sourceSha: sha,
        runtime: "cloudflare-workers",
        legacyBackendBridge: false,
        workerVersion: "new-version",
      };
    });
    const request = provider("success");
    const report = await runGoogleRecovery(operationalEnv(), {
      request,
      delay: async () => {},
    });
    expect(queues(request)).toHaveLength(1);
    expect(writes(request, "PUT")).toHaveLength(1);
    expect(writes(request, "DELETE")).toHaveLength(1);
    expect(report.results[0]).toMatchObject({ remoteContentsVerified: true });
    expect(report.recoveryAuthorizationAbsent).toBe(true);
  });

  it("fails closed after bounded identity retries and still removes the scope", async () => {
    let calls = 0;
    vi.mocked(verifyStagingIdentity).mockImplementation(async () => {
      if (++calls > 2)
        throw new Error("STAGING_IDENTITY_MISMATCH_AUTHENTICATION_BLOCKED");
      return {
        sourceSha: sha,
        runtime: "cloudflare-workers",
        legacyBackendBridge: false,
        workerVersion: "test-version",
      };
    });
    const request = provider("success");
    await expect(
      runGoogleRecovery(operationalEnv(), { request, delay: async () => {} }),
    ).rejects.toThrow("STAGING_IDENTITY_MISMATCH_AUTHENTICATION_BLOCKED");
    expect(calls).toBe(12);
    expect(queues(request)).toHaveLength(0);
    expect(writes(request, "PUT")).toHaveLength(1);
    expect(writes(request, "DELETE")).toHaveLength(1);
  });

  it("waits for active version binding propagation before queueing and confirming removal", async () => {
    const upstream = provider("success");
    let reads = 0;
    const request = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const response = await upstream(...args);
      if (
        String(args[0]).endsWith("/versions/new-version") &&
        ++reads % 2 === 1
      ) {
        const body = await response.json();
        const bindings = body.result.resources.bindings;
        body.result.resources.bindings = bindings.some(
          (b: { name: string }) => b.name === "GOOGLE_RECOVERY_CANARY",
        )
          ? bindings.filter(
              (b: { name: string }) => b.name !== "GOOGLE_RECOVERY_CANARY",
            )
          : [
              ...bindings,
              { name: "GOOGLE_RECOVERY_CANARY", type: "secret_text" },
            ];
        return Response.json(body);
      }
      return response;
    });
    const report = await runGoogleRecovery(operationalEnv(), {
      request,
      delay: async () => {},
    });
    expect(reads).toBe(4);
    expect(queues(upstream)).toHaveLength(1);
    expect(report.recoveryAuthorizationAbsent).toBe(true);
  });

  it.each(["unsafe", "missing-guard", "stale-guard", "stale-generation"])(
    "never provisions authority or queues delivery for %s",
    async (scenario) => {
      const request = provider(scenario);
      await runGoogleRecovery(operationalEnv(), {
        request,
        delay: async () => {},
      });
      expect(writes(request, "PUT")).toHaveLength(0);
      expect(queues(request)).toHaveLength(0);
    },
  );
  it.each(["success", "enqueue-failure", "lost-put"])(
    "revokes canary authority after %s",
    async (scenario) => {
      const request = provider(scenario);
      const report = await runGoogleRecovery(operationalEnv(), {
        request,
        delay: async () => {},
      });
      expect(writes(request, "PUT")).toHaveLength(1);
      expect(writes(request, "DELETE")).toHaveLength(1);
      expect(queues(request)).toHaveLength(scenario === "lost-put" ? 0 : 1);
      expect(report.recoveryAuthorizationAbsent).toBe(true);
      expect(JSON.stringify(report)).not.toMatch(
        /private-provider|private-lost|private-cloudflare/,
      );
      if (scenario === "success")
        expect(report.results[0]).toMatchObject({
          queued: true,
          mappingComparisonConverged: true,
          fullyVerified: false,
        });
    },
  );
  it("verifies absent authorization after a rejected scope PUT without masking its sanitized report with DELETE 404", async () => {
    const request = provider("rejected-put");
    const report = await runGoogleRecovery(operationalEnv(), {
      request,
      delay: async () => {},
    });
    expect(writes(request, "PUT")).toHaveLength(1);
    expect(writes(request, "DELETE")).toHaveLength(0);
    expect(queues(request)).toHaveLength(0);
    expect(report.recoveryAuthorizationAbsent).toBe(true);
    expect(report.results).toContainEqual({
      index: 0,
      error: "RECOVERY_CONFIGURATION_OPERATION_FAILED",
    });
    expect(JSON.stringify(report)).not.toMatch(
      /private-provider|private-secret|private-cloudflare/,
    );
  });
  it.each([undefined, JSON.stringify(plan())])(
    "disables authority with absent or expired plan without admin authentication",
    async (raw) => {
      const request = provider("disable");
      const report = await runGoogleRecovery(
        { ...operationalEnv(), RECOVERY_MODE: "disable", RECOVERY_PLAN: raw },
        { request },
      );
      expect(report.recoveryAuthorizationAbsent).toBe(true);
      expect(obtainAcceptanceToken).not.toHaveBeenCalled();
      expect(writes(request, "DELETE")).toHaveLength(1);
      expect(writes(request, "PUT")).toHaveLength(0);
      expect(queues(request)).toHaveLength(0);
      expect(
        request.mock.calls.every(
          ([url]) =>
            new URL(String(url)).origin === "https://api.cloudflare.com",
        ),
      ).toBe(true);
    },
  );
});
