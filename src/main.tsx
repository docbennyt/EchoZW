import React, { useEffect, useLayoutEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { AppV2 } from "./AppV2";
import { AuthSetupPage } from "./AuthSetupPage";
import { ClassRepCorrectionSafetyEnhancement } from "./ClassRepCorrectionSafetyEnhancement";
import { syncDashboardThemeScope } from "./dashboardThemeContract";
import { FinderDemandPrompt } from "./FinderDemandPrompt";
import { GoogleCalendarConnectPage } from "./GoogleCalendarDirectConnect";
import { FeedbackPage, TimetableRequestPage } from "./GrowthCapturePages";
import { GrowthInboxPage } from "./GrowthInboxPage";
import { PilotOfferEnhancement } from "./PilotOfferEnhancement";
import { MarketingEnhancements } from "./ProductionUxEnhancements";
import { PublicTimetableReliability } from "./PublicTimetableReliability";
import { initializeInstallExperience } from "./pwa/installCapability";
import { registerCalenderZwServiceWorker } from "./pwa/serviceWorker";
import { AUTH_CONFIRM_PATH, PASSWORD_RESET_PATH } from "./authRecovery";
import { googleCalendarFailureRecoveryPath } from "./domain/googleCalendarHandoff";
import "./styles.css";
import "./appV2.css";
import "./finderDiscovery.css";
import "./publicTimetableReliability.css";
import "./publicTimetableMatrix.css";
import "./personalTimetablePreview.css";
import "./googleCalendarDirect.css";
import "./productionUxEnhancements.css";
import "./productionUxEnhancementsPatch.css";
import "./studentOnboardingAcceleration.css";
import "./growthCapturePages.css";
import "./growthInboxPage.css";
import "./timetablePublicSettingsControl.css";
import "./pilotOfferEnhancement.css";
import "./classRepCorrectionSafetyEnhancement.css";
import "./dashboardTheme.css";

function currentPath() {
  return window.location.pathname;
}

function googleTimetableSlug(path: string) {
  const match = path.match(/^\/t\/([^/]+)\/google\/?$/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function timetableSlug(path: string) {
  const match = path.match(/^\/(?:t|sync)\/([^/]+)\/?$/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function RootApp() {
  const [path, setPath] = useState(currentPath);

  useLayoutEffect(() => {
    syncDashboardThemeScope(path);
  }, [path]);
  const calendarRecoveryPath =
    path === "/find"
      ? googleCalendarFailureRecoveryPath(
          new URLSearchParams(window.location.search).get("calendar"),
          window.localStorage,
        )
      : null;

  useEffect(() => {
    const handleNavigation = () => setPath(currentPath());
    window.addEventListener("popstate", handleNavigation);
    return () => window.removeEventListener("popstate", handleNavigation);
  }, []);

  useEffect(() => {
    if (!calendarRecoveryPath) return;
    window.location.replace(calendarRecoveryPath);
  }, [calendarRecoveryPath]);

  if (calendarRecoveryPath) return null;

  if (path === PASSWORD_RESET_PATH || path === AUTH_CONFIRM_PATH) {
    return <AuthSetupPage />;
  }

  if (path === "/request" || path === "/request/") {
    return <TimetableRequestPage />;
  }

  if (path === "/feedback" || path === "/feedback/") {
    return <FeedbackPage />;
  }

  if (path === "/admin/demand" || path === "/admin/demand/") {
    return <GrowthInboxPage />;
  }

  const googleSlug = googleTimetableSlug(path);
  if (googleSlug) {
    return <GoogleCalendarConnectPage slug={googleSlug} />;
  }

  const slug = timetableSlug(path);
  if (slug) {
    return <PublicTimetableReliability slug={slug} />;
  }

  return (
    <>
      <AppV2 />
      {path === "/find" || path === "/find/" ? <FinderDemandPrompt /> : null}
      <ClassRepCorrectionSafetyEnhancement />
      <MarketingEnhancements />
      <PilotOfferEnhancement />
    </>
  );
}

initializeInstallExperience();
void registerCalenderZwServiceWorker();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RootApp />
  </React.StrictMode>,
);
