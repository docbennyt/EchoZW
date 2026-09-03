import { CalendarCheck, Check, ExternalLink, Smartphone } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { track } from "./analytics";

export const GOOGLE_CALENDAR_HOME_URL =
  "https://calendar.google.com/calendar/r";

function usePortalTarget(selector: string) {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const update = () => {
      setTarget(document.querySelector<HTMLElement>(selector));
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [selector]);

  return target;
}

export function googleCalendarHandoffKey(subscriptionId: string | null) {
  return `calenderzw_google_calendar_handoff_${subscriptionId || "unknown"}`;
}

export function shouldAutoOpenGoogleCalendar(
  subscriptionId: string | null,
  storage: Pick<Storage, "getItem" | "setItem"> | null,
) {
  if (!storage) return true;
  const key = googleCalendarHandoffKey(subscriptionId);
  try {
    if (storage.getItem(key)) return false;
    storage.setItem(key, "1");
    return true;
  } catch {
    return true;
  }
}

function GoogleCalendarHandoff({
  slug,
  subscriptionId,
}: {
  slug: string;
  subscriptionId: string | null;
}) {
  const [autoOpening, setAutoOpening] = useState(true);

  useEffect(() => {
    track("calendar_success_viewed", {
      publicSlug: slug,
      provider: "google_api",
      subscriptionId,
    });

    const storage = typeof window !== "undefined" ? window.sessionStorage : null;
    const shouldOpen = shouldAutoOpenGoogleCalendar(subscriptionId, storage);
    setAutoOpening(shouldOpen);
    if (!shouldOpen) return;

    const timer = window.setTimeout(() => {
      window.location.assign(GOOGLE_CALENDAR_HOME_URL);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [slug, subscriptionId]);

  return (
    <div className="czw-google-handoff" role="dialog" aria-modal="true">
      <div className="czw-google-handoff-card">
        <span className="czw-google-handoff-icon" aria-hidden="true">
          <Check size={26} />
        </span>
        <span className="pt-kicker">Calendar connected</span>
        <h1>Your timetable is in Google Calendar.</h1>
        <p>
          CalenderZW created a dedicated calendar and synced your current
          classes. Future approved timetable changes can update the same
          calendar.
        </p>

        <a
          className="pt-button pt-button-primary czw-google-open-calendar"
          href={GOOGLE_CALENDAR_HOME_URL}
          onClick={() =>
            track("calendar_setup_help_opened", {
              publicSlug: slug,
              provider: "google_api",
              source: "google_success_open_calendar",
            })
          }
        >
          <ExternalLink size={18} aria-hidden="true" />
          Open Google Calendar
        </a>

        {autoOpening ? (
          <div className="czw-google-opening" role="status">
            <CalendarCheck size={16} aria-hidden="true" />
            Opening your calendar…
          </div>
        ) : null}

        <details className="czw-samsung-calendar-help">
          <summary>
            <Smartphone size={16} aria-hidden="true" />
            Using Samsung Calendar?
          </summary>
          <p>
            The CalenderZW calendar belongs to the Google account you just
            connected. Open Samsung Calendar, open its calendar list, and make
            sure the CalenderZW calendar under that Google account is enabled.
          </p>
        </details>

        <a className="czw-google-back-timetable" href={`/t/${encodeURIComponent(slug)}`}>
          Back to timetable
        </a>
      </div>
    </div>
  );
}

function FastGoogleContactChoice({
  target,
  slug,
}: {
  target: HTMLElement;
  slug: string;
}) {
  const [showPhone, setShowPhone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    target.classList.add("czw-google-fast-track");
    target.classList.toggle("czw-google-phone-open", showPhone);
    return () => {
      target.classList.remove("czw-google-fast-track");
      target.classList.remove("czw-google-phone-open");
    };
  }, [showPhone, target]);

  function clickOriginal(selector: string) {
    const button = target.querySelector<HTMLButtonElement>(selector);
    if (!button || button.disabled) return;
    setBusy(true);
    button.click();
    window.setTimeout(() => setBusy(false), 4500);
  }

  function continueWithoutPhone() {
    track("onboarding_step_completed", {
      step: "contact_optional",
      status: "skipped",
      provider: "google_api",
      publicSlug: slug,
    });
    clickOriginal(".pt-google-actions .pt-button-secondary");
  }

  function savePhone() {
    clickOriginal(".pt-google-actions .pt-button-primary");
  }

  return createPortal(
    <>
      <div className="czw-google-fast-copy">
        <strong>Phone number is optional.</strong>
        <span>Connect your calendar now. Add a number only if you want direct timetable alerts.</span>
      </div>
      <button
        type="button"
        className="pt-button pt-button-primary czw-google-fast-continue"
        disabled={busy}
        onClick={continueWithoutPhone}
      >
        <ExternalLink size={18} aria-hidden="true" />
        {busy ? "Opening Google…" : "Continue to Google"}
      </button>
      <button
        type="button"
        className="czw-google-phone-toggle"
        aria-expanded={showPhone}
        disabled={busy}
        onClick={() => setShowPhone((current) => !current)}
      >
        <Smartphone size={16} aria-hidden="true" />
        {showPhone
          ? "Hide optional phone"
          : "Optional: add phone for important alerts"}
      </button>
      {showPhone ? (
        <button
          type="button"
          className="pt-button pt-button-primary czw-google-phone-save"
          disabled={busy}
          onClick={savePhone}
        >
          {busy ? "Opening Google…" : "Save phone & continue to Google"}
        </button>
      ) : null}
    </>,
    target,
  );
}

export function StudentOnboardingAcceleration({ slug }: { slug: string }) {
  const contactTarget = usePortalTarget(".pt-google-contact-card");
  const search = useMemo(() => new URLSearchParams(window.location.search), []);
  const googleSuccess = search.get("calendar") === "google-success";
  const subscriptionId = search.get("subscriptionId");

  return (
    <>
      {contactTarget ? (
        <FastGoogleContactChoice target={contactTarget} slug={slug} />
      ) : null}
      {googleSuccess ? (
        <GoogleCalendarHandoff slug={slug} subscriptionId={subscriptionId} />
      ) : null}
    </>
  );
}
