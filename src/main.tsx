import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { AppV2 } from "./AppV2";
import {
  GoogleCalendarConnectPage,
  GoogleCalendarDirectEntry,
} from "./GoogleCalendarDirectConnect";
import { PublicTimetableReliability } from "./PublicTimetableReliability";
import "./styles.css";
import "./appV2.css";
import "./finderDiscovery.css";
import "./publicTimetableReliability.css";
import "./publicTimetableMatrix.css";
import "./googleCalendarDirect.css";

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

  useEffect(() => {
    const handleNavigation = () => setPath(currentPath());
    window.addEventListener("popstate", handleNavigation);
    return () => window.removeEventListener("popstate", handleNavigation);
  }, []);

  const googleSlug = googleTimetableSlug(path);
  if (googleSlug) {
    return <GoogleCalendarConnectPage slug={googleSlug} />;
  }

  const slug = timetableSlug(path);
  if (slug) {
    return (
      <>
        <PublicTimetableReliability slug={slug} />
        <GoogleCalendarDirectEntry slug={slug} />
      </>
    );
  }

  return <AppV2 />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RootApp />
  </React.StrictMode>,
);
