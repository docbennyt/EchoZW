import {
  CalendarCheck,
  Clock3,
  Copy,
  Download,
  ExternalLink,
  Link2,
  MapPin,
  Share2,
  ShieldCheck,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { track } from "./analytics";
import { createCalendarSubscription } from "./api/calendarSubscriptions";
import type { PublicTimetable } from "./api/pilotTypes";
import { fetchPublicTimetable } from "./api/publicTimetable";
import { PublicShell } from "./components/site/SiteChrome";
import { detectDevice, type DeviceKind } from "./domain/device";
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
import {
  normalizeSubscriberPhone,
  subscriberCountryOptions,
  type SubscriberContactInput,
  type SubscriberCountryCode,
} from "./domain/subscriberContact";
import type { CreateSubscriptionResponse } from "./domain/subscriptions";
import { getTomorrowSchedule } from "./domain/tomorrowSchedule";

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
  "apple_subscription" | "webcal_subscription" | "ics_download";

type CalendarMethod = {
  provider: PublicCalendarProvider | null;
  title: string;
  description: string;
  accent?: string;
};

type CalendarDelivery = {
  provider: PublicCalendarProvider;
  response: CreateSubscriptionResponse;
  contactSaved: boolean;
};

type OnboardingStep =
  | "reminders"
  | "provider"
  | "contact_optional"
  | "preparing"
  | "provider_result"
  | "success";

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

function calendarMethodsForDevice(device: DeviceKind): CalendarMethod[] {
  if (device === "ios") {
    return [
      {
        provider: "apple_subscription",
        title: "Apple Calendar",
        description:
          "Subscribe to this private feed so future CalenderZW publications can reach the same calendar.",
        accent: "Recommended on iPhone",
      },
      {
        provider: "webcal_subscription",
        title: "Google/other subscription URL",
        description:
          "Copy the private HTTPS URL for Google Calendar or another calendar that supports subscriptions.",
        accent: "Keeps published updates",
      },
      {
        provider: "ics_download",
        title: "Download one-time .ics",
        description:
          "Import the timetable as it is now. Future published changes will not update this file.",
      },
    ];
  }

  if (device === "android") {
    return [
      {
        provider: "webcal_subscription",
        title: "Copy subscription URL",
        description:
          "Use the private HTTPS URL in a calendar that supports subscribed calendars. Google Calendar may require desktop setup.",
        accent: "Keeps published updates",
      },
      {
        provider: "ics_download",
        title: "Download one-time .ics",
        description:
          "Import the timetable once. Future published changes will not update the imported file.",
      },
      {
        provider: null,
        title: "Google Calendar direct sync",
        description: "Next on the CalenderZW roadmap.",
      },
    ];
  }

  return [
    {
      provider: "webcal_subscription",
      title: "Subscribe using calendar URL",
      description:
        "Copy a private HTTPS feed for Apple Calendar, Outlook, Google Calendar, or another compatible calendar client.",
      accent: "Keeps published updates",
    },
    {
      provider: "ics_download",
      title: "Download one-time .ics",
      description:
        "Import the current publication once. The file itself will not receive future changes.",
    },
  ];
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

function timezoneCopy(timeZone: string) {
  if (timeZone === "Africa/Harare") return "Times shown in Harare time (CAT).";
  return `Times shown in ${timeZone}.`;
}

function sharePayload(timetable: PublicTimetable, publicUrl: string) {
  return {
    title: `${formatClassGroupLabel(timetable.classGroup)} timetable`,
    text: `${formatClassGroupLabel(timetable.classGroup)} timetable is published on CalenderZW. View the current timetable and subscribe to your calendar.`,
    url: publicUrl,
  };
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
  const [selectedProvider, setSelectedProvider] =
    useState<PublicCalendarProvider | null>(null);
  const [contactCountry, setContactCountry] =
    useState<SubscriberCountryCode>("ZW");
  const [contactPhone, setContactPhone] = useState("");
  const [contactSkipped, setContactSkipped] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const [shareStatus, setShareStatus] = useState("");
  const [isPrimaryVisible, setIsPrimaryVisible] = useState(true);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 820);
  const primaryCtaRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

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
  const deviceKind = useMemo(
    () =>
      detectDevice(
        window.navigator.userAgent,
        window.navigator.maxTouchPoints ?? 0,
      ),
    [],
  );
  const calendarMethods = useMemo(
    () => calendarMethodsForDevice(deviceKind),
    [deviceKind],
  );
  const publicUrl = timetable
    ? `${window.location.origin}/t/${encodeURIComponent(timetable.publicSlug)}`
    : "";
  const browserTimeZone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "device timezone";

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

  const closeDialog = useCallback(() => {
    if (
      dialogOpen &&
      timetable &&
      onboardingStep !== "success" &&
      onboardingStep !== "provider_result"
    ) {
      track("onboarding_abandoned", {
        step: onboardingStep,
        publicSlug: timetable.publicSlug,
      });
    }
    setDialogOpen(false);
  }, [dialogOpen, onboardingStep, timetable]);

  const openDialog = useCallback(() => {
    setCalendarError("");
    setCopyStatus("");
    setCalendarDelivery(null);
    setSelectedProvider(null);
    setContactSkipped(false);
    setContactPhone("");
    setContactCountry("ZW");
    setOnboardingStep("reminders");
    setDialogOpen(true);
    track("calendar_cta_clicked", { publicSlug: timetable?.publicSlug });
    track("onboarding_opened", { publicSlug: timetable?.publicSlug });
  }, [timetable?.publicSlug]);

  function continueFromReminders() {
    if (!timetable) return;
    if (reminderPreset === "custom" && customReminderOffset === null) {
      setCalendarError("Enter at least one minute before class to continue.");
      return;
    }
    setCalendarError("");
    track("onboarding_step_completed", {
      step: "reminders",
      publicSlug: timetable.publicSlug,
      reminderPreset,
      customMinutes:
        reminderPreset === "custom" ? (customReminderOffset ?? 0) : null,
    });
    setOnboardingStep("provider");
  }

  function selectProvider(provider: PublicCalendarProvider) {
    if (!timetable) return;
    setSelectedProvider(provider);
    setCalendarError("");
    track("provider_selected", {
      publicSlug: timetable.publicSlug,
      provider,
    });
    track("onboarding_step_completed", {
      step: "provider",
      publicSlug: timetable.publicSlug,
      provider,
    });
    if (provider === "ics_download") {
      void prepareCalendar(provider);
      return;
    }
    setOnboardingStep("contact_optional");
  }

  async function prepareCalendar(
    provider: PublicCalendarProvider,
    subscriberContact?: SubscriberContactInput,
  ) {
    if (!timetable) return;

    setCalendarBusy(provider);
    setCalendarError("");
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
        subscriberContact,
      });
      setCalendarDelivery({
        provider,
        response,
        contactSaved: Boolean(subscriberContact) && response.contact.saved,
      });
      setCopyStatus("");
      track("subscription_created", {
        publicSlug: timetable.publicSlug,
        provider,
        reminderPreset,
        subscriptionId: response.subscriptionId,
      });
      if (provider === "ics_download" && response.downloadUrl) {
        track("ics_download_started", { publicSlug: timetable.publicSlug });
        triggerCalendarDownload(response.downloadUrl);
        track("ics_download_completed", { publicSlug: timetable.publicSlug });
      }
      setOnboardingStep("provider_result");
    } catch (error) {
      setCalendarError(
        error instanceof Error
          ? error.message
          : "We could not prepare your calendar just now.",
      );
      setOnboardingStep(
        provider === "ics_download" ? "provider" : "contact_optional",
      );
    } finally {
      setCalendarBusy(null);
    }
  }

  function saveContactAndContinue() {
    if (!selectedProvider) return;
    const contact: SubscriberContactInput = {
      countryCode: contactCountry,
      phone: contactPhone,
      consentUpdates: true,
      consentSource: "calendar_onboarding",
    };
    try {
      normalizeSubscriberPhone(contact);
    } catch (error) {
      setCalendarError(
        error instanceof Error
          ? error.message
          : "Enter a valid phone number or skip this step.",
      );
      return;
    }
    setContactSkipped(false);
    track("phone_step_completed", {
      country: contactCountry,
      publicSlug: timetable?.publicSlug,
    });
    track("onboarding_step_completed", {
      step: "contact_optional",
      status: "saved",
      country: contactCountry,
      publicSlug: timetable?.publicSlug,
    });
    void prepareCalendar(selectedProvider, contact);
  }

  function skipContactAndContinue() {
    if (!selectedProvider) return;
    setContactSkipped(true);
    setCalendarError("");
    track("onboarding_step_completed", {
      step: "contact_optional",
      status: "skipped",
      publicSlug: timetable?.publicSlug,
    });
    void prepareCalendar(selectedProvider);
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

  async function shareTimetable() {
    if (!timetable) return;
    const payload = sharePayload(timetable, publicUrl);
    setShareStatus("");
    try {
      if (navigator.share) {
        await navigator.share(payload);
        track("timetable_shared", {
          method: "web-share",
          publicSlug: timetable.publicSlug,
        });
        return;
      }
      await copyText(publicUrl);
      setShareStatus("Public timetable link copied.");
      track("timetable_shared", {
        method: "copy-link",
        publicSlug: timetable.publicSlug,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      try {
        await copyText(publicUrl);
        setShareStatus("Public timetable link copied.");
      } catch {
        setShareStatus(publicUrl);
      }
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
              <label
                className={`pt-reminder${reminderPreset === choice.id ? " selected" : ""}`}
                key={choice.id}
              >
                <input
                  type="radio"
                  name="pt-reminder"
                  value={choice.id}
                  checked={reminderPreset === choice.id}
                  onChange={() => {
                    setReminderPreset(choice.id);
                    setCalendarError("");
                    track("reminder_selected", { preset: choice.id });
                  }}
                />
                <span>
                  <strong>{choice.title}</strong>
                  <small>{choice.detail}</small>
                </span>
                {choice.hint ? <em>{choice.hint}</em> : null}
              </label>
            ))}
          </div>

          {reminderPreset === "custom" ? (
            <div className="pt-custom-reminders">
              <label>
                <span>Hours before</span>
                <input
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
                  inputMode="numeric"
                  value={customMinutes}
                  onChange={(event) =>
                    setCustomMinutes(event.target.value.replace(/[^\d]/g, ""))
                  }
                />
              </label>
            </div>
          ) : null}

          <div className="pt-dialog-timezone" role="note">
            <Clock3 size={16} aria-hidden="true" />
            <span>
              Lecture times stay in {currentTimetable.institutionTimezone}.
              Reminders only control notifications; they never move a class
              start or end time.
            </span>
          </div>

          {calendarError ? (
            <p className="pt-error" role="alert">
              {calendarError}
            </p>
          ) : null}

          <div className="pt-dialog-actions">
            <button
              type="button"
              className="pt-button pt-button-primary"
              onClick={continueFromReminders}
            >
              Continue
            </button>
          </div>
        </>
      );
    }

    if (onboardingStep === "provider") {
      return (
        <div className="pt-method-section no-border">
          <div>
            <span className="pt-kicker">Calendar destination</span>
            <h3>Where should the timetable go?</h3>
          </div>
          <div className="pt-method-list">
            {calendarMethods.map((method) =>
              method.provider ? (
                <button
                  type="button"
                  className="pt-method"
                  key={method.title}
                  disabled={calendarBusy !== null}
                  onClick={() => selectProvider(method.provider!)}
                >
                  <span className="pt-method-icon">
                    {method.provider === "ics_download" ? (
                      <Download size={18} aria-hidden="true" />
                    ) : (
                      <Link2 size={18} aria-hidden="true" />
                    )}
                  </span>
                  <span className="pt-method-copy">
                    <strong>{method.title}</strong>
                    <small>{method.description}</small>
                  </span>
                  {method.accent ? <em>{method.accent}</em> : null}
                </button>
              ) : (
                <div className="pt-method disabled" key={method.title}>
                  <span className="pt-method-icon">
                    <CalendarCheck size={18} aria-hidden="true" />
                  </span>
                  <span className="pt-method-copy">
                    <strong>{method.title}</strong>
                    <small>{method.description}</small>
                  </span>
                </div>
              ),
            )}
          </div>
          {calendarError ? (
            <p className="pt-error" role="alert">
              {calendarError}
            </p>
          ) : null}
        </div>
      );
    }

    if (onboardingStep === "contact_optional") {
      return (
        <div className="pt-contact-step">
          <h3>
            Want us to be able to reach you about important timetable changes?
          </h3>
          <div className="pt-phone-grid">
            <label>
              <span>Country</span>
              <select
                value={contactCountry}
                onChange={(event) =>
                  setContactCountry(event.target.value as SubscriberCountryCode)
                }
              >
                {subscriberCountryOptions.map((country) => (
                  <option value={country.countryCode} key={country.countryCode}>
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
                value={contactPhone}
                placeholder="077 123 4567"
                onChange={(event) => setContactPhone(event.target.value)}
              />
            </label>
          </div>
          <p className="pt-helper">
            This is optional. Your private calendar subscription works even if
            you skip this.
          </p>
          {calendarError ? (
            <p className="pt-error" role="alert">
              {calendarError}
            </p>
          ) : null}
          <div className="pt-dialog-actions split">
            <button
              type="button"
              className="pt-button pt-button-primary"
              onClick={saveContactAndContinue}
            >
              Save contact & continue
            </button>
            <button
              type="button"
              className="pt-button pt-button-secondary"
              onClick={skipContactAndContinue}
            >
              Skip for now
            </button>
          </div>
        </div>
      );
    }

    if (onboardingStep === "preparing") {
      return (
        <div className="pt-preparing" role="status">
          <CalendarCheck size={28} aria-hidden="true" />
          <h3>Preparing your calendar</h3>
          <p>Keeping this setup inside the sheet.</p>
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
                Keep this URL private.
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
                Copy this private HTTPS subscribed-calendar URL for Google
                Calendar or another compatible calendar. This is not direct
                Google account sync.
              </p>
              <button
                type="button"
                className="pt-button pt-button-primary pt-big-copy"
                onClick={() => void copySubscriptionUrl()}
              >
                <Copy size={18} aria-hidden="true" />
                Copy subscription URL
              </button>
              <ol className="pt-instructions">
                <li>Copy the private HTTPS URL.</li>
                <li>In Google Calendar, add a calendar from URL.</li>
                <li>Share the public class page with classmates.</li>
              </ol>
            </>
          ) : null}

          {calendarDelivery.provider === "ics_download" ? (
            <>
              <p>
                One-time import. Future timetable changes will not automatically
                update this file.
              </p>
              {calendarDelivery.response.downloadUrl ? (
                <button
                  type="button"
                  className="pt-button pt-button-primary"
                  onClick={() => {
                    triggerCalendarDownload(
                      calendarDelivery.response.downloadUrl as string,
                    );
                    track("ics_download_started", {
                      publicSlug: currentTimetable.publicSlug,
                    });
                  }}
                >
                  <Download size={18} aria-hidden="true" />
                  Download one-time ICS
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
              <details className="pt-subscription-details">
                <summary>Having trouble?</summary>
                {calendarDelivery.provider === "apple_subscription" ? (
                  <ol>
                    <li>Open Calendar on your iPhone.</li>
                    <li>Add a subscription calendar and paste this URL.</li>
                    <li>Share the class page, never this private URL.</li>
                  </ol>
                ) : (
                  <ol>
                    <li>Copy the private HTTPS URL above.</li>
                    <li>In Google Calendar, add a calendar from URL.</li>
                    <li>Share the public class page with classmates.</li>
                  </ol>
                )}
              </details>
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
          <div className="pt-dialog-actions">
            <button
              type="button"
              className="pt-button pt-button-primary"
              onClick={() => {
                track("share_prompt_viewed", {
                  publicSlug: currentTimetable.publicSlug,
                });
                setOnboardingStep("success");
              }}
            >
              Continue
            </button>
          </div>
        </div>
      );
    }

    if (onboardingStep === "success" && calendarDelivery) {
      return (
        <div className="pt-result-step">
          <span className="pt-kicker">Done</span>
          <h3>You're on track.</h3>
          <dl className="pt-summary-list">
            <div>
              <dt>Provider</dt>
              <dd>{calendarDelivery.response.provider}</dd>
            </div>
            <div>
              <dt>Reminder</dt>
              <dd>{reminderPreset}</dd>
            </div>
            <div>
              <dt>Contact</dt>
              <dd>
                {calendarDelivery.contactSaved && !contactSkipped
                  ? "Saved"
                  : "Not added"}
              </dd>
            </div>
          </dl>
          <div className="pt-dialog-actions split">
            <button
              type="button"
              className="pt-button pt-button-primary"
              onClick={() => {
                track("onboarding_completed", {
                  publicSlug: currentTimetable.publicSlug,
                  provider: calendarDelivery.provider,
                  reminderPreset,
                });
                setDialogOpen(false);
                setCalendarDelivery(null);
              }}
            >
              Done
            </button>
            <button
              type="button"
              className="pt-button pt-button-secondary"
              onClick={() => void shareTimetable()}
            >
              <Share2 size={18} aria-hidden="true" />
              Share with classmates
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
        : onboardingStep === "contact_optional"
          ? "Add optional contact"
          : onboardingStep === "preparing"
            ? "Preparing your calendar"
            : onboardingStep === "provider_result"
              ? "Calendar ready"
              : "You're on track";

  return (
    <PublicShell compactFooter className="pt-app">
      <main className="pt-shell pt-main">
        <section className="pt-hero" aria-labelledby="pt-title">
          <div className="pt-hero-card">
            <div className="pt-kicker-row">
              <span className="pt-kicker">Current published timetable</span>
              <span className="pt-version">v{timetable.versionNumber}</span>
            </div>
            <p className="pt-institution">{timetable.institution}</p>
            <h1 id="pt-title">{timetable.programme}</h1>
            <div className="pt-identity-row">
              <strong>{formatClassGroupLabel(timetable.classGroup)}</strong>
              <span>{timetable.academicPeriod}</span>
            </div>
            <div className="pt-trust-row">
              <span>
                <ShieldCheck size={16} aria-hidden="true" />
                Published by CalenderZW
              </span>
              <span>
                Updated{" "}
                {formatPublishedTimestamp(
                  timetable.publishedAt,
                  timetable.institutionTimezone,
                )}
              </span>
            </div>

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
                    No more published sessions fall inside this academic period.
                  </p>
                </>
              )}
            </article>

            <div className="pt-timezone-note" role="note">
              <Clock3 size={16} aria-hidden="true" />
              <div>
                <strong>{timezoneCopy(timetable.institutionTimezone)}</strong>
                {browserTimeZone !== timetable.institutionTimezone ? (
                  <span>
                    Your calendar is configured for {browserTimeZone}; it may
                    show the equivalent instant in that timezone.
                  </span>
                ) : null}
              </div>
            </div>

            <div className="pt-primary-actions">
              <button
                ref={primaryCtaRef}
                type="button"
                className="pt-button pt-button-primary"
                onClick={openDialog}
              >
                <CalendarCheck size={18} aria-hidden="true" />
                Subscribe to calendar
              </button>
              <button
                type="button"
                className="pt-button pt-button-secondary"
                onClick={() => void shareTimetable()}
              >
                <Share2 size={18} aria-hidden="true" />
                Share with classmates
              </button>
            </div>
            <p className="pt-helper">
              No account needed. Subscriptions follow future CalenderZW
              timetable publications; one-time .ics imports do not.
            </p>
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
            Subscribe to calendar
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
                <span className="pt-kicker">Subscribe to calendar</span>
                <h2 id="pt-dialog-title">{dialogTitle}</h2>
              </div>
              <button
                type="button"
                className="pt-icon-button"
                aria-label="Close calendar subscription dialog"
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
