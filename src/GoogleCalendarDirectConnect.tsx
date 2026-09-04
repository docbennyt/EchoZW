import {
  CalendarCheck,
  ChevronLeft,
  ExternalLink,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { track } from "./analytics";
import { createCalendarSubscription } from "./api/calendarSubscriptions";
import type { PublicTimetable } from "./api/pilotTypes";
import { fetchPublicTimetable } from "./api/publicTimetable";
import { PublicShell } from "./components/site/SiteChrome";
import { rememberGoogleCalendarReturnSlug } from "./domain/googleCalendarHandoff";
import { formatClassGroupLabel } from "./domain/publicTimetable";

type ReminderPresetId = "on_time" | "prepared" | "commuter";

type GoogleStatus = {
  enabled: boolean;
  scope: string;
};

const reminderOptions: Array<{
  id: ReminderPresetId;
  title: string;
  detail: string;
}> = [
  { id: "on_time", title: "On time", detail: "30 minutes before" },
  {
    id: "prepared",
    title: "Prepared",
    detail: "24 hours + 30 minutes before",
  },
  {
    id: "commuter",
    title: "Commuter",
    detail: "60 minutes + 15 minutes before",
  },
];

async function fetchGoogleStatus(): Promise<GoogleStatus> {
  const response = await fetch("/api/calendar/google/status", {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) return { enabled: false, scope: "" };
  return (await response.json()) as GoogleStatus;
}

function googleConnectPath(slug: string) {
  return `/t/${encodeURIComponent(slug)}/google`;
}

export function GoogleCalendarDirectEntry({ slug }: { slug: string }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [enabled, setEnabled] = useState(false);
  const search = new URLSearchParams(window.location.search);
  const connected = search.get("calendar") === "google-success";
  const failed = search.get("calendar") === "google-failed";
  const subscriptionId = search.get("subscriptionId");

  useEffect(() => {
    let active = true;
    void fetchGoogleStatus().then((status) => {
      if (active) setEnabled(status.enabled);
    });
    const findTarget = () => {
      const nextTarget = document.querySelector<HTMLElement>(
        ".pt-primary-actions",
      );
      if (nextTarget) setTarget(nextTarget);
    };
    findTarget();
    const observer = new MutationObserver(findTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      active = false;
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (connected) {
      track("google_oauth_completed", {
        publicSlug: slug,
        provider: "google_api",
        subscriptionId,
      });
      track("google_calendar_created", {
        publicSlug: slug,
        provider: "google_api",
        subscriptionId,
      });
      track("google_calendar_sync_completed", {
        publicSlug: slug,
        provider: "google_api",
        subscriptionId,
      });
    } else if (failed) {
      track("google_oauth_failed", {
        publicSlug: slug,
        provider: "google_api",
        reason: "callback",
      });
    }
  }, [connected, failed, slug, subscriptionId]);

  if (!target) return null;

  return createPortal(
    <>
      {enabled ? (
        <a
          className="pt-button pt-button-google"
          href={googleConnectPath(slug)}
          aria-label="Add this timetable directly to Google Calendar"
          onClick={() =>
            track("calendar_provider_selected", {
              publicSlug: slug,
              provider: "google_api",
            })
          }
        >
          <CalendarCheck size={18} aria-hidden="true" />
          Add to Google Calendar
        </a>
      ) : null}
      {connected ? (
        <p className="gcal-inline-status" role="status">
          <ShieldCheck size={16} aria-hidden="true" />
          Google Calendar connected. Future CalenderZW timetable corrections can
          update this calendar.
        </p>
      ) : null}
      {failed ? (
        <p className="gcal-inline-error" role="alert">
          Google Calendar could not be connected. Your timetable and other
          calendar options still work normally.
        </p>
      ) : null}
    </>,
    target,
  );
}

export function GoogleCalendarConnectPage({ slug }: { slug: string }) {
  const [timetable, setTimetable] = useState<PublicTimetable | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [reminderPreset, setReminderPreset] =
    useState<ReminderPresetId>("on_time");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void Promise.all([fetchPublicTimetable(slug), fetchGoogleStatus()])
      .then(([nextTimetable, google]) => {
        if (!active) return;
        setTimetable(nextTimetable);
        setGoogleEnabled(google.enabled);
        setStatus("ready");
        track("calendar_success_viewed", {
          publicSlug: nextTimetable.publicSlug,
          provider: "google_api",
          status: google.enabled ? "enabled" : "disabled",
        });
      })
      .catch(() => {
        if (active) setStatus("error");
      });
    return () => {
      active = false;
    };
  }, [slug]);

  const title = useMemo(() => {
    if (!timetable) return "Connect Google Calendar";
    return `${formatClassGroupLabel(timetable.classGroup)} → Google Calendar`;
  }, [timetable]);

  useEffect(() => {
    document.title = `${title} | CalenderZW`;
  }, [title]);

  async function connect() {
    if (!timetable || !googleEnabled || busy) return;
    setBusy(true);
    setError("");
    rememberGoogleCalendarReturnSlug(timetable.publicSlug, window.localStorage);
    track("google_oauth_started", {
      publicSlug: timetable.publicSlug,
      provider: "google_api",
      reminderPreset,
    });
    try {
      const response = await createCalendarSubscription({
        timetableId: timetable.timetableId,
        provider: "google_api",
        reminderPreset,
        customReminderOffsets: [],
        timezone: timetable.institutionTimezone,
      });
      if (!response.googleConnectUrl) {
        throw new Error(
          "Google Calendar connection is not available right now.",
        );
      }
      window.location.assign(response.googleConnectUrl);
    } catch (caught) {
      track("google_oauth_failed", {
        publicSlug: timetable.publicSlug,
        provider: "google_api",
        reason: "subscription_create",
      });
      setError(
        caught instanceof Error
          ? caught.message
          : "Google Calendar could not be connected. Please try again.",
      );
      setBusy(false);
    }
  }

  if (status === "loading") {
    return (
      <PublicShell compactFooter className="gcal-page">
        <main className="gcal-shell">
          <section className="gcal-card" aria-live="polite">
            <CalendarCheck size={30} aria-hidden="true" />
            <h1>Preparing Google Calendar</h1>
            <p>Loading the current published timetable.</p>
          </section>
        </main>
      </PublicShell>
    );
  }

  if (status === "error" || !timetable) {
    return (
      <PublicShell compactFooter className="gcal-page">
        <main className="gcal-shell">
          <section className="gcal-card">
            <h1>Timetable unavailable</h1>
            <p>Open the public timetable and try again.</p>
            <a
              className="pt-button pt-button-primary"
              href={`/t/${encodeURIComponent(slug)}`}
            >
              Back to timetable
            </a>
          </section>
        </main>
      </PublicShell>
    );
  }

  return (
    <PublicShell compactFooter className="gcal-page">
      <main className="gcal-shell">
        <a className="gcal-back" href={`/t/${encodeURIComponent(slug)}`}>
          <ChevronLeft size={17} aria-hidden="true" />
          Back to timetable
        </a>

        <section className="gcal-card" aria-labelledby="gcal-title">
          <div className="gcal-heading">
            <span>GOOGLE CALENDAR</span>
            <h1 id="gcal-title">Add this timetable directly</h1>
            <p>
              {timetable.institution} · {timetable.programme} ·{" "}
              {formatClassGroupLabel(timetable.classGroup)} ·{" "}
              {timetable.academicPeriod}
            </p>
          </div>

          <div className="gcal-disclosure" role="note">
            <ShieldCheck size={22} aria-hidden="true" />
            <div>
              <strong>CalenderZW only manages the calendar it creates.</strong>
              <p>
                Google will let CalenderZW create a separate secondary calendar,
                add this class timetable, apply your chosen reminders, and
                update or remove only CalenderZW-created timetable events when
                the published timetable changes. CalenderZW does not read,
                analyse, edit, or delete events in your existing personal
                calendars.
              </p>
            </div>
          </div>

          <fieldset className="gcal-reminders">
            <legend>Choose reminders</legend>
            {reminderOptions.map((option) => (
              <label key={option.id}>
                <input
                  type="radio"
                  name="gcal-reminder"
                  value={option.id}
                  checked={reminderPreset === option.id}
                  onChange={() => setReminderPreset(option.id)}
                />
                <span>
                  <strong>{option.title}</strong>
                  <small>{option.detail}</small>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="gcal-permissions">
            <h2>What happens next</h2>
            <ol>
              <li>You continue to Google's consent screen.</li>
              <li>You approve CalenderZW's limited calendar permission.</li>
              <li>CalenderZW creates a dedicated secondary calendar.</li>
              <li>
                Future approved timetable corrections are pushed to the same
                calendar without creating a second calendar.
              </li>
            </ol>
          </div>

          {!googleEnabled ? (
            <p className="gcal-inline-error" role="alert">
              Direct Google Calendar connection is temporarily unavailable. Use
              the subscribed-calendar URL or one-time ICS option from the
              timetable instead.
            </p>
          ) : null}
          {error ? (
            <p className="gcal-inline-error" role="alert">
              {error}
            </p>
          ) : null}

          <button
            type="button"
            className="pt-button pt-button-primary gcal-continue"
            disabled={!googleEnabled || busy}
            onClick={() => void connect()}
          >
            <ExternalLink size={18} aria-hidden="true" />
            {busy ? "Opening Google…" : "Continue to Google"}
          </button>

          <p className="gcal-legal-copy">
            By continuing, you choose to connect Google Calendar for this
            timetable. You can disconnect later. Read our{" "}
            <a href="/privacy">Privacy Policy</a>, <a href="/terms">Terms</a>,
            and <a href="/data-deletion">Data deletion</a> guidance.
          </p>
        </section>
      </main>
    </PublicShell>
  );
}
