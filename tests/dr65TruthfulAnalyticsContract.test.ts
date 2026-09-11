import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseAnalyticsFilters } from "../src/domain/adminAnalytics";
import { metricDefinitionById } from "../src/domain/analyticsMetrics";

const clientAnalytics = readFileSync("src/analytics.ts", "utf8");
const repository = readFileSync("server/adminAnalyticsRepository.ts", "utf8");

describe("DR-65 truthful analytics contract", () => {
  it("keeps the historical preparation metric explicitly non-verified", () => {
    expect(metricDefinitionById("calendarActivationRate")).toMatchObject({
      name: "Historical connection preparation rate",
    });
    expect(
      metricDefinitionById("calendarActivationRate")?.limitations,
    ).toContain("Do not interpret this metric as verified activation");
    expect(
      metricDefinitionById("verifiedCalendarActivationRate"),
    ).toMatchObject({
      name: "Verified calendar activation rate",
    });
  });

  it("defines Google, feed-observed and ICS signals independently", () => {
    expect(
      metricDefinitionById("googleConnectionsCompleted")?.limitations,
    ).toContain("google_oauth_started");
    expect(
      metricDefinitionById("feedObservedSubscriptions")?.numerator,
    ).toContain("last_feed_fetch_at");
    expect(metricDefinitionById("oneTimeIcsDownloads")?.limitations).toContain(
      "Never included",
    );
  });

  it("accepts privacy-safe entry-path segmentation without query-string capture", () => {
    expect(
      parseAnalyticsFilters(
        new URLSearchParams(
          "from=2026-09-01&to=2026-09-02&entryPath=%2Ft%2Fhit-se-1&deviceKind=mobile&provider=apple_subscription",
        ),
      ),
    ).toMatchObject({
      entryPath: "/t/hit-se-1",
      deviceKind: "mobile",
      provider: "apple_subscription",
    });
    expect(clientAnalytics).toContain("window.location.pathname");
    expect(clientAnalytics).not.toContain("window.location.href");
  });

  it("derives the primary funnel without a new migration or legacy onboarding completion dependency", () => {
    expect(repository).toContain("buildTruthfulConversionFunnel");
    expect(repository).toContain('"provider_handoff_prepared"');
    expect(repository).toContain('"verified_activation"');
    const primaryFunnelBody = repository.slice(
      repository.indexOf("function buildTruthfulConversionFunnel"),
      repository.indexOf("async function getFounderOperationsOverview"),
    );
    expect(primaryFunnelBody).not.toContain('"onboarding_completed"');
    expect(repository).not.toContain("supabase/migrations/0031");
  });
});
