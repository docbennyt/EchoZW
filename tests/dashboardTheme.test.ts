import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DASHBOARD_THEME_STORAGE_KEY,
  applyDashboardTheme,
  clearDashboardThemeScope,
  isDashboardPath,
  persistDashboardTheme,
  readDashboardTheme,
  syncDashboardThemeScope,
} from "../src/dashboardTheme";

function createStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(DASHBOARD_THEME_STORAGE_KEY, initial);
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
  };
}

afterEach(() => {
  clearDashboardThemeScope(document.documentElement);
});

describe("dashboard theme contract", () => {
  it("scopes the complete staff dashboard route family without leaking to public routes", () => {
    expect(isDashboardPath("/admin")).toBe(true);
    expect(isDashboardPath("/admin/team")).toBe(true);
    expect(isDashboardPath("/admin/login")).toBe(true);
    expect(isDashboardPath("/dashboard")).toBe(true);
    expect(isDashboardPath("/dashboard/class-rep")).toBe(true);
    expect(isDashboardPath("/find")).toBe(false);
    expect(isDashboardPath("/t/hit-ics-1-1-august-semester-2026")).toBe(false);
  });

  it("defaults first-time dashboard visits to light and treats invalid stored values as light", () => {
    expect(readDashboardTheme(createStorage())).toBe("light");
    expect(readDashboardTheme(createStorage("system"))).toBe("light");
    expect(readDashboardTheme(createStorage("dark"))).toBe("dark");
  });

  it("applies persisted dark mode to the document root so portals inherit the same theme", () => {
    const root = document.createElement("div");
    const theme = syncDashboardThemeScope(
      "/admin",
      createStorage("dark"),
      root,
    );

    expect(theme).toBe("dark");
    expect(root.dataset.dashboardSurface).toBe("true");
    expect(root.dataset.dashboardTheme).toBe("dark");
    expect(root.style.colorScheme).toBe("dark");
  });

  it("clears dashboard scope when navigation leaves staff routes", () => {
    const root = document.createElement("div");
    applyDashboardTheme("dark", root);

    const result = syncDashboardThemeScope("/find", createStorage("dark"), root);

    expect(result).toBeNull();
    expect(root.dataset.dashboardSurface).toBeUndefined();
    expect(root.dataset.dashboardTheme).toBeUndefined();
    expect(root.style.colorScheme).toBe("");
  });

  it("persists an explicit choice and switches the rendered surface immediately", () => {
    const root = document.createElement("div");
    const storage = createStorage();

    persistDashboardTheme("dark", storage, root);

    expect(storage.setItem).toHaveBeenCalledWith(
      DASHBOARD_THEME_STORAGE_KEY,
      "dark",
    );
    expect(root.dataset.dashboardTheme).toBe("dark");
    expect(root.style.colorScheme).toBe("dark");
  });
});
