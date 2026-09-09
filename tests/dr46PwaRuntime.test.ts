import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

describe("DR-46 PWA runtime", () => {
  it("never caches live timetable, API, calendar, admin, or auth-adjacent traffic", () => {
    const worker = source("public/sw.js");
    expect(worker).toContain('if (request.mode === "navigate") return true');
    for (const path of [
      "/api/",
      "/calendar/",
      "/sync/",
      "/admin",
      "/dashboard",
      "/t/",
    ]) {
      expect(worker).toContain(`path.startsWith("${path}")`);
    }
    expect(worker).toContain('path === "/runtime-config.js"');
    expect(worker).toContain('path.endsWith(".ics")');
    expect(worker).not.toContain("caches.match(request).then");
  });

  it("uses stable notification replacement instead of audible duplicate retries", () => {
    const worker = source("public/sw.js");
    expect(worker).toContain("tag,");
    expect(worker).toContain("renotify: false");
    expect(worker).toContain('icon: "/web-app-manifest-192x192.png"');
  });

  it("keeps timetable opt-out separate from the origin-level browser subscription", () => {
    const alerts = source("src/pwa/pushAlerts.ts");
    expect(alerts).toContain('method: "DELETE"');
    expect(alerts).toContain("Deliberately do not unsubscribe");
    expect(alerts).not.toContain("subscription.unsubscribe(");
  });

  it("shares one install-capability contract with future staff onboarding", () => {
    const install = source("src/pwa/installCapability.ts");
    expect(install).toContain('"installed"');
    expect(install).toContain('"promptable"');
    expect(install).toContain('"ios_manual"');
    expect(install).toContain('"unsupported"');
    expect(install).toContain("beforeinstallprompt");
  });
});
