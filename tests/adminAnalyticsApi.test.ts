import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { handleAdminAnalyticsApi } from "../server/adminAnalyticsApi";

function request(method: string, url: string) {
  const stream = Readable.from([]) as IncomingMessage;
  Object.assign(stream, { method, url, headers: {} });
  return stream;
}

function response() {
  const chunks: string[] = [];
  const res = new EventEmitter() as ServerResponse & {
    statusCode?: number;
    headers?: Record<string, string>;
  };
  res.writeHead = ((statusCode: number, headers: Record<string, string>) => {
    res.statusCode = statusCode;
    res.headers = headers;
    return res;
  }) as ServerResponse["writeHead"];
  res.end = ((chunk?: string) => {
    if (chunk) chunks.push(chunk);
    res.emit("finish");
    return res;
  }) as ServerResponse["end"];
  return { res, body: () => JSON.parse(chunks.join("")) };
}

describe("admin analytics API", () => {
  it("returns metric definitions without analytics table access from the browser", async () => {
    const { res, body } = response();

    await handleAdminAnalyticsApi(
      request("GET", "/api/admin/analytics/metrics"),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(res.headers?.["Cache-Control"]).toBe("no-store");
    expect(body().metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "calendarActivationRate",
          identitySemantics: "Unique people, not raw event counts.",
        }),
      ]),
    );
  });

  it("validates date ranges before querying analytics", async () => {
    const getOverview = vi.fn();
    const { res, body } = response();

    await handleAdminAnalyticsApi(
      request(
        "GET",
        "/api/admin/analytics/overview?from=2026-09-02&to=2026-09-01",
      ),
      res,
      {},
      { getOverview },
    );

    expect(res.statusCode).toBe(422);
    expect(body().error.code).toBe("VALIDATION_ERROR");
    expect(getOverview).not.toHaveBeenCalled();
  });

  it("passes normalized Africa/Harare filters into the overview repository", async () => {
    const getOverview = vi.fn(async (filters) => ({
      filters,
      refreshedAt: "2026-09-02T12:00:00.000Z",
      aggregateFreshnessMinutes: null,
      kpis: [],
      providerMix: [],
      adoptionTimeseries: [],
      funnel: [],
      operations: {
        pilotPulse: {
          uniqueTimetableViewers: 0,
          onboardingStarts: 0,
          onboardingCompletions: 0,
          calendarSubscriptionsCreated: 0,
          updateEnabledSubscriptions: 0,
          oneTimeIcsDownloads: 0,
          feedObservedSubscriptions: 0,
          shares: 0,
          activationConversion: null,
        },
        subscriberHealth: [],
        timetableTrust: [],
        classRepOperations: {
          activeClassReps: 0,
          assignedTimetables: 0,
          unassignedPublishedTimetables: 0,
          recentCorrections: 0,
        },
      },
      dataQuality: {
        eventsReceived: 0,
        uniqueAnonymousIdentities: 0,
        identitiesStitchedToSubscriptions: 0,
        consentedContactLinkageRate: 0,
        missingTimetableContext: 0,
        missingSubscriptionLinkage: 0,
        identityStitchingRate: 0,
        knownVsAnonymousRatio: 0,
        lastIngestionAt: null,
        persistenceFailures: null,
        unexpectedEventNames: [],
        knownHistoricalInstrumentationGaps: [],
      },
    }));
    const { res, body } = response();

    await handleAdminAnalyticsApi(
      request(
        "GET",
        "/api/admin/analytics/overview?from=2026-09-01&to=2026-09-02&provider=google_api",
      ),
      res,
      {},
      { getOverview },
    );

    expect(res.statusCode).toBe(200);
    expect(getOverview).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "2026-09-01",
        to: "2026-09-02",
        timezone: "Africa/Harare",
        provider: "google_api",
      }),
      {},
    );
    expect(body().filters.provider).toBe("google_api");
  });
});
