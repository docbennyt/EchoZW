import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { AdminGrowthInbox } from "./AdminGrowthInbox";
import { AppV2 } from "./AppV2";
import { GoogleCalendarConnectPage } from "./GoogleCalendarDirectConnect";
import { GoogleCalendarDisconnectEntry } from "./GoogleCalendarDisconnectEntry";
import { GrowthRequestDialog } from "./GrowthRequestDialog";
import {
  MarketingEnhancements,
  TimetableGoogleOnboardingEnhancement,
} from "./ProductionUxEnhancements";
import { PublicTimetableReliability } from "./PublicTimetableReliability";
import { StudentOnboardingAcceleration } from "./StudentOnboardingAcceleration";
import { googleCalendarFailureRecoveryPath } from "./domain/googleCalendarHandoff";
import "./styles.css";
import "./appV2.css";
import "./finderDiscovery.css";
import "./growthRequest.css";
import "./adminGrowthInbox.css";
import "./publicTimetableReliability.css";
import "./publicTimetableMatrix.css";
import "./googleCalendarDirect.css";
import "./productionUxEnhancements.css";
import "./productionUxEnhancementsPatch.css";
import "./studentOnboardingAcceleration.css";

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

  if (path === "/admin/growth") {
    return <AdminGrowthInbox />;
  }

  const googleSlug = googleTimetableSlug(path);
  if (googleSlug) {
    return <GoogleCalendarConnectPage slug={googleSlug} />;
  }

  const slug = timetableSlug(path);
  if (slug) {
    return (
      <>
        <PublicTimetableReliability slug={slug} />
        <TimetableGoogleOnboardingEnhancement slug={slug} />
        <StudentOnboardingAcceleration slug={slug} />
        <GoogleCalendarDisconnectEntry />
        <GrowthRequestDialog
          mode="feedback"
          seed={{ publicSlug: slug }}
          triggerClassName="czw-growth-feedback-floating"
        />
      </>
    );
  }

  return (
    <>
      <AppV2 />
      <MarketingEnhancements />
      {path === "/find" ? (
        <GrowthRequestDialog
          mode="missing_timetable"
          triggerLabel="Can’t find your class?"
          triggerClassName="czw-growth-feedback-floating"
        />
      ) : null}
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RootApp />
  </React.StrictMode>,
);
