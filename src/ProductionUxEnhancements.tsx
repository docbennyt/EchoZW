import {
  Bell,
  CalendarCheck,
  Check,
  Clock3,
  Search,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { track } from "./analytics";
import { createCalendarSubscription } from "./api/calendarSubscriptions";
import type { PublicTimetable } from "./api/pilotTypes";
import { fetchPublicTimetable } from "./api/publicTimetable";
import {
  normalizeSubscriberPhone,
  subscriberCountryOptions,
  type SubscriberContactInput,
  type SubscriberCountryCode,
} from "./domain/subscriberContact";

type ReminderPresetId = "on_time" | "prepared" | "commuter" | "custom";

type GoogleStatus = {
  enabled: boolean;
  scope: string;
};

type GoogleBridgeStage = "method" | "contact" | "busy";

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

function usePortalTargets(selector: string) {
  const [targets, setTargets] = useState<HTMLElement[]>([]);

  useEffect(() => {
    const update = () => {
      setTargets(Array.from(document.querySelectorAll<HTMLElement>(selector)));
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [selector]);

  return targets;
}

function PilotSocialProof() {
  return (
    <div
      className="czw-pilot-proof"
      aria-label="Current CalenderZW pilot activity"
    >
      <div className="czw-avatar-stack" aria-hidden="true">
        {["CS", "FA", "ENG", "BUS"].map((label) => (
          <span className="czw-proof-avatar" key={label}>
            <UserRound size={15} />
            <small>{label}</small>
          </span>
        ))}
        <span className="czw-proof-avatar czw-proof-more">+</span>
      </div>
      <div>
        <strong>18+ active calendar connections</strong>
        <span>Current HIT pilot snapshot · growing through class links</span>
      </div>
    </div>
  );
}

function StepVisual({ index }: { index: number }) {
  if (index === 0) {
    return (
      <div className="czw-step-visual czw-step-find" aria-hidden="true">
        <span className="czw-step-icon">
          <Search size={20} />
        </span>
        <div>
          <i>Institution</i>
          <i>Programme</i>
          <i>Class</i>
        </div>
      </div>
    );
  }

  if (index === 1) {
    return (
      <div className="czw-step-visual czw-step-remind" aria-hidden="true">
        <span className="czw-step-icon">
          <Bell size={20} />
        </span>
        <div>
          <i>30m</i>
          <i>24h + 30m</i>
        </div>
      </div>
    );
  }

  return (
    <div className="czw-step-visual czw-step-add" aria-hidden="true">
      <span className="czw-step-icon">
        <CalendarCheck size={20} />
      </span>
      <div>
        <i>Google</i>
        <i>Apple</i>
        <i>.ics</i>
      </div>
      <Check size={18} />
    </div>
  );
}

function GoogleMarketingCopy() {
  return (
    <>
      <p className="czw-google-live-copy">
        Connect directly with Google Calendar. CalenderZW creates a dedicated
        secondary calendar and keeps approved timetable updates synced.
      </p>
      <small className="czw-live-badge">
        <Check size={11} /> Available now
      </small>
    </>
  );
}

function ProgrammeTrustExample() {
  return (
    <div className="czw-trust-card-live">
      <div className="czw-trust-live-head">
        <span>
          <small>EXAMPLE · SCHOOL OF BUSINESS & MANAGEMENT SCIENCES</small>
          <strong>BCom Forensic Accounting · 2.1</strong>
        </span>
        <span className="czw-trust-live-status">
          <Check size={14} /> Published
        </span>
      </div>
      <div className="czw-change-row">
        <span>
          <strong>Fraud Examination</strong>
          <small>Wednesday · 10:15</small>
        </span>
        <span>
          <s>B14</s> → <b>B22</b>
        </span>
      </div>
      <p className="czw-programme-proof">
        Same workflow across programmes: your class, your timetable, your
        calendar.
      </p>
      <a href="/support">Report a problem →</a>
    </div>
  );
}

export function MarketingEnhancements() {
  const heroTarget = usePortalTarget(".czw-hero-copy-block");
  const stepTargets = usePortalTargets(".czw-step-grid article");
  const googleOptionTarget = usePortalTarget(
    "#options .czw-option-grid article:last-child",
  );
  const trustTarget = usePortalTarget(".czw-trust-card");

  useEffect(() => {
    document.body.classList.add("czw-enhanced");
    return () => document.body.classList.remove("czw-enhanced");
  }, []);

  return (
    <>
      {heroTarget ? createPortal(<PilotSocialProof />, heroTarget) : null}
      {stepTargets
        .slice(0, 3)
        .map((target, index) =>
          createPortal(<StepVisual index={index} />, target, `step-${index}`),
        )}
      {googleOptionTarget
        ? createPortal(<GoogleMarketingCopy />, googleOptionTarget)
        : null}
      {trustTarget
        ? createPortal(<ProgrammeTrustExample />, trustTarget)
        : null}
    </>
  );
}

async function fetchGoogleStatus(): Promise<GoogleStatus> {
  const response = await fetch("/api/calendar/google/status", {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) return { enabled: false, scope: "" };
  return (await response.json()) as GoogleStatus;
}

function customReminderOffset(hours: string, minutes: string) {
  const parsedHours = Number(hours || "0");
  const parsedMinutes = Number(minutes || "0");
  if (!Number.isFinite(parsedHours) || !Number.isFinite(parsedMinutes)) {
    return null;
  }
  const total = parsedHours * 60 + parsedMinutes;
  return Number.isInteger(total) && total > 0 ? total : null;
}

export function TimetableGoogleOnboardingEnhancement({
  slug,
}: {
  slug: string;
}) {
  const methodTarget = usePortalTarget(".pt-dialog .pt-method-list");
  const successTarget = usePortalTarget(".pt-primary-actions");
  const [timetable, setTimetable] = useState<PublicTimetable | null>(null);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [reminderPreset, setReminderPreset] =
    useState<ReminderPresetId>("on_time");
  const [customHours, setCustomHours] = useState("1");
  const [customMinutes, setCustomMinutes] = useState("30");
  const [stage, setStage] = useState<GoogleBridgeStage>("method");
  const [contactCountry, setContactCountry] =
    useState<SubscriberCountryCode>("ZW");
  const [contactPhone, setContactPhone] = useState("");
  const [error, setError] = useState("");

  const search = useMemo(() => new URLSearchParams(window.location.search), []);
  const connected = search.get("calendar") === "google-success";
  const failed = search.get("calendar") === "google-failed";
  const connectedSubscriptionId = search.get("subscriptionId");

  useEffect(() => {
    let active = true;
    void Promise.all([fetchPublicTimetable(slug), fetchGoogleStatus()])
      .then(([nextTimetable, status]) => {
        if (!active) return;
        setTimetable(nextTimetable);
        setGoogleEnabled(status.enabled);
      })
      .catch(() => {
        if (active) setGoogleEnabled(false);
      });
    return () => {
      active = false;
    };
  }, [slug]);

  useEffect(() => {
    const onChange = (event: Event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement)) return;
      if (input.name !== "pt-reminder") return;
      const value = input.value as ReminderPresetId;
      if (["on_time", "prepared", "commuter", "custom"].includes(value)) {
        setReminderPreset(value);
      }
    };

    const onInput = (event: Event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement)) return;
      if (!input.closest(".pt-custom-reminders")) return;
      const label = input.closest("label")?.querySelector("span")?.textContent;
      if (label?.includes("Hours")) setCustomHours(input.value);
      if (label?.includes("Minutes")) setCustomMinutes(input.value);
    };

    document.addEventListener("change", onChange, true);
    document.addEventListener("input", onInput, true);
    return () => {
      document.removeEventListener("change", onChange, true);
      document.removeEventListener("input", onInput, true);
    };
  }, []);

  useEffect(() => {
    if (!methodTarget) {
      const timer = window.setTimeout(() => {
        setStage("method");
        setError("");
      }, 0);
      return () => window.clearTimeout(timer);
    }
    methodTarget.classList.add("pt-google-bridge-active");
    return () => methodTarget.classList.remove("pt-google-bridge-active");
  }, [methodTarget]);

  useEffect(() => {
    if (!connected || !connectedSubscriptionId) return;
    const eventKey = `calenderzw_google_connected_${connectedSubscriptionId}`;
    try {
      if (window.sessionStorage.getItem(eventKey)) return;
      window.sessionStorage.setItem(eventKey, "1");
    } catch {
      // Analytics still works when storage is unavailable.
    }
    track("google_oauth_completed", {
      publicSlug: slug,
      provider: "google_api",
      subscriptionId: connectedSubscriptionId,
    });
    track("google_calendar_created", {
      publicSlug: slug,
      provider: "google_api",
      subscriptionId: connectedSubscriptionId,
    });
    track("google_calendar_sync_completed", {
      publicSlug: slug,
      provider: "google_api",
      subscriptionId: connectedSubscriptionId,
    });
  }, [connected, connectedSubscriptionId, slug]);

  useEffect(() => {
    if (!failed) return;
    track("google_oauth_failed", {
      publicSlug: slug,
      provider: "google_api",
      reason: "callback",
    });
  }, [failed, slug]);

  async function beginGoogle(subscriberContact?: SubscriberContactInput) {
    if (!timetable || !googleEnabled || stage === "busy") return;
    setStage("busy");
    setError("");

    const customOffset = customReminderOffset(customHours, customMinutes);
    if (reminderPreset === "custom" && customOffset === null) {
      setError("Enter at least one minute before class to continue.");
      setStage("contact");
      return;
    }

    try {
      const response = await createCalendarSubscription({
        timetableId: timetable.timetableId,
        provider: "google_api",
        reminderPreset,
        customReminderOffsets:
          reminderPreset === "custom" && customOffset ? [customOffset] : [],
        timezone: timetable.institutionTimezone,
        subscriberContact,
      });
      if (!response.googleConnectUrl) {
        throw new Error("Google Calendar connection is unavailable right now.");
      }
      track("google_oauth_started", {
        publicSlug: timetable.publicSlug,
        provider: "google_api",
        subscriptionId: response.subscriptionId,
        reminderPreset,
      });
      window.location.assign(response.googleConnectUrl);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Google Calendar could not be prepared. Please try again.",
      );
      setStage("contact");
    }
  }

  function saveContactAndConnect() {
    const contact: SubscriberContactInput = {
      countryCode: contactCountry,
      phone: contactPhone,
      consentUpdates: true,
      consentSource: "calendar_onboarding",
    };
    try {
      normalizeSubscriberPhone(contact);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Enter a valid phone number or continue without it.",
      );
      return;
    }
    track("phone_step_completed", {
      country: contactCountry,
      publicSlug: timetable?.publicSlug,
    });
    void beginGoogle(contact);
  }

  function selectGoogle() {
    if (!timetable || !googleEnabled) return;
    setError("");
    track("provider_selected", {
      publicSlug: timetable.publicSlug,
      provider: "google_api",
    });
    track("calendar_provider_selected", {
      publicSlug: timetable.publicSlug,
      provider: "google_api",
    });
    track("onboarding_step_completed", {
      step: "provider",
      publicSlug: timetable.publicSlug,
      provider: "google_api",
    });
    setStage("contact");
  }

  function returnToMethods() {
    setStage("method");
    setError("");
    setContactPhone("");
  }

  const providerPortal =
    methodTarget && googleEnabled
      ? createPortal(
          stage === "method" ? (
            <button
              type="button"
              className="pt-method pt-method-google-direct"
              onClick={selectGoogle}
            >
              <span className="pt-method-icon pt-method-google-icon">
                <CalendarCheck size={18} aria-hidden="true" />
              </span>
              <span className="pt-method-copy">
                <strong>Google Calendar</strong>
                <small>
                  Connect directly. CalenderZW creates a separate calendar and
                  keeps approved timetable updates synced.
                </small>
              </span>
              <em>Available now</em>
            </button>
          ) : (
            <div className="pt-google-contact-card">
              <div className="pt-google-contact-heading">
                <span className="pt-method-icon pt-method-google-icon">
                  <CalendarCheck size={18} aria-hidden="true" />
                </span>
                <div>
                  <strong>Google Calendar selected</strong>
                  <small>
                    CalenderZW only creates and manages its own secondary
                    calendar. It does not read your existing personal calendars.
                  </small>
                </div>
              </div>

              <div className="pt-google-disclosure" role="note">
                <ShieldCheck size={17} aria-hidden="true" />
                <span>
                  Google will ask for the limited permission needed to manage
                  the CalenderZW-created calendar.
                </span>
              </div>

              <div className="pt-google-optional-label">
                <span>Optional contact for important timetable updates</span>
                <small>No account is created.</small>
              </div>
              <div className="pt-google-phone-grid">
                <label>
                  <span>Country</span>
                  <select
                    value={contactCountry}
                    disabled={stage === "busy"}
                    onChange={(event) =>
                      setContactCountry(
                        event.target.value as SubscriberCountryCode,
                      )
                    }
                  >
                    {subscriberCountryOptions.map((country) => (
                      <option
                        value={country.countryCode}
                        key={country.countryCode}
                      >
                        {country.flag} {country.callingCode} {country.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Phone number</span>
                  <input
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="077 123 4567"
                    value={contactPhone}
                    disabled={stage === "busy"}
                    onChange={(event) => setContactPhone(event.target.value)}
                  />
                </label>
              </div>

              {error ? (
                <p className="pt-error" role="alert">
                  {error}
                </p>
              ) : null}

              <div className="pt-google-actions">
                <button
                  type="button"
                  className="pt-button pt-button-primary"
                  disabled={stage === "busy"}
                  onClick={saveContactAndConnect}
                >
                  {stage === "busy" ? "Opening Google…" : "Save & continue"}
                </button>
                <button
                  type="button"
                  className="pt-button pt-button-secondary"
                  disabled={stage === "busy"}
                  onClick={() => void beginGoogle()}
                >
                  Continue without phone
                </button>
                <button
                  type="button"
                  className="pt-google-back"
                  disabled={stage === "busy"}
                  onClick={returnToMethods}
                >
                  Back to calendar choices
                </button>
              </div>
            </div>
          ),
          methodTarget,
        )
      : null;

  const connectedPortal =
    successTarget && connected
      ? createPortal(
          <div className="pt-google-connected-note" role="status">
            <span>
              <Check size={16} aria-hidden="true" />
            </span>
            <div>
              <strong>Google Calendar connected</strong>
              <small>
                Future approved CalenderZW timetable updates can sync to the
                same Google calendar.
              </small>
            </div>
          </div>,
          successTarget,
        )
      : null;

  const failurePortal =
    successTarget && failed
      ? createPortal(
          <div className="pt-google-failed-note" role="alert">
            <Clock3 size={16} aria-hidden="true" />
            Google Calendar was not connected. You can retry through Subscribe
            to calendar.
          </div>,
          successTarget,
        )
      : null;

  return (
    <>
      {providerPortal}
      {connectedPortal}
      {failurePortal}
    </>
  );
}
