import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const themeCss = readFileSync("src/dashboardTheme.css", "utf8");
const indexHtml = readFileSync("index.html", "utf8");
const mainSource = readFileSync("src/main.tsx", "utf8");
const appSource = readFileSync("src/AppV2.tsx", "utf8");

describe("DR-59 complete dashboard surface theming", () => {
  it("boots a light-first persisted dashboard theme before React paints", () => {
    expect(indexHtml).toContain("calenderzw.dashboard.theme");
    expect(indexHtml).toContain('theme = "light"');
    expect(indexHtml).toContain("dashboardSurface");
    expect(indexHtml).toContain("dashboardTheme");
  });

  it("keeps SPA route transitions synchronized and loads theme overrides last", () => {
    expect(mainSource).toContain("syncDashboardThemeScope(path)");
    expect(mainSource).toContain('import "./dashboardTheme.css"');
    expect(
      mainSource.lastIndexOf('import "./dashboardTheme.css"'),
    ).toBeGreaterThan(
      mainSource.lastIndexOf(
        'import "./classRepCorrectionSafetyEnhancement.css"',
      ),
    );
  });

  it("renders the shared toggle in dashboard global chrome", () => {
    expect(appSource).toContain("DashboardThemeToggle");
    expect(appSource).toContain("isDashboardPath(currentPath())");
  });

  it("themes the page shell, navigation, footer, Class Rep and Founder surfaces from one root contract", () => {
    expect(themeCss).toContain('html[data-dashboard-surface="true"]');
    expect(themeCss).toContain('[data-dashboard-theme="dark"]');
    expect(themeCss).toContain(".czw-header");
    expect(themeCss).toContain(".czw-footer");
    expect(themeCss).toContain(".class-rep-cockpit-page");
    expect(themeCss).toContain(".dr57-dialog");
    expect(themeCss).toContain(".foc-hero");
    expect(themeCss).toContain(".foc-section");
  });
});
