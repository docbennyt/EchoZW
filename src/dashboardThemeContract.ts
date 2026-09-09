export const DASHBOARD_THEME_STORAGE_KEY = "calenderzw.dashboard.theme";
export const DASHBOARD_THEME_EVENT = "calenderzw:dashboard-theme";

export type DashboardTheme = "light" | "dark";

type StorageLike = Pick<Storage, "getItem" | "setItem">;
type ThemeRoot = HTMLElement;

export function isDashboardPath(pathname: string) {
  return (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/dashboard" ||
    pathname.startsWith("/dashboard/")
  );
}

export function readDashboardTheme(
  storage?: StorageLike | null,
): DashboardTheme {
  if (!storage) return "light";
  try {
    return storage.getItem(DASHBOARD_THEME_STORAGE_KEY) === "dark"
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
}

export function applyDashboardTheme(
  theme: DashboardTheme,
  root: ThemeRoot = document.documentElement,
) {
  root.dataset.dashboardSurface = "true";
  root.dataset.dashboardTheme = theme;
  root.style.colorScheme = theme;
}

export function clearDashboardThemeScope(
  root: ThemeRoot = document.documentElement,
) {
  delete root.dataset.dashboardSurface;
  delete root.dataset.dashboardTheme;
  root.style.removeProperty("color-scheme");
}

export function syncDashboardThemeScope(
  pathname: string,
  storage: StorageLike | null = typeof window === "undefined"
    ? null
    : window.localStorage,
  root: ThemeRoot = document.documentElement,
) {
  if (!isDashboardPath(pathname)) {
    clearDashboardThemeScope(root);
    return null;
  }

  const theme = readDashboardTheme(storage);
  applyDashboardTheme(theme, root);
  return theme;
}

export function persistDashboardTheme(
  theme: DashboardTheme,
  storage: StorageLike | null = typeof window === "undefined"
    ? null
    : window.localStorage,
  root: ThemeRoot = document.documentElement,
) {
  try {
    storage?.setItem(DASHBOARD_THEME_STORAGE_KEY, theme);
  } catch {
    // Theme still changes for this session when storage is unavailable.
  }
  applyDashboardTheme(theme, root);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<DashboardTheme>(DASHBOARD_THEME_EVENT, { detail: theme }),
    );
  }
}
