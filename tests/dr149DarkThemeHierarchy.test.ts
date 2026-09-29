import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const themeCss = readFileSync("src/dashboardTheme.css", "utf8");

describe("DR-149 dark dashboard hierarchy", () => {
  it("keeps the existing light paper contract while separating dark surface levels", () => {
    expect(themeCss).toContain("--dashboard-bg: #f7f4ec;");
    expect(themeCss).toContain("--dashboard-bg: #090d0c;");
    expect(themeCss).toContain("--dashboard-surface: #111715;");
    expect(themeCss).toContain("--dashboard-surface-2: #17201d;");
    expect(themeCss).toContain("--dashboard-surface-3: #1d2925;");
    expect(themeCss).toContain("--dashboard-input: #0d1311;");
  });

  it("raises dark text and boundary contrast without abandoning the shared semantic contract", () => {
    expect(themeCss).toContain("--dashboard-text-2: #c6d1cc;");
    expect(themeCss).toContain("--dashboard-text-3: #94a69e;");
    expect(themeCss).toContain("--dashboard-line: rgba(255, 255, 255, 0.13);");
    expect(themeCss).toContain(
      "--dashboard-line-strong: rgba(255, 255, 255, 0.22);",
    );
    expect(themeCss).toContain("--dr57-surface: var(--dashboard-surface);");
    expect(themeCss).toContain("background: var(--dashboard-surface-2);");
  });

  it("gives shared dashboard form controls an explicit keyboard focus treatment", () => {
    expect(themeCss).toContain(".czw-admin-wrap input:focus-visible");
    expect(themeCss).toContain(".czw-auth-card input:focus-visible");
    expect(themeCss).toContain("border-color: var(--dashboard-brand);");
    expect(themeCss).toContain("outline-offset: 2px;");
  });
});
