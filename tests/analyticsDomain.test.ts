import { describe, expect, it } from "vitest";
import {
  ANALYTICS_EVENT_NAMES,
  analyticsIdentityLabel,
  classifyAnalyticsClient,
  determineAdoptionStage,
  determineIdentityStrength,
  explainEngagementScore,
  isAnalyticsUuid,
  maskPhoneE164,
  sanitizeAnalyticsProperties,
  sanitizeReferrerHost,
  shouldJoinAnalyticsIdentities,
} from "../src/domain/analytics";
import { parseAnalyticsFilters } from "../src/domain/adminAnalytics";
import { metricDefinitionById } from "../src/domain/analyticsMetrics";

describe("analytics privacy domain", () => {
  it("keeps only allowlisted primitive event properties", () => {
    expect(
      sanitizeAnalyticsProperties({
        publicSlug: "hit-ics-1-1-august-semester-2026",
        provider: "webcal_subscription",
        versionNumber: 4,
        code: "auth-code-must-never-be-stored",
        access_token: "access-token-must-never-be-stored",
        refresh_token: "refresh-token-must-never-be-stored",
        recoveryToken: "recovery-token-must-never-be-stored",
        token: "must-never-be-stored",
        password: "must-never-be-stored",
        email: "student@example.com",
        nested: { unsafe: true },
      }),
    ).toEqual({
      publicSlug: "hit-ics-1-1-august-semester-2026",
      provider: "webcal_subscription",
      versionNumber: 4,
    });
  });

  it("allows high-value discovery and attribution events without raw URLs", () => {
    expect(ANALYTICS_EVENT_NAMES).toContain("finder_search_started");
    expect(ANALYTICS_EVENT_NAMES).toContain("share_link_opened");
    expect(
      sanitizeAnalyticsProperties({
        entryPath: "/t/cs-1-1",
        referrerHost: "example.com",
        utmSource: "class-whatsapp",
        url: "https://calender.aido.co.zw/t/cs?private=token",
      }),
    ).toEqual({
      entryPath: "/t/cs-1-1",
      referrerHost: "example.com",
      utmSource: "class-whatsapp",
    });
    expect(sanitizeReferrerHost("https://Example.com/path?x=1#frag")).toBe(
      "example.com",
    );
  });

  it("recognizes UUID analytics identities", () => {
    expect(isAnalyticsUuid("4b3f08c9-78b7-4af5-9a2b-dc859fabcf63")).toBe(true);
    expect(isAnalyticsUuid("not-a-uuid")).toBe(false);
  });

  it("classifies only coarse client families", () => {
    expect(
      classifyAnalyticsClient(
        "Mozilla/5.0 (Linux; Android 15; Pixel) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36",
      ),
    ).toEqual({
      deviceKind: "mobile",
      browserFamily: "chrome",
      osFamily: "android",
    });

    expect(
      classifyAnalyticsClient(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Version/19.0 Mobile/15E148 Safari/604.1",
      ),
    ).toEqual({
      deviceKind: "mobile",
      browserFamily: "safari",
      osFamily: "ios",
    });
  });

  it("determines identity strength only from deterministic product evidence", () => {
    expect(determineIdentityStrength({ subscriptionIds: [] })).toBe(
      "anonymous",
    );
    expect(determineIdentityStrength({ subscriptionIds: ["sub-1"] })).toBe(
      "subscription_linked",
    );
    expect(
      determineIdentityStrength({
        subscriptionIds: ["sub-1"],
        hasConsentedContact: true,
      }),
    ).toBe("consented_contact_linked");
  });

  it("uses truthful founder labels for identity confidence", () => {
    expect(analyticsIdentityLabel("anonymous")).toBe("Anonymous visitor");
    expect(analyticsIdentityLabel("subscription_linked")).toBe(
      "Subscription-linked student",
    );
    expect(analyticsIdentityLabel("consented_contact_linked")).toBe(
      "Consented contact",
    );
  });

  it("joins repeat sessions only through the same persistent anonymous identity", () => {
    expect(
      shouldJoinAnalyticsIdentities({
        leftAnonymousId: "anon-1",
        rightAnonymousId: "anon-1",
      }),
    ).toBe(true);
    expect(
      shouldJoinAnalyticsIdentities({
        leftAnonymousId: "anon-1",
        rightAnonymousId: "anon-2",
      }),
    ).toBe(false);
  });

  it("joins identities through deterministic subscription and consented profile links", () => {
    expect(
      shouldJoinAnalyticsIdentities({
        leftAnonymousId: "anon-1",
        rightAnonymousId: "anon-2",
        leftSubscriptionId: "sub-1",
        rightSubscriptionId: "sub-1",
      }),
    ).toBe(true);
    expect(
      shouldJoinAnalyticsIdentities({
        leftAnonymousId: "anon-1",
        rightAnonymousId: "anon-2",
        leftSubscriberProfileId: "profile-1",
        rightSubscriberProfileId: "profile-1",
      }),
    ).toBe(true);
  });

  it("does not merge identities from heuristic similarities", () => {
    const heuristicOnlyEvidence = {
      leftAnonymousId: "anon-1",
      rightAnonymousId: "anon-2",
      ip: "203.0.113.10",
      browserFamily: "chrome",
      osFamily: "android",
      timetableId: "tt-1",
      programmeId: "programme-1",
      phoneSimilarity: "+263787...1182",
      timingCoincidence: "same-minute",
    };

    expect(shouldJoinAnalyticsIdentities(heuristicOnlyEvidence)).toBe(false);
  });

  it("determines adoption stages from explainable evidence", () => {
    expect(determineAdoptionStage({ eventNames: ["landing_viewed"] })).toBe(
      "Visitor",
    );
    expect(determineAdoptionStage({ eventNames: ["timetable_viewed"] })).toBe(
      "Timetable viewer",
    );
    expect(
      determineAdoptionStage({
        eventNames: ["timetable_viewed"],
        sessionIds: ["s1", "s2"],
      }),
    ).toBe("Engaged");
    expect(determineAdoptionStage({ eventNames: ["onboarding_opened"] })).toBe(
      "Onboarding started",
    );
    expect(determineAdoptionStage({ eventNames: ["provider_selected"] })).toBe(
      "Provider selected",
    );
    expect(
      determineAdoptionStage({
        eventNames: ["provider_selected"],
        hasActiveCalendarConnection: true,
      }),
    ).toBe("Calendar connected");
    expect(
      determineAdoptionStage({
        eventNames: ["calendar_subscription_created"],
        hasActiveCalendarConnection: true,
        hasRecentFeedOrSyncActivity: true,
      }),
    ).toBe("Active subscriber");
    expect(determineAdoptionStage({ eventNames: ["timetable_shared"] })).toBe(
      "Advocate",
    );
  });

  it("does not double-count unique person funnel facts through score semantics", () => {
    const explanation = explainEngagementScore(
      [
        "timetable_viewed",
        "calendar_cta_clicked",
        "calendar_subscription_created",
        "google_oauth_completed",
        "timetable_shared",
      ],
      ["session-a", "session-b"],
    );
    expect(explanation.score).toBe(75);
    expect(explanation.contributions).toContainEqual({
      label: "Second session",
      points: 5,
    });
  });

  it("caps engagement score and masks consented phone values", () => {
    expect(
      explainEngagementScore(Array(30).fill("calendar_subscription_created")),
    ).toMatchObject({ score: 100 });
    expect(maskPhoneE164("+263787771182")).toBe("+263787...1182");
  });

  it("validates shared analytics filters with bounded Africa/Harare semantics", () => {
    expect(
      parseAnalyticsFilters(
        new URLSearchParams("from=2026-09-01&to=2026-09-02"),
      ),
    ).toMatchObject({
      from: "2026-09-01",
      to: "2026-09-02",
      timezone: "Africa/Harare",
    });
    expect(() =>
      parseAnalyticsFilters(
        new URLSearchParams("from=2026-09-02&to=2026-09-01"),
      ),
    ).toThrow();
  });

  it("documents founder-facing metric definitions", () => {
    expect(metricDefinitionById("calendarActivationRate")).toMatchObject({
      denominator:
        "Unique analytics people who viewed a timetable in the same filtered period.",
      identitySemantics: "Unique people, not raw event counts.",
    });
  });
});
