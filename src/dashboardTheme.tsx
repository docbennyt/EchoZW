import { Button as BaseButton } from "@base-ui/react/button";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import {
  DASHBOARD_THEME_EVENT,
  DASHBOARD_THEME_STORAGE_KEY,
  applyDashboardTheme,
  persistDashboardTheme,
  readDashboardTheme,
  type DashboardTheme,
} from "./dashboardThemeContract";

export function DashboardThemeToggle() {
  const [theme, setTheme] = useState<DashboardTheme>(() =>
    readDashboardTheme(
      typeof window === "undefined" ? null : window.localStorage,
    ),
  );

  useEffect(() => {
    applyDashboardTheme(readDashboardTheme(window.localStorage));

    const handleThemeChange = (event: Event) => {
      const detail = (event as CustomEvent<DashboardTheme>).detail;
      if (detail === "light" || detail === "dark") setTheme(detail);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== DASHBOARD_THEME_STORAGE_KEY) return;
      const next = event.newValue === "dark" ? "dark" : "light";
      applyDashboardTheme(next);
      setTheme(next);
    };
    window.addEventListener(DASHBOARD_THEME_EVENT, handleThemeChange);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(DASHBOARD_THEME_EVENT, handleThemeChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const nextTheme: DashboardTheme = theme === "light" ? "dark" : "light";
  const label = `Switch to ${nextTheme} mode`;

  return (
    <BaseButton
      aria-label={label}
      className="dashboard-theme-toggle"
      data-dashboard-theme-toggle="true"
      title={label}
      type="button"
      onClick={() => {
        persistDashboardTheme(nextTheme);
        setTheme(nextTheme);
      }}
    >
      {theme === "light" ? (
        <Moon size={17} aria-hidden="true" />
      ) : (
        <Sun size={17} aria-hidden="true" />
      )}
      <span>{theme === "light" ? "Dark" : "Light"}</span>
    </BaseButton>
  );
}
