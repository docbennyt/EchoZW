import {
  CalendarCheck,
  Clock3,
  Copy,
  Download,
  ExternalLink,
  Link2,
  MapPin,
  Share2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { track } from "./analytics";
import { createCalendarSubscription } from "./api/calendarSubscriptions";
import type { PublicTimetable } from "./api/pilotTypes";
import { fetchPublicTimetable } from "./api/publicTimetable";
import { PublicShell } from "./components/site/SiteChrome";
import { GoogleCalendarDisconnectEntry } from "./GoogleCalendarDisconnectEntry";
import { PersonalTimetablePreview } from "./PersonalTimetablePreview";
import { ChangeAlertsControl } from "./pwa/ChangeAlertsControl";
import {
  detectCalendarPlatform,
  orderedCalendarDestinations,
  type CalendarDestination,
} from "./domain/device";
import {
  formatClassGroupLabel,
  formatOccurrenceTime,
  formatPublishedTimestamp,
  getUpcomingOccurrences,
} from "./domain/publicTimetable";
import {
  projectPublishedTimetable,
  type CanonicalPublishedCalendarEvent,
} from "./domain/publishedCalendarProjection";
import type { CreateSubscriptionResponse } from "./domain/subscriptions";
import { getTomorrowSchedule } from "./domain/tomorrowSchedule";
import {
  GOOGLE_CALENDAR_HOME_URL,
  rememberGoogleCalendarReturnSlug,
  shouldAutoOpenGoogleCalendar,
} from "./domain/googleCalendarHandoff";
import {
  buildClassSharePayload,
  readClassShareSource,
  type ClassShareSource,
} from "./domain/shareAttribution";

const weekdayLabels = [
  "",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

const courseToneClasses = [
  "tone-sage",
  "tone-gold",
  "tone-blue",
  "tone-coral",
  "tone-lavender",
  "tone-teal",
  "tone-orange",
] as const;

type ReminderPresetId = "on_time" | "prepared" | "commuter" | "custom";
type PublicCalendarProvider =
  "google_api" | "apple_subscription" | "webcal_subscription" | "ics_download";

type CalendarDelivery = {
  provider: PublicCalendarProvider;
  response: CreateSubscriptionResponse;
};

type OnboardingStep =
  "reminders" | "provider" | "preparing" | "provider_result";

const reminderChoices: Array<{
  id: ReminderPresetId;
  title: string;
  detail: string;
  hint?: string;
}> = [
  {
    id: "on_time",
    title: "On time",
    detail: "30 minutes before",
    hint: "Recommended",
  },
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
  {
    id: "custom",
    title: "Custom",
    detail: "Choose your own reminder",
  },
];

function providerDestination(
  provider: PublicCalendarProvider,
): CalendarDestination {
  if (provider === "apple_subscription") return "apple";
  if (provider === "google_api") return "google";
  return "advanced";
}

function ProviderMark({ provider }: { provider: "apple" | "google" }) {
  return (
    <span
      className={`pt-provider-mark pt-provider-mark-${provider}`}
      aria-hidden="true"
    >
      <CalendarCheck size={18} />
    </span>
  );
}

async function fetchGoogleStatus() {
  try {
    const response = await fetch("/api/calendar/google/status", {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { enabled?: boolean };
    return body.enabled === true;
  } catch {
    return false;
  }
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  const copied = document.execCommand?.("copy");
  input.remove();
  if (!copied) throw new Error("Clipboard copy is unavailable.");
}

function triggerCalendarDownload(url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.rel = "noreferrer";
  link.target = "_blank";
  document.body.append(link);
  link.click();
  link.remove();
}

function getFocusableElements(root: HTMLElement | null) {
  if (!root) return [];
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute("hidden"));
}

function localTimeLabel(value: string) {
  return value.slice(0, 5);
}

export function courseToneClass(courseCode: string) {
  let hash = 0;
  for (const character of courseCode.trim().toUpperCase()) {
    hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  }
  return courseToneClasses[hash % courseToneClasses.length];
}

function LoadingPage() {
  return (
    <PublicShell compactFooter className="pt-app">
      <main className="pt-shell pt-main">
        <section className="pt-state-page" aria-live="polite">
          <CalendarCheck size={30} />
          <h1>Loading timetable</h1>
          <p>Fetching the current published version.</p>
        </section>
      </main>
    </PublicShell>
  );
}

function ErrorPage() {
  return (
    <PublicShell compactFooter className="pt-app">
      <main className="pt-shell pt-main">
        <section className="pt-state-page">
          <CalendarCheck size={30} />
          <h1>Timetable unavailable</h1>
          <p>
            This class timetable is not currently available as a published
            version.
          </p>
          <a className="pt-button pt-button-primary" href="/find">
            Find another timetable
          </a>
        </section>
      </main>
    </PublicShell>
  );
}

function SessionCard({ event }: { event: CanonicalPublishedCalendarEvent }) {
  return (
    <article className={`pt-session ${courseToneClass(event.courseCode)}`}>
      <time>
        {localTimeLabel(event.startTime)}–{localTimeLabel(event.endTime)}
      </time>
      <div className="pt-session-copy">
        <strong>{event.courseCode}</strong>
        <h4>{event.courseName}</h4>
        <span>
          {event.venue || "Venue not set"}
          {event.lecturer ? ` · ${event.lecturer}` : ""}
        </span>
      </div>
    </article>
  );
}

export function PublicTimetableReliability({ slug }: { slug: string }) {
  const [timetable, setTimetable] = useState<PublicTimetable | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reminderPreset, setReminderPreset] =
    useState<ReminderPresetId>("on_time");
  const [customHours, setCustomHours] = useState("1");
  const [customMinutes, setCustomMinutes] = useState("30");
  const [calendarBusy, setCalendarBusy] =
    useState<PublicCalendarProvider | null>(null);
  const [calendarError, setCalendarError] = useState("");
  const [calendarDelivery, setCalendarDelivery] =
    useState<CalendarDelivery | null>(null);
  const [onboardingStep, setOnboardingStep] =
    useState<OnboardingStep>("reminders");
  const [copyStatus, setCopyStatus] = useState("");
  const [shareStatus, setShareStatus] = useState("");
  const [isPrimaryVisible, setIsPrimaryVisible] = useState(true);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 820);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const primaryCtaRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onboardingCompletionTrackedRef = useRef(false);
  const trackedReminderPresetsRef = useRef(new Set<ReminderPresetId>());
  const reminderStepCompletedRef = useRef(false);
  const calendarActionLockRef = useRef(false);
  const googleSearch = useMemo(
    () => new URLSearchParams(window.location.search),
    [],
  );
  const googleSuccess = googleSearch.get("calendar") === "google-success";
  const googleFailed = googleSearch.get("calendar") === "google-failed";
  const googleSubscriptionId = googleSearch.get("subscriptionId");

  useEffect(() => {
    let active = true;
    async function load() {
      setStatus("loading");
      try {
        const result = await fetchPublicTimetable(slug);
        if (!active) return;
        setTimetable(result);
        setStatus("ready");
        track("timetable_viewed", { publicSlug: result.publicSlug });
      } catch {
        if (active) setStatus("error");
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [slug]);

  useEffect(() => {
    let active = true;
    void fetchGoogleStatus().then((enabled) => {
      if (active) setGoogleEnabled(enabled);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!timetable) return;
    document.title = `${timetable.institutionShortName || timetable.institution} · ${formatClassGroupLabel(timetable.classGroup)} | CalenderZW`;
  }, [timetable]);

  const projection = useMemo(() => {
    if (!timetable) return null;
    try {
      return projectPublishedTimetable({
        timetable,
        reminderOffsetsMinutes: [],
        publicOrigin: window.location.origin,
      });
    } catch {
      return null;
    }
  }, [timetable]);

  const groupedEvents = useMemo(() => {
    const map = new Map<number, CanonicalPublishedCalendarEvent[]>();
    for (let weekday = 1; weekday <= 7; weekday += 1) map.set(weekday, []);
    for (const event of projection?.events ?? []) {
      map.get(event.weekday)?.push(event);
    }
    for (const events of map.values()) {
      events.sort((left, right) =>
        left.startTime.localeCompare(right.startTime),
      );
    }
    return map;
  }, [projection]);

  const activeWeekdays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) => index + 1).filter(
        (weekday) => (groupedEvents.get(weekday)?.length ?? 0) > 0,
      ),
    [groupedEvents],
  );

  const matrixStartTimes = useMemo(
    () =>
      Array.from(
        new Set((projection?.events ?? []).map((event) => event.startTime)),
      ).sort((left, right) => left.localeCompare(right)),
    [projection],
  );

  const upcoming = useMemo(
    () => (timetable ? getUpcomingOccurrences(timetable, new Date(), 3) : []),
    [timetable],
  );
  const nextClass = upcoming[0] ?? null;
  const tomorrow = useMemo(
    () => (timetable ? getTomorrowSchedule(timetable, new Date()) : null),
    [timetable],
  );
  const calendarPlatform = useMemo(
    () =>
      detectCalendarPlatform(
        window.navigator.userAgent,
        window.navigator.maxTouchPoints ?? 0,
      ),
    [],
  );
  const calendarDestinations = useMemo(
    () => orderedCalendarDestinations(calendarPlatform),
    [calendarPlatform],
  );
  const publicUrl = timetable
    ? `${window.location.origin}/t/${encodeURIComponent(timetable.publicSlug)}`
    : "";
  const shareSource = useMemo(
    () => readClassShareSource(window.location.href),
    [],
  );
  const customReminderOffset = useMemo(() => {
    const hours = Number(customHours.trim() || "0");
    const minutes = Number(customMinutes.trim() || "0");
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    if (hours < 0 || minutes < 0) return null;
    const total = hours * 60 + minutes;
    return Number.isInteger(total) && total > 0 ? total : null;
  }, [customHours, customMinutes]);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 820);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const target = primaryCtaRef.current;
    if (!target || !timetable) return;

    if (typeof IntersectionObserver !== "undefined") {
      const observer = new IntersectionObserver(
        ([entry]) => setIsPrimaryVisible(Boolean(entry?.isIntersecting)),
        { threshold: 0.15 },
      );
      observer.observe(target);
      return () => observer.disconnect();
    }

    const update = () => {
      const rect = target.getBoundingClientRect();
      setIsPrimaryVisible(rect.bottom > 0 && rect.top < window.innerHeight);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [timetable]);

  useEffect(() => {
    if (!dialogOpen) return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : primaryCtaRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      getFocusableElements(dialogRef.current)[0]?.focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setDialogOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = getFocusableElements(dialogRef.current);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      window.setTimeout(() => previousFocusRef.current?.focus(), 0);
    };
  }, [dialogOpen]);

  useEffect(() => {
    if (!dialogOpen || !timetable) return;
    track("onboarding_step_viewed", {
      step: onboardingStep,
      publicSlug: timetable.publicSlug,
    });
  }, [dialogOpen, onboardingStep, timetable]);

  useEffect(() => {
    if (!timetable || !shareSource) return;
    track("shared_link_opened", {
      publicSlug: timetable.publicSlug,
      source: shareSource,
    });
  }, [shareSource, timetable]);

  useEffect(() => {
    if (!googleSuccess || !timetable) return;

    track("calendar_success_viewed", {
      publicSlug: timetable.publicSlug,
      provider: "google_api",
      subscriptionId: googleSubscriptionId,
    });

    if (googleSubscriptionId) {
      const eventKey = `calenderzw_google_connected_${googleSubscriptionId}`;
      let alreadyTracked = false;
      try {
        alreadyTracked = window.sessionStorage.getItem(eventKey) === "1";
        if (!alreadyTracked) window.sessionStorage.setItem(eventKey, "1");
      } catch {
        // Connection UX must remain functional when storage is unavailable.
      }
      if (!alreadyTracked) {
        track("google_oauth_completed", {
          publicSlug: timetable.publicSlug,
          provider: "google_api",
          subscriptionId: googleSubscriptionId,
        });
        track("google_calendar_created", {
          publicSlug: timetable.publicSlug,
          provider: "google_api",
          subscriptionId: googleSubscriptionId,
        });
        track("google_calendar_sync_completed", {
          publicSlug: timetable.publicSlug,
          provider: "google_api",
          subscriptionId: googleSubscriptionId,
        });
        track("onboarding_completed", {
          publicSlug: timetable.publicSlug,
          provider: "google_api",
          subscriptionId: googleSubscriptionId,
        });
      }
    }

    const storage = window.sessionStorage;
    if (!shouldAutoOpenGoogleCalendar(googleSubscriptionId, storage)) return;
    const timer = window.setTimeout(() => {
      window.location.replace(GOOGLE_CALENDAR_HOME_URL);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [googleSuccess, googleSubscriptionId, timetable]);

  useEffect(() => {
    if (!googleFailed || !timetable) return;
    track("google_oauth_failed", {
      publicSlug: timetable.publicSlug,
      provider: "google_api",
      reason: "callback",
    });
  }, [googleFailed, timetable]);

  const closeDialog = useCallback(() => {
    if (dialogOpen && timetable && onboardingStep !== "provider_result") {
      track("onboarding_abandoned", {
        step: onboardingStep,
        publicSlug: timetable.publicSlug,
      });
    }
    setDialogOpen(false);
  }, [dialogOpen, onboardingStep, timetable]);

  const openDialog = useCallback(() => {
    onboardingCompletionTrackedRef.current = false;
    setCalendarError("");
    setCopyStatus("");
    setShareStatus("");
    setCalendarDelivery(null);
    calendarActionLockRef.current = false;
    trackedReminderPresetsRef.current.clear();
    reminderStepCompletedRef.current = false;
    setOnboardingStep("reminders");
    setDialogOpen(true);
    track("calendar_cta_clicked", { publicSlug: timetable?.publicSlug });
    track("onboarding_opened", { publicSlug: timetable?.publicSlug });
    if (shareSource) {
      track("shared_link_onboarding_started", {
        publicSlug: timetable?.publicSlug,
        source: shareSource,
      });
    }
  }, [shareSource, timetable?.publicSlug]);

  function trackReminderChoice(
    preset: ReminderPresetId,
    customMinutesValue: number | null = null,
  ) {
    if (!timetable) return;
    if (!trackedReminderPresetsRef.current.has(preset)) {
      trackedReminderPresetsRef.current.add(preset);
      track("reminder_selected", {
        preset,
        customMinutes: preset === "custom" ? customMinutesValue : null,
        publicSlug: timetable.publicSlug,
      });
    }
    if (!reminderStepCompletedRef.current) {
      reminderStepCompletedRef.current = true;
      track("onboarding_step_completed", {
        step: "reminders",
        publicSlug: timetable.publicSlug,
        reminderPreset: preset,
        customMinutes: preset === "custom" ? customMinutesValue : null,
      });
    }
  }

  function chooseReminder(preset: ReminderPresetId) {
    setReminderPreset(preset);
    setCalendarError("");
    if (preset === "custom") {
      if (!trackedReminderPresetsRef.current.has("custom") && timetable) {
        trackedReminderPresetsRef.current.add("custom");
        track("reminder_selected", {
          preset: "custom",
          publicSlug: timetable.publicSlug,
        });
      }
      return;
    }
    trackReminderChoice(preset);
    setOnboardingStep("provider");
  }

  function saveCustomReminder() {
    if (customReminderOffset === null) {
      setCalendarError("Enter at least one minute before class to continue.");
      return;
    }
    setCalendarError("");
    trackReminderChoice("custom", customReminderOffset);
    setOnboardingStep("provider");
  }

  function trackDurableCompletion(
    provider: PublicCalendarProvider,
    response: CreateSubscriptionResponse,
  ) {
    if (!timetable || onboardingCompletionTrackedRef.current) return;
    onboardingCompletionTrackedRef.current = true;
    track("onboarding_completed", {
      publicSlug: timetable.publicSlug,
      provider,
      reminderPreset,
      subscriptionId: response.subscriptionId,
    });
    if (shareSource) {
      track("shared_link_onboarding_completed", {
        publicSlug: timetable.publicSlug,
        source: shareSource,
      });
    }
  }

  function selectProvider(provider: PublicCalendarProvider) {
    void prepareCalendar(provider);
  }

  async function prepareCalendar(provider: PublicCalendarProvider) {
    if (!timetable || calendarActionLockRef.current) return;
    calendarActionLockRef.current = true;
    setCalendarBusy(provider);
    setCalendarError("");
    track("provider_selected", {
      publicSlug: timetable.publicSlug,
      provider,
      destination: providerDestination(provider),
    });
    track("calendar_provider_selected", {
      publicSlug: timetable.publicSlug,
      provider,
    });
    track("onboarding_step_completed", {
      step: "provider",
      publicSlug: timetable.publicSlug,
      provider,
    });
    setOnboardingStep("preparing");
    try {
      const response = await createCalendarSubscription({
        timetableId: timetable.timetableId,
        provider,
        reminderPreset,
        customReminderOffsets:
          reminderPreset === "custom" && customReminderOffset
            ? [customReminderOffset]
            : [],
        timezone: timetable.institutionTimezone,
      });
      setCalendarDelivery({ provider, response });
      setCopyStatus("");
      track("subscription_created", {
        publicSlug: timetable.publicSlug,
        provider,
        reminderPreset,
        subscriptionId: response.subscriptionId,
      });
      if (provider === "google_api") {
        if (!response.googleConnectUrl) {
          throw new Error(
            "Google Calendar connection is unavailable right now.",
          );
        }
        rememberGoogleCalendarReturnSlug(
          timetable.publicSlug,
          window.localStorage,
        );
        track("google_oauth_started", {
          publicSlug: timetable.publicSlug,
          provider: "google_api",
          subscriptionId: response.subscriptionId,
          reminderPreset,
        });
        window.location.assign(response.googleConnectUrl);
        return;
      }
      if (provider === "ics_download" && response.downloadUrl) {
        track("ics_download_started", { publicSlug: timetable.publicSlug });
        triggerCalendarDownload(response.downloadUrl);
        track("ics_download_completed", { publicSlug: timetable.publicSlug });
      }
      trackDurableCompletion(provider, response);
      setOnboardingStep("provider_result");
    } catch (error) {
      if (provider === "google_api") {
        track("google_oauth_failed", {
          publicSlug: timetable.publicSlug,
          provider: "google_api",
          reason: "prepare",
        });
      }
      setCalendarDelivery(null);
      setCalendarError(
        error instanceof Error
          ? error.message
          : "We could not prepare your calendar just now.",
      );
      setOnboardingStep("provider");
    } finally {
      calendarActionLockRef.current = false;
      setCalendarBusy(null);
    }
  }

  async function copySubscriptionUrl() {
    const feedUrl = calendarDelivery?.response.feedUrl;
    if (!feedUrl) return;
    try {
      await copyText(feedUrl);
      setCopyStatus("Secure subscription URL copied.");
      track("subscription_url_copied", {
        publicSlug: timetable?.publicSlug,
      });
    } catch {
      setCopyStatus("Select the secure subscription URL below and copy it.");
    }
  }

  function classSharePayload(source: ClassShareSource) {
    if (!timetable) return null;
    return buildClassSharePayload({
      classLabel: formatClassGroupLabel(timetable.classGroup),
      publicUrl,
      source,
    });
  }

  async function shareTimetable(source: ClassShareSource = "class_share") {
    if (!timetable) return;
    const payload = classSharePayload(source);
    if (!payload) return;
    setShareStatus("");
    try {
      if (navigator.share) {
        await navigator.share({
          title: payload.title,
          text: payload.text,
          url: payload.url,
        });
        track("timetable_shared", {
          method: "web-share",
          source,
          publicSlug: timetable.publicSlug,
        });
        return;
      }
      await copyText(payload.message);
      setShareStatus("Class message copied — ready to paste into your group.");
      track("timetable_shared", {
        method: "copy-message",
        source,
        publicSlug: timetable.publicSlug,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setShareStatus(
        "Sharing was cancelled. Your calendar setup is unchanged.",
      );
    }
  }

  function renderOnboardingStep() {
    if (!timetable) return null;
    const currentTimetable = timetable;
    const appleDeepLink =
      calendarDelivery?.response.appleDeepLinkUrl ??
      calendarDelivery?.response.appleSubscribeUrl;

    if (onboardingStep === "reminders") {
      return (
        <>
          <div
            className="pt-reminder-list"
            role="radiogroup"
            aria-label="Reminder choices"
          >
            {reminderChoices.map((choice) => (
              <button
                type="button"
                role="radio"
                aria-checked={reminderPreset === choice.id}
                className={`pt-reminder${reminderPreset === choice.id ? " selected" : ""}`}
                key={choice.id}
                onClick={() => chooseReminder(choice.id)}
              >
                <span className="pt-reminder-radio" aria-hidden="true" />
                <span>
                  <strong>{choice.title}</strong>
                  <small>{choice.detail}</small>
                </span>
                {choice.hint ? <em>{choice.hint}</em> : null}
              </button>
            ))}
          </div>

          {reminderPreset === "custom" ? (
            <div className="pt-custom-reminders">
              <label>
                <span>Hours before</span>
                <input
                  aria-label="Hours before class"
                  inputMode="numeric"
                  value={customHours}
                  onChange={(event) =>
                    setCustomHours(event.target.value.replace(/[^\d]/g, ""))
                  }
                />
              </label>
              <label>
                <span>Minutes before</span>
                <input
                  aria-label="Minutes before class"
                  inputMode="numeric"
                  value={customMinutes}
                  onChange={(event) =>
                    setCustomMinutes(event.target.value.replace(/[^\d]/g, ""))
                  }
                />
              </label>
              <button
                type="button"
                className="pt-button pt-button-primary"
                onClick={saveCustomReminder}
              >
                Save custom reminder
              </button>
            </div>
          ) : null}

          <div className="pt-dialog-timezone" role="note">
            <Clock3 size={16} aria-hidden="true" />
            <span>
              Lecture times stay in {currentTimetable.institutionTimezone}.
              Reminders only control notifications; they never move a class.
            </span>
          </div>

          {calendarError ? (
            <p className="pt-error" role="alert">
              {calendarError}
            </p>
          ) : null}
        </>
      );
    }

    if (onboardingStep === "provider") {
      return (
        <div className="pt-method-section no-border">
          <div className="pt-provider-heading">
            <div>
              <span className="pt-kicker">Calendar destination</span>
              <h3>Where should the timetable go?</h3>
            </div>
            <button
              type="button"
              className="pt-dialog-back"
              onClick={() => {
                setCalendarError("");
                setOnboardingStep("reminders");
              }}
            >
              Back
            </button>
          </div>
          <div className="pt-method-list">
            {calendarDestinations.map((destination) => {
              if (destination === "google") {
                return googleEnabled ? (
                  <button
                    type="button"
                    className="pt-method pt-method-provider"
                    key="google"
                    disabled={calendarBusy !== null}
                    onClick={() => selectProvider("google_api")}
                  >
                    <ProviderMark provider="google" />
                    <span className="pt-method-copy">
                      <strong>Continue with Google</strong>
                      <small>
                        CalenderZW creates a separate limited-scope calendar for
                        this timetable and keeps approved updates synced.
                      </small>
                    </span>
                  </button>
                ) : (
                  <div className="pt-method disabled" key="google">
                    <ProviderMark provider="google" />
                    <span className="pt-method-copy">
                      <strong>Continue with Google</strong>
                      <small>
                        Direct Google sync is unavailable in this deployment.
                      </small>
                    </span>
                  </div>
                );
              }

              if (destination === "apple") {
                return (
                  <button
                    type="button"
                    className="pt-method pt-method-provider"
                    key="apple"
                    disabled={calendarBusy !== null}
                    onClick={() => selectProvider("apple_subscription")}
                  >
                    <ProviderMark provider="apple" />
                    <span className="pt-method-copy">
                      <strong>Add to Apple Calendar</strong>
                      <small>
                        Subscribe to a private HTTPS feed so future approved
                        timetable publications reach the same calendar.
                      </small>
                    </span>
                  </button>
                );
              }

              return (
                <details className="pt-advanced-options" key="advanced">
                  <summary>Advanced options</summary>
                  <p>
                    Use these when direct provider handoff is not suitable.
                    Subscription URLs stay private; ICS files are one-time
                    imports.
                  </p>
                  <div className="pt-method-list pt-method-list-advanced">
                    <button
                      type="button"
                      className="pt-method"
                      disabled={calendarBusy !== null}
                      onClick={() => selectProvider("webcal_subscription")}
                    >
                      <span className="pt-method-icon">
                        <Link2 size={18} aria-hidden="true" />
                      </span>
                      <span className="pt-method-copy">
                        <strong>Copy subscription URL</strong>
                        <small>
                          Private HTTPS subscribed-calendar URL. Compatible
                          clients can receive future approved changes.
                        </small>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="pt-method"
                      disabled={calendarBusy !== null}
                      onClick={() => selectProvider("ics_download")}
                    >
                      <span className="pt-method-icon">
                        <Download size={18} aria-hidden="true" />
                      </span>
                      <span className="pt-method-copy">
                        <strong>Download one-time ICS</strong>
                        <small>
                          Imports this publication once; future changes do not
                          update the downloaded file.
                        </small>
                      </span>
                    </button>
                  </div>
                </details>
              );
            })}
          </div>
          {calendarError ? (
            <p className="pt-error" role="alert">
              {calendarError}
            </p>
          ) : null}
        </div>
      );
    }

    if (onboardingStep === "preparing") {
      return (
        <div className="pt-preparing" role="status">
          <CalendarCheck size={28} aria-hidden="true" />
          <h3>Preparing your calendar</h3>
          <p>Creating the requested calendar handoff securely.</p>
        </div>
      );
    }

    if (onboardingStep === "provider_result" && calendarDelivery) {
      return (
        <div className="pt-result-step">
          <span className="pt-kicker">Calendar ready</span>
          <h3>{calendarDelivery.response.calendarName}</h3>

          {calendarDelivery.provider === "apple_subscription" ? (
            <>
              <p>
                Your private HTTPS subscription is ready for Apple Calendar.
                Keep the subscription URL private.
              </p>
              {appleDeepLink ? (
                <a
                  className="pt-button pt-button-primary"
                  href={appleDeepLink}
                  onClick={() =>
                    track("apple_calendar_opened", {
                      publicSlug: currentTimetable.publicSlug,
                    })
                  }
                >
                  <ExternalLink size={18} aria-hidden="true" />
                  Open Apple Calendar
                </a>
              ) : null}
              <button
                type="button"
                className="pt-button pt-button-secondary"
                onClick={() => void copySubscriptionUrl()}
              >
                <Copy size={18} aria-hidden="true" />
                Copy subscription URL
              </button>
            </>
          ) : null}

          {calendarDelivery.provider === "webcal_subscription" ? (
            <>
              <p>
                Copy this private HTTPS subscribed-calendar URL into a
                compatible calendar. This is not direct Google account sync.
              </p>
              <button
                type="button"
                className="pt-button pt-button-primary pt-big-copy"
                onClick={() => void copySubscriptionUrl()}
              >
                <Copy size={18} aria-hidden="true" />
                Copy subscription URL
              </button>
            </>
          ) : null}

          {calendarDelivery.provider === "ics_download" ? (
            <>
              <p>
                One-time import complete. Future timetable changes will not
                automatically update this file.
              </p>
              {calendarDelivery.response.downloadUrl ? (
                <button
                  type="button"
                  className="pt-button pt-button-secondary"
                  onClick={() =>
                    triggerCalendarDownload(
                      calendarDelivery.response.downloadUrl as string,
                    )
                  }
                >
                  <Download size={18} aria-hidden="true" />
                  Download again
                </button>
              ) : null}
            </>
          ) : null}

          {calendarDelivery.response.feedUrl ? (
            <div className="pt-url-panel">
              <label htmlFor="pt-private-feed">Private subscription URL</label>
              <input
                id="pt-private-feed"
                readOnly
                value={calendarDelivery.response.feedUrl}
                onFocus={(event) => event.currentTarget.select()}
              />
            </div>
          ) : null}

          {copyStatus ? (
            <p className="pt-status-message" role="status">
              {copyStatus}
            </p>
          ) : null}
          {calendarDelivery.response.warnings?.map((warning) => (
            <p key={warning} className="pt-warning">
              {warning}
            </p>
          ))}

          <div className="pt-share-panel pt-share-panel-result">
            <strong>Share the public class page, not your private feed.</strong>
            <button
              type="button"
              className="pt-button pt-button-secondary"
              onClick={() => void shareTimetable("onboarding_success")}
            >
              <Share2 size={18} aria-hidden="true" />
              Share with classmates
            </button>
          </div>
          {shareStatus ? (
            <p className="pt-status-message" role="status">
              {shareStatus}
            </p>
          ) : null}
          <div className="pt-dialog-actions">
            <button
              type="button"
              className="pt-button pt-button-secondary"
              onClick={() => {
                setDialogOpen(false);
                setCalendarDelivery(null);
              }}
            >
              Done
            </button>
          </div>
        </div>
      );
    }

    return null;
  }

  if (status === "loading") return <LoadingPage />;
  if (status === "error" || !timetable || !projection || !tomorrow) {
    return <ErrorPage />;
  }

  const stickyVisible = isMobile && !isPrimaryVisible && !dialogOpen;
  const dialogTitle =
    onboardingStep === "reminders"
      ? "Choose your reminders"
      : onboardingStep === "provider"
        ? "Choose calendar destination"
        : onboardingStep === "preparing"
          ? "Preparing your calendar"
          : "Calendar ready";

  return (
    <PublicShell compactFooter className="pt-app">
      <main className="pt-shell pt-main">
        <section className="pt-hero" aria-labelledby="pt-title">
          <div className="pt-hero-card pt-conversion-card">
            <header className="pt-class-header">
              <div className="pt-kicker-row">
                <span className="pt-kicker">{timetable.institution}</span>
                <span className="pt-version">v{timetable.versionNumber}</span>
              </div>
              <h1 id="pt-title">{timetable.programme}</h1>
              <div className="pt-identity-row">
                <strong>{formatClassGroupLabel(timetable.classGroup)}</strong>
                <span>{timetable.academicPeriod}</span>
              </div>
              <p className="pt-updated-line">
                Updated{" "}
                {formatPublishedTimestamp(
                  timetable.publishedAt,
                  timetable.institutionTimezone,
                )}
              </p>
            </header>

            <div className="pt-conversion-grid">
              <div className="pt-conversion-main">
                <article className="pt-next-card">
                  <span className="pt-next-label">Next class</span>
                  {nextClass ? (
                    <>
                      <strong className="pt-next-time">
                        {nextClass.relativeLabel} ·{" "}
                        {formatOccurrenceTime(
                          nextClass.start,
                          timetable.institutionTimezone,
                        )}
                      </strong>
                      <h2>{nextClass.session.courseName}</h2>
                      <p>{nextClass.session.courseCode}</p>
                      <span className="pt-location">
                        <MapPin size={16} aria-hidden="true" />
                        {nextClass.session.venue || "Venue not set"}
                        {nextClass.session.lecturer
                          ? ` · ${nextClass.session.lecturer}`
                          : ""}
                      </span>
                    </>
                  ) : (
                    <>
                      <strong>No upcoming classes</strong>
                      <p>
                        No more published sessions fall inside this academic
                        period.
                      </p>
                    </>
                  )}
                </article>

                <div className="pt-primary-actions">
                  <button
                    ref={primaryCtaRef}
                    type="button"
                    className="pt-button pt-button-primary"
                    onClick={openDialog}
                  >
                    <CalendarCheck size={18} aria-hidden="true" />
                    Add to Calendar
                  </button>
                  <button
                    type="button"
                    className="pt-button pt-button-secondary"
                    onClick={() => void shareTimetable("class_share")}
                  >
                    <Share2 size={18} aria-hidden="true" />
                    Share with classmates
                  </button>
                </div>

                {timetable.publicDisplay?.showVisualPreview === true ? (
                  <PersonalTimetablePreview slug={slug} timetable={timetable} />
                ) : null}

                {googleSuccess ? (
                  <div className="pt-google-connected-note" role="status">
                    <div>
                      <strong>Google Calendar connected</strong>
                      <small>
                        Future approved timetable updates can sync to the same
                        Google calendar.
                      </small>
                    </div>
                    <a href={GOOGLE_CALENDAR_HOME_URL}>Open Google Calendar</a>
                  </div>
                ) : null}
                {googleFailed ? (
                  <div className="pt-google-failed-note" role="alert">
                    Google Calendar was not connected. Retry through Add to
                    Calendar.
                  </div>
                ) : null}
              </div>

              <aside
                className="pt-conversion-support"
                aria-label="Calendar setup details"
              >
                <GoogleCalendarDisconnectEntry
                  connected={googleSuccess}
                  subscriptionId={googleSubscriptionId}
                />
                {timetable.publicDisplay?.showChangeAlerts === true ? (
                  <ChangeAlertsControl publicSlug={timetable.publicSlug} />
                ) : null}
                <p className="pt-helper">
                  No student account is required. Subscriptions can follow
                  future approved timetable publications; one-time ICS imports
                  cannot.
                </p>
              </aside>
            </div>

            {shareStatus ? (
              <p className="pt-status-message" role="status">
                {shareStatus}
              </p>
            ) : null}
          </div>
        </section>

        <section
          className="pt-tomorrow"
          id="tomorrow"
          aria-labelledby="pt-tomorrow-title"
        >
          <div className="pt-section-heading">
            <div>
              <span className="pt-kicker">Tomorrow</span>
              <h2 id="pt-tomorrow-title">{tomorrow.tomorrowLabel}</h2>
            </div>
            <p>
              {tomorrow.sessions.length === 1
                ? "1 published class"
                : `${tomorrow.sessions.length} published classes`}
            </p>
          </div>
          {tomorrow.sessions.length === 0 ? (
            <div className="pt-tomorrow-empty">
              No published classes tomorrow.
            </div>
          ) : (
            <div className="pt-tomorrow-grid">
              {tomorrow.sessions.map(({ session }) => (
                <article
                  key={session.stableSessionKey}
                  className={`pt-tomorrow-session ${courseToneClass(session.courseCode)}`}
                >
                  <time>
                    {localTimeLabel(session.startTime)}–
                    {localTimeLabel(session.endTime)}
                  </time>
                  <strong>{session.courseCode}</strong>
                  <h3>{session.courseName}</h3>
                  <span>
                    {session.venue || "Venue not set"}
                    {session.lecturer ? ` · ${session.lecturer}` : ""}
                  </span>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="pt-schedule" aria-labelledby="pt-week-title">
          <div className="pt-section-heading">
            <div>
              <span className="pt-kicker">Current published week</span>
              <h2 id="pt-week-title">Weekly timetable</h2>
            </div>
            <p>{projection.events.length} published weekly sessions</p>
          </div>

          <div className="pt-desktop-week">
            <div
              className="pt-table-scroll"
              tabIndex={0}
              aria-label="Weekly timetable table"
            >
              <table className="pt-week-table">
                <caption>
                  {timetable.programme}{" "}
                  {formatClassGroupLabel(timetable.classGroup)} weekly timetable
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Time</th>
                    {activeWeekdays.map((weekday) => (
                      <th scope="col" key={weekday}>
                        {weekdayLabels[weekday]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrixStartTimes.map((startTime) => (
                    <tr key={startTime}>
                      <th scope="row">{localTimeLabel(startTime)}</th>
                      {activeWeekdays.map((weekday) => {
                        const events = (
                          groupedEvents.get(weekday) ?? []
                        ).filter((event) => event.startTime === startTime);
                        return (
                          <td key={`${weekday}-${startTime}`}>
                            {events.map((event) => (
                              <article
                                className={`pt-table-session ${courseToneClass(event.courseCode)}`}
                                key={event.stableSessionKey}
                              >
                                <strong>{event.courseCode}</strong>
                                <span className="pt-table-course">
                                  {event.courseName}
                                </span>
                                <time>
                                  {localTimeLabel(event.startTime)}–
                                  {localTimeLabel(event.endTime)}
                                </time>
                                <small>{event.venue || "Venue not set"}</small>
                                {event.lecturer ? (
                                  <small>{event.lecturer}</small>
                                ) : null}
                              </article>
                            ))}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="pt-week-list pt-mobile-week">
            {activeWeekdays.map((weekday) => {
              const events = groupedEvents.get(weekday) ?? [];
              return (
                <section className="pt-day" key={weekday}>
                  <h3>{weekdayLabels[weekday]}</h3>
                  <div className="pt-day-events">
                    {events.map((event) => (
                      <SessionCard event={event} key={event.stableSessionKey} />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </section>
      </main>

      {stickyVisible ? (
        <div className="pt-sticky-cta">
          <button
            type="button"
            className="pt-button pt-button-primary"
            onClick={openDialog}
          >
            <CalendarCheck size={18} aria-hidden="true" />
            Add to Calendar
          </button>
        </div>
      ) : null}

      {dialogOpen ? (
        <div
          className="pt-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDialog();
          }}
        >
          <div
            ref={dialogRef}
            className="pt-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pt-dialog-title"
          >
            <div className="pt-dialog-header">
              <div>
                <span className="pt-kicker">Add to Calendar</span>
                <h2 id="pt-dialog-title">{dialogTitle}</h2>
              </div>
              <button
                type="button"
                className="pt-icon-button"
                aria-label="Close Add to Calendar dialog"
                onClick={closeDialog}
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>

            <div className="pt-dialog-body" aria-live="polite">
              {renderOnboardingStep()}
            </div>
          </div>
        </div>
      ) : null}
    </PublicShell>
  );
}
