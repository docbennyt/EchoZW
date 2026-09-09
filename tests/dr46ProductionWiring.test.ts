import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

describe("DR-46 production wiring", () => {
  it("registers the PWA runtime from the browser entrypoint", () => {
    const main = source("src/main.tsx");
    expect(main).toContain("initializeInstallExperience");
    expect(main).toContain("registerCalenderZwServiceWorker");
  });

  it("mounts timetable-specific urgent alerts on the public timetable", () => {
    const timetable = source("src/PublicTimetableReliability.tsx");
    expect(timetable).toContain("ChangeAlertsControl");
    expect(timetable).toContain("publicSlug={timetable.publicSlug}");
  });

  it("routes the public push API and starts/stops the delivery worker", () => {
    const server = source("server/productionServer.ts");
    expect(server).toContain("handlePushNotificationRequest");
    expect(server).toContain("startPushNotificationWorker");
    expect(server).toContain("pushNotificationWorker.stop()");
  });

  it("tracks opt-in outcomes without collecting push endpoint material", () => {
    const analytics = source("src/domain/analytics.ts");
    for (const event of [
      "push_alert_cta_clicked",
      "push_alert_enabled",
      "push_alert_disabled",
      "push_alert_permission_denied",
    ]) {
      expect(analytics).toContain(`"${event}"`);
    }
    expect(analytics).toContain("push|endpoint|vapid");
  });
});
