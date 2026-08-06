import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CalendarCheck,
  Check,
  Download,
  FileClock,
  Flag,
  GraduationCap,
  History,
  Home,
  Link,
  Lock,
  Pencil,
  Plus,
  QrCode,
  Search,
  Share2,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { appConfig } from "./config/app";
import { BRAND } from "./config/brand";
import { legalConfig } from "./config/legal";
import { downloadIcs } from "./domain/calendar";
import { demoTimetable, popularTimetables } from "./domain/timetableData";
import { getNextEvent, formatLectureTime } from "./domain/nextEvent";
import {
  reminderPresets,
  supportedReminderMinutes,
  validateReminderMinutes,
} from "./domain/reminders";
import { correctionReportSchema } from "./domain/validation";
import { isExternallyFetchableUrl } from "./domain/publicUrl";
import { createCalendarSubscription } from "./api/calendarSubscriptions";
import { track } from "./analytics";
import type { CreateSubscriptionResponse } from "./domain/subscriptions";
import type {
  AcademicCalendarEvent,
  ReminderPresetId,
  ReminderPreset,
  Timetable,
} from "./domain/types";

const currentPath = () => window.location.pathname;
const submissionStorageKey = "calenderzw_submissions";
const currentYear = new Date().getFullYear();

type TimetableSubmission = {
  id: string;
  type: "request" | "upload";
  institution: string;
  programme: string;
  part: string;
  semester: string;
  contact?: string;
  fileName?: string;
  status: "open" | "reviewing" | "closed";
  createdAt: string;
};

function setPageMetadata(input: {
  title: string;
  description: string;
  canonicalPath: string;
  ogTitle?: string;
  ogDescription?: string;
  robots?: string;
}) {
  document.title = input.title;
  const tags: Array<[string, string, string]> = [
    ["name", "description", input.description],
    ["property", "og:title", input.ogTitle ?? input.title],
    ["property", "og:description", input.ogDescription ?? input.description],
    ["property", "og:url", `${BRAND.origin}${input.canonicalPath}`],
    ["property", "og:type", "website"],
    ["property", "og:image", `${BRAND.origin}${BRAND.squareIconPath}`],
    ["name", "twitter:card", "summary_large_image"],
  ];
  if (input.robots) tags.push(["name", "robots", input.robots]);

  for (const [attribute, key, value] of tags) {
    let meta = document.head.querySelector<HTMLMetaElement>(
      `meta[${attribute}="${key}"]`,
    );
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute(attribute, key);
      document.head.append(meta);
    }
    meta.setAttribute("content", value);
  }

  let canonical = document.head.querySelector<HTMLLinkElement>(
    'link[rel="canonical"]',
  );
  if (!canonical) {
    canonical = document.createElement("link");
    canonical.rel = "canonical";
    document.head.append(canonical);
  }
  canonical.href = `${BRAND.origin}${input.canonicalPath}`;
}

function usePageMetadata(input: Parameters<typeof setPageMetadata>[0]) {
  const {
    title,
    description,
    canonicalPath,
    ogTitle,
    ogDescription,
    robots,
  } = input;
  useEffect(() => {
    setPageMetadata({
      title,
      description,
      canonicalPath,
      ogTitle,
      ogDescription,
      robots,
    });
  }, [title, description, canonicalPath, ogTitle, ogDescription, robots]);
}

function readSubmissions() {
  try {
    return JSON.parse(
      localStorage.getItem(submissionStorageKey) ?? "[]",
    ) as TimetableSubmission[];
  } catch {
    return [];
  }
}

function saveSubmissions(submissions: TimetableSubmission[]) {
  localStorage.setItem(submissionStorageKey, JSON.stringify(submissions));
}

function addSubmission(
  input: Omit<TimetableSubmission, "id" | "status" | "createdAt">,
) {
  const submission: TimetableSubmission = {
    ...input,
    id: globalThis.crypto.randomUUID(),
    status: "open",
    createdAt: new Date().toISOString(),
  };
  saveSubmissions([submission, ...readSubmissions()]);
  return submission;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-mark">
            <img src="/favicon-96x96.png" alt="" />
          </span>
          <span>
            <strong>{appConfig.productName}</strong>
            <small>by {appConfig.companyName}</small>
          </span>
        </a>
        <nav aria-label="Main navigation">
          <a href="/find">Find timetable</a>
          <a href="/#how-it-works">How it works</a>
          <a href="/#calendar-options">Calendar options</a>
          <a href="/privacy">Privacy</a>
          <a href="/dashboard">Dashboard</a>
        </nav>
      </header>
      {children}
      <LegalFooter />
    </div>
  );
}

function LegalFooter() {
  return (
    <footer className="site-footer">
      <div>
        <strong>{appConfig.attribution}</strong>
        <span>
          &copy; {currentYear} {legalConfig.operatorName}.{" "}
          {legalConfig.tradingName} is operated by {legalConfig.operatorName}.
        </span>
        <span>
          {legalConfig.operatorName} · {legalConfig.country}
        </span>
      </div>
      <nav aria-label="Legal and support links">
        <a href="/find">Find timetable</a>
        <a href="/#how-it-works">How it works</a>
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
        <a href="/data-deletion">Data deletion</a>
        <a href="/support">Support</a>
      </nav>
    </footer>
  );
}

function MessageDialog({
  title,
  text,
  tone = "success",
  continueLabel = "Continue",
  onContinue,
  children,
}: {
  title: string;
  text: string;
  tone?: "success" | "warning" | "danger";
  continueLabel?: string;
  onContinue: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="sheet-backdrop" role="presentation">
      <section
        className={`message-dialog ${tone}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="message-dialog-title"
      >
        <div className="message-icon">
          {tone === "success" ? <Check /> : <AlertTriangle />}
        </div>
        <h2 id="message-dialog-title">{title}</h2>
        <p>{text}</p>
        {children}
        <button className="primary dominant" onClick={onContinue}>
          {continueLabel}
        </button>
      </section>
    </div>
  );
}

function VerificationBadge({
  status,
}: {
  status: Timetable["verificationStatus"];
}) {
  const label =
    status === "official"
      ? "Official"
      : status === "community_verified"
        ? "Community verified"
        : "Draft";
  return (
    <span className={`badge ${status}`}>
      <ShieldCheck size={16} aria-hidden="true" />
      {label}
    </span>
  );
}

function NextLectureCard({
  timetable,
  reminders,
}: {
  timetable: Timetable;
  reminders: number[];
}) {
  const next = getNextEvent(timetable, new Date("2026-08-10T07:15:00+02:00"));
  if (!next) {
    return (
      <EmptyState
        title="No upcoming lectures"
        text="This timetable has no future lecture in the active semester."
      />
    );
  }
  const reminder = new Date(
    next.start.getTime() - reminders[reminders.length - 1] * 60 * 1000,
  );
  return (
    <section className="next-lecture" aria-labelledby="next-lecture-title">
      <div>
        <p className="eyebrow" id="next-lecture-title">
          Next lecture
        </p>
        <h2>{next.event.title}</h2>
        <p>{formatLectureTime(next.start, next.end)}</p>
        <p>{next.event.location}</p>
      </div>
      <div className="reminder-chip">
        <CalendarCheck size={18} aria-hidden="true" />
        Reminder set for{" "}
        {reminder.toLocaleTimeString("en-ZW", {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </div>
    </section>
  );
}

function EventCard({ event }: { event: AcademicCalendarEvent }) {
  return (
    <article className="event-card">
      <time>
        {event.startsAtLocal.slice(11, 16)}-{event.endsAtLocal.slice(11, 16)}
      </time>
      <div>
        <strong>{event.courseCode}</strong>
        <h3>{event.title}</h3>
        <p>{event.location}</p>
        <span>
          {event.lecturer ?? "Lecturer to be confirmed"} · {event.groupName}
        </span>
      </div>
      <span className={`status ${event.status}`}>{event.status}</span>
    </article>
  );
}

function AgendaView({ timetable }: { timetable: Timetable }) {
  const grouped = timetable.events.reduce<
    Record<string, AcademicCalendarEvent[]>
  >((acc, event) => {
    const day = new Date(event.startsAtLocal).toLocaleDateString("en-ZW", {
      weekday: "long",
    });
    acc[day] = [...(acc[day] ?? []), event];
    return acc;
  }, {});
  return (
    <section className="agenda" aria-labelledby="agenda-title">
      <h2 id="agenda-title">Weekly agenda</h2>
      {Object.entries(grouped).map(([day, events]) => (
        <div className="day-group" key={day}>
          <h3>{day}</h3>
          {events.map((event) => (
            <EventCard event={event} key={event.id} />
          ))}
        </div>
      ))}
    </section>
  );
}

function WeekView({ timetable }: { timetable: Timetable }) {
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  return (
    <section className="week-view" aria-labelledby="week-title">
      <h2 id="week-title">Week view</h2>
      <div
        className="week-grid"
        role="table"
        aria-label="Weekly timetable grid"
      >
        {days.map((day) => (
          <div className="week-column" key={day} role="row">
            <h3 role="columnheader">{day.slice(0, 3)}</h3>
            {timetable.events
              .filter(
                (event) =>
                  new Date(event.startsAtLocal).toLocaleDateString("en-US", {
                    weekday: "long",
                  }) === day,
              )
              .map((event) => (
                <div className="week-pill" key={event.id}>
                  <strong>{event.startsAtLocal.slice(11, 16)}</strong>
                  <span>{event.courseCode}</span>
                </div>
              ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function ReminderPresetCard({
  preset,
  selected,
  onSelect,
}: {
  preset: ReminderPreset;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={`preset-card ${selected ? "selected" : ""}`}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <span>{preset.label}</span>
      <small>{preset.description}</small>
      {selected && <Check size={20} aria-hidden="true" />}
    </button>
  );
}

function CalendarProviderCard({
  icon,
  title,
  text,
  action,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <button className="provider-card" onClick={onClick}>
      <span className="provider-icon">{icon}</span>
      <span>
        <strong>{title}</strong>
        <small>{text}</small>
      </span>
      <em>{action}</em>
    </button>
  );
}

function GoogleGlyph() {
  return (
    <span className="google-glyph" aria-hidden="true">
      G
    </span>
  );
}

function TimetableHero({
  timetable,
  onSync,
}: {
  timetable: Timetable;
  onSync: () => void;
}) {
  return (
    <section className="hero">
      <div className="hero-copy">
        <p className="eyebrow">Shared timetable</p>
        <h1>{timetable.programme}</h1>
        <p>
          {timetable.part} · {timetable.semester} · {timetable.groupName}
        </p>
        <div className="hero-actions">
          <button className="primary" onClick={onSync}>
            <CalendarCheck size={20} aria-hidden="true" />
            Add to my calendar
          </button>
          <a className="secondary" href="/find">
            <Search size={18} aria-hidden="true" />
            Find another
          </a>
        </div>
      </div>
      <div className="hero-panel" aria-label="Timetable summary">
        <VerificationBadge status={timetable.verificationStatus} />
        <dl>
          <div>
            <dt>Institution</dt>
            <dd>{timetable.institution}</dd>
          </div>
          <div>
            <dt>Campus</dt>
            <dd>{timetable.campus}</dd>
          </div>
          <div>
            <dt>Events</dt>
            <dd>{timetable.events.length} weekly</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>
              {new Date(timetable.lastUpdated).toLocaleDateString("en-ZW")}
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

function SyncWizard({
  timetable,
  selectedPreset,
  setSelectedPreset,
  onClose,
}: {
  timetable: Timetable;
  selectedPreset: ReminderPreset;
  setSelectedPreset: (preset: ReminderPreset) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState(1);
  const [customMinutes, setCustomMinutes] = useState<number[]>(
    selectedPreset.minutes,
  );
  const [subscription, setSubscription] =
    useState<CreateSubscriptionResponse | null>(null);
  const [status, setStatus] = useState<
    "idle" | "preparing" | "google" | "adding" | "success" | "error"
  >("idle");
  const [googleDisclosureOpen, setGoogleDisclosureOpen] = useState(false);
  const [providerUsed, setProviderUsed] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const selectedMinutes =
    selectedPreset.id === "custom"
      ? validateReminderMinutes(customMinutes)
      : selectedPreset.minutes;
  const externalProviderReady = isExternallyFetchableUrl(appConfig.baseUrl);
  const next = getNextEvent(timetable, new Date("2026-08-10T07:15:00+02:00"));

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  async function prepareSubscription(
    provider:
      | "google_api"
      | "apple_subscription"
      | "webcal_subscription"
      | "ics_download",
  ) {
    setError("");
    setCopied(false);
    setStatus(provider === "google_api" ? "google" : "preparing");
    track("calendar_provider_selected", { provider });
    try {
      const response = await createCalendarSubscription({
        timetableId: timetable.id,
        provider,
        reminderPreset: selectedPreset.id as ReminderPresetId,
        customReminderOffsets:
          selectedPreset.id === "custom" ? customMinutes : [],
        timezone: timetable.timezone,
      });
      setSubscription(response);
      setStatus("adding");
      track("calendar_subscription_created", { provider });
      return response;
    } catch (caught) {
      setStatus("error");
      setError(
        caught instanceof Error
          ? caught.message
          : "We could not prepare your calendar. Try again.",
      );
      return null;
    }
  }

  async function copyFeed() {
    const response =
      subscription ?? (await prepareSubscription("webcal_subscription"));
    if (!response?.feedUrl) return;
    await navigator.clipboard.writeText(response.feedUrl);
    setCopied(true);
    setProviderUsed("subscription link");
    setStatus("success");
    track("subscription_link_copied");
  }

  async function downloadPersonalizedIcs() {
    setStatus("preparing");
    track("ics_download_started");
    const response = await prepareSubscription("ics_download");
    if (!response) return;
    downloadIcs(timetable, selectedMinutes);
    setSubscription(response);
    setProviderUsed("calendar file");
    setStatus("success");
    track("ics_download_completed");
  }

  async function openApple() {
    const response = await prepareSubscription("apple_subscription");
    if (!response) return;
    if (response.appleSubscribeUrl) {
      window.location.href = response.appleSubscribeUrl;
      setProviderUsed("Apple Calendar");
      setStatus("success");
      track("apple_webcal_opened");
      return;
    }
    setStatus("error");
    setError(
      "Apple Calendar needs a public HTTPS feed. Use a preview deployment or tunnel, or download the .ics file for local testing.",
    );
  }

  async function connectGoogle() {
    setGoogleDisclosureOpen(true);
  }

  async function continueGoogle() {
    setGoogleDisclosureOpen(false);
    const response = await prepareSubscription("google_api");
    if (!response?.googleConnectUrl) return;
    window.location.href = response.googleConnectUrl;
  }

  const nextReminder =
    next && selectedMinutes.length
      ? new Date(
          next.start.getTime() -
            selectedMinutes[selectedMinutes.length - 1] * 60 * 1000,
        )
      : undefined;
  const busy =
    status === "preparing" || status === "google" || status === "adding";

  return (
    <div className="sheet-backdrop" role="presentation">
      <section
        className="sync-sheet quick-add multi-step"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sync-title"
      >
        <div className="sheet-header">
          <div>
            <p className="eyebrow">Step {step} of 3</p>
            <h2 id="sync-title">Add {timetable.programme}</h2>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close sync wizard"
          >
            x
          </button>
        </div>

        {step === 1 && (
          <div className="quick-summary">
            <VerificationBadge status={timetable.verificationStatus} />
            <dl>
              <div>
                <dt>Institution</dt>
                <dd>{timetable.institution}</dd>
              </div>
              <div>
                <dt>Cohort</dt>
                <dd>
                  {timetable.part} · {timetable.groupName}
                </dd>
              </div>
              <div>
                <dt>Semester</dt>
                <dd>
                  {timetable.semester} · {timetable.version}
                </dd>
              </div>
              <div>
                <dt>Events</dt>
                <dd>{timetable.events.length} classes</dd>
              </div>
            </dl>
            {next && (
              <div className="quick-next">
                <span>Next lecture</span>
                <strong>{next.event.title}</strong>
                <small>
                  {formatLectureTime(next.start, next.end)} ·{" "}
                  {next.event.location}
                </small>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <section className="step-panel" aria-labelledby="reminder-title">
            <div>
              <h3 id="reminder-title">Reminders</h3>
              <p className="helper">
                Calendar alarms use exact offsets before each lecture.
              </p>
            </div>
            <div className="preset-grid compact-presets">
              {reminderPresets.map((preset) => (
                <ReminderPresetCard
                  key={preset.id}
                  preset={preset}
                  selected={selectedPreset.id === preset.id}
                  onSelect={() => {
                    setSelectedPreset(preset);
                    track("reminder_preset_selected", { preset: preset.id });
                  }}
                />
              ))}
            </div>
            {selectedPreset.id === "custom" && (
              <fieldset className="custom-reminders">
                <legend>Custom reminders</legend>
                {supportedReminderMinutes.map((minute) => (
                  <label key={minute}>
                    <input
                      type="checkbox"
                      checked={customMinutes.includes(minute)}
                      onChange={(event) => {
                        setCustomMinutes((values) =>
                          event.target.checked
                            ? [...values, minute].slice(-5)
                            : values.filter((value) => value !== minute),
                        );
                      }}
                    />
                    {minute >= 60 ? `${minute / 60} hr` : `${minute} min`}
                  </label>
                ))}
              </fieldset>
            )}
          </section>
        )}

        {step === 3 && (
          <section className="step-panel" aria-labelledby="provider-title">
            <div>
              <h3 id="provider-title">Choose calendar</h3>
              <p className="helper">
                Pick the provider you want. All options stay visible for now.
              </p>
            </div>
            {!externalProviderReady && (
              <p className="dev-warning" role="status">
                Calendar subscriptions work from the live HTTPS site. For local
                testing, download the personalised .ics file.
              </p>
            )}
            <div className="provider-list always-options">
              <CalendarProviderCard
                icon={<GoogleGlyph />}
                title="Add to Google Calendar"
                text="Creates a separate timetable calendar in your Google account."
                action="Apply"
                onClick={connectGoogle}
              />
              <CalendarProviderCard
                icon={<CalendarCheck size={22} />}
                title="Subscribe in Apple Calendar"
                text="Uses webcal on iPhone or iPad when public HTTPS is configured."
                action="Apply"
                onClick={openApple}
              />
              <CalendarProviderCard
                icon={<Download size={22} />}
                title="Download .ics"
                text="Best when you want a simple one-time import."
                action="Download"
                onClick={downloadPersonalizedIcs}
              />
              <CalendarProviderCard
                icon={<Link size={22} />}
                title="Copy subscription link"
                text={
                  externalProviderReady
                    ? "Advanced option for calendar apps that support feed URLs."
                    : "Copies a local test link only after showing this warning."
                }
                action={copied ? "Copied" : "Copy"}
                onClick={copyFeed}
              />
            </div>
          </section>
        )}

        <div aria-live="polite" className="sync-progress">
          {status === "preparing" && "Preparing your calendar..."}
          {status === "google" && "Connecting Google Calendar..."}
          {status === "adding" &&
            `Adding ${timetable.events.length} classes...`}
        </div>
        <div className="sheet-actions quick-actions">
          {step > 1 && (
            <button
              className="secondary light"
              onClick={() => setStep(step - 1)}
            >
              Back
            </button>
          )}
          {step < 3 && (
            <button
              className="primary dominant"
              onClick={() => setStep(step + 1)}
            >
              Continue
            </button>
          )}
          {step === 3 && (
            <button
              className="secondary light"
              onClick={onClose}
              disabled={busy}
            >
              Done
            </button>
          )}
        </div>

        <div className="drawer-help">
          <button
            type="button"
            onClick={() => {
              track("calendar_setup_help_opened");
              setError(
                "Google uses OAuth for reliable updates. Apple uses webcal on public HTTPS. Download .ics works offline but will not receive future updates automatically.",
              );
              setStatus("error");
            }}
          >
            View setup help
          </button>
          {subscription?.warnings.map((warning) => (
            <span key={warning}>{warning}</span>
          ))}
          <div className="drawer-legal-links">
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
            <a href="/data-deletion">Data deletion</a>
          </div>
        </div>
      </section>
      {googleDisclosureOpen && (
        <MessageDialog
          title="Connect Google Calendar"
          text={`${legalConfig.tradingName} will ask Google for permission to create and manage a separate timetable calendar created by ${legalConfig.tradingName}. We use this permission to add the timetable you selected, apply your reminder preferences, and update those ${legalConfig.tradingName}-created events when the timetable changes. ${legalConfig.tradingName} does not use this permission to read or change events in your existing personal calendars.`}
          tone="warning"
          continueLabel="Continue to Google"
          onContinue={continueGoogle}
        >
          <div className="dialog-links">
            <a href="/privacy">Privacy Policy</a>
            <a href="/data-deletion">Data deletion</a>
            <a href="/privacy#google-calendar-data">
              Learn how Google Calendar data is used
            </a>
            <button type="button" onClick={() => setGoogleDisclosureOpen(false)}>
              Use another calendar method
            </button>
          </div>
        </MessageDialog>
      )}
      {status === "error" && error && (
        <MessageDialog
          title="Calendar action needs attention"
          text={error}
          tone="warning"
          onContinue={() => {
            setStatus("idle");
            setError("");
          }}
        />
      )}
      {status === "success" && (
        <MessageDialog
          title="Your semester is organised"
          text={`${providerUsed} · ${timetable.events.length} events · ${selectedPreset.label} reminders${
            next && nextReminder
              ? `. Next: ${next.event.title}; reminder at ${nextReminder.toLocaleTimeString(
                  "en-ZW",
                  {
                    hour: "2-digit",
                    minute: "2-digit",
                  },
                )}.`
              : "."
          }`}
          onContinue={() => setStatus("idle")}
        />
      )}
    </div>
  );
}

function PublicTimetablePage() {
  usePageMetadata({
    title: `${demoTimetable.title} | CalenderZW`,
    description:
      "Review this student timetable, choose reminders, and add it to a supported calendar.",
    canonicalPath: `/t/${demoTimetable.slug}`,
  });
  const [wizardOpen, setWizardOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState(reminderPresets[0]);
  const [reportOpen, setReportOpen] = useState(false);
  const [dismissedCalendarState, setDismissedCalendarState] = useState<
    string | null
  >(null);
  const calendarState = new URLSearchParams(window.location.search).get(
    "calendar",
  );
  const calendarMessage =
    calendarState === "google-success"
      ? {
          title: "Google Calendar connected",
          text: "Your classes were added to a dedicated timetable calendar.",
          tone: "success" as const,
        }
      : calendarState === "google-setup-needed"
        ? {
            title: "Google Calendar setup needs one more step",
            text: "Our team needs to finish the Google configuration. You can still download your calendar now.",
            tone: "warning" as const,
          }
        : calendarState === "google-failed"
          ? {
              title: "Google Calendar could not finish",
              text: "Your timetable is still safe here. Try again or download the calendar file.",
              tone: "warning" as const,
            }
          : null;
  const activeCalendarMessage =
    calendarState !== dismissedCalendarState ? calendarMessage : null;
  return (
    <Shell>
      <main>
        <TimetableHero
          timetable={demoTimetable}
          onSync={() => setWizardOpen(true)}
        />
        <div className="content-grid">
          <div>
            <NextLectureCard
              timetable={demoTimetable}
              reminders={selectedPreset.minutes}
            />
            <AgendaView timetable={demoTimetable} />
          </div>
          <aside className="side-panel">
            <h2>Trust details</h2>
            <p>{demoTimetable.source}</p>
            <p>Verified by {demoTimetable.verifiedBy}</p>
            <a href={`/t/${demoTimetable.slug}/history`}>
              <History size={18} /> View update history
            </a>
            <button onClick={() => setReportOpen(true)}>
              <Flag size={18} /> Report a problem
            </button>
            <button
              onClick={() =>
                navigator.share?.({
                  title: demoTimetable.title,
                  url: window.location.href,
                }) ?? navigator.clipboard.writeText(window.location.href)
              }
            >
              <Share2 size={18} /> Share timetable
            </button>
            <button
              onClick={() => downloadIcs(demoTimetable, selectedPreset.minutes)}
            >
              <Download size={18} /> Download .ics
            </button>
            <div className="qr-block">
              <QrCode size={84} />
              <span>QR poster ready</span>
            </div>
          </aside>
        </div>
        <WeekView timetable={demoTimetable} />
        <div className="sticky-action">
          <button className="primary" onClick={() => setWizardOpen(true)}>
            <CalendarCheck size={20} /> Add to my calendar
          </button>
        </div>
      </main>
      {wizardOpen && (
        <SyncWizard
          timetable={demoTimetable}
          selectedPreset={selectedPreset}
          setSelectedPreset={setSelectedPreset}
          onClose={() => setWizardOpen(false)}
        />
      )}
      {reportOpen && <ReportDialog onClose={() => setReportOpen(false)} />}
      {activeCalendarMessage && (
        <MessageDialog
          title={activeCalendarMessage.title}
          text={activeCalendarMessage.text}
          tone={activeCalendarMessage.tone}
          onContinue={() => setDismissedCalendarState(calendarState)}
        />
      )}
    </Shell>
  );
}

function ReportDialog({ onClose }: { onClose: () => void }) {
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [reference, setReference] = useState("");
  return (
    <div className="sheet-backdrop" role="presentation">
      <section
        className="sync-sheet compact"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
      >
        <div className="sheet-header">
          <h2 id="report-title">Report timetable issue</h2>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close report form"
          >
            x
          </button>
        </div>
        {submitted ? (
          <div className="success-state tall">
            <Check />
            <strong>Report sent to verification queue.</strong>
            <span>Reference {reference}</span>
          </div>
        ) : (
          <form
            className="report-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const parsed = correctionReportSchema.safeParse({
                timetableId: demoTimetable.id,
                issueType: form.get("issueType"),
                details: form.get("details"),
                contact: form.get("contact") || undefined,
              });
              if (!parsed.success) {
                setError(
                  parsed.error.issues[0]?.message ??
                    "Check the report details.",
                );
                return;
              }
              setReference(`ECO-${Date.now().toString().slice(-5)}`);
              setSubmitted(true);
            }}
          >
            <label>
              Issue type
              <select name="issueType">
                <option value="wrong_venue">Wrong venue</option>
                <option value="wrong_time">Wrong time</option>
                <option value="missing_lecture">Missing lecture</option>
                <option value="duplicate">Duplicate</option>
                <option value="outdated">Outdated</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              Details
              <textarea
                name="details"
                placeholder="Example: DB202 is now in Lab 4 from 10:00."
              />
            </label>
            <label>
              Contact for follow-up
              <input name="contact" placeholder="Optional email or phone" />
            </label>
            {error && <p className="field-error">{error}</p>}
            <button className="primary" type="submit">
              Send report
            </button>
          </form>
        )}
      </section>
    </div>
  );
}

function FinderPage() {
  usePageMetadata({
    title: "Find your timetable | CalenderZW",
    description:
      "Search for a student timetable by institution, programme, year, group, or semester.",
    canonicalPath: "/find",
  });
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<"request" | "upload" | null>(null);
  const [submitted, setSubmitted] = useState<TimetableSubmission | null>(null);
  const results = useMemo(
    () =>
      popularTimetables.filter((item) =>
        `${item.institution} ${item.programme} ${item.part}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [query],
  );
  return (
    <Shell>
      <main className="page">
        <PageHeader
          icon={<Search />}
          title="Find your timetable"
          text="Search by institution, programme, year, group, or semester."
        />
        <label className="search-box">
          <Search size={20} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Try BSc Software Engineering Part 2.1"
          />
        </label>
        <div className="result-list">
          {results.map((timetable) => (
            <TimetableCard timetable={timetable} key={timetable.id} />
          ))}
        </div>
        <section className="request-band">
          <h2>No timetable has been published for this class yet.</h2>
          <button className="primary" onClick={() => setDialog("request")}>
            Request it
          </button>
          <button className="secondary" onClick={() => setDialog("upload")}>
            Upload timetable
          </button>
        </section>
      </main>
      {dialog && (
        <SubmissionDialog
          type={dialog}
          onClose={() => setDialog(null)}
          onSubmitted={(submission) => {
            setSubmitted(submission);
            setDialog(null);
          }}
        />
      )}
      {submitted && (
        <div className="sheet-backdrop" role="presentation">
          <section
            className="sync-sheet compact"
            role="dialog"
            aria-modal="true"
            aria-labelledby="submission-success"
          >
            <div className="sheet-header">
              <h2 id="submission-success">Submitted</h2>
              <button
                className="icon-button"
                onClick={() => setSubmitted(null)}
                aria-label="Close submission success"
              >
                x
              </button>
            </div>
            <div className="success-state tall">
              <Check />
              <strong>
                {submitted.type === "request"
                  ? "Timetable request received."
                  : "Timetable upload received."}
              </strong>
              <span>Admin reference {submitted.id.slice(0, 8)}</span>
            </div>
          </section>
        </div>
      )}
    </Shell>
  );
}

function SubmissionDialog({
  type,
  onClose,
  onSubmitted,
}: {
  type: "request" | "upload";
  onClose: () => void;
  onSubmitted: (submission: TimetableSubmission) => void;
}) {
  const [error, setError] = useState("");
  const isUpload = type === "upload";

  return (
    <div className="sheet-backdrop" role="presentation">
      <section
        className="sync-sheet compact"
        role="dialog"
        aria-modal="true"
        aria-labelledby="submission-title"
      >
        <div className="sheet-header">
          <h2 id="submission-title">
            {isUpload ? "Upload timetable" : "Request timetable"}
          </h2>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close timetable submission"
          >
            x
          </button>
        </div>
        <form
          className="report-form"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const institution = String(form.get("institution") ?? "").trim();
            const programme = String(form.get("programme") ?? "").trim();
            const part = String(form.get("part") ?? "").trim();
            const semester = String(form.get("semester") ?? "").trim();
            const file = form.get("file");

            if (!institution || !programme || !part || !semester) {
              setError(
                "Institution, programme, part, and semester are required.",
              );
              return;
            }
            if (isUpload && (!(file instanceof File) || !file.name)) {
              setError("Choose a timetable file to upload.");
              return;
            }

            const submission = addSubmission({
              type,
              institution,
              programme,
              part,
              semester,
              contact: String(form.get("contact") ?? "").trim() || undefined,
              fileName: file instanceof File ? file.name : undefined,
            });
            onSubmitted(submission);
          }}
        >
          <label>
            Institution
            <input name="institution" defaultValue="aiDo Demo University" />
          </label>
          <label>
            Programme
            <input name="programme" placeholder="BSc Software Engineering" />
          </label>
          <label>
            Part or year
            <input name="part" placeholder="Part 2.1" />
          </label>
          <label>
            Semester
            <input name="semester" placeholder="Semester 2, 2026" />
          </label>
          {isUpload && (
            <label>
              Timetable file
              <input name="file" type="file" accept=".csv,.pdf,image/*" />
            </label>
          )}
          <label>
            Contact for follow-up
            <input name="contact" placeholder="Optional email or phone" />
          </label>
          {error && <p className="field-error">{error}</p>}
          <button className="primary" type="submit">
            {isUpload ? "Upload for review" : "Send request"}
          </button>
        </form>
      </section>
    </div>
  );
}

function TimetableCard({ timetable }: { timetable: Timetable }) {
  return (
    <a className="timetable-card" href={`/t/${timetable.slug}`}>
      <VerificationBadge status={timetable.verificationStatus} />
      <strong>{timetable.programme}</strong>
      <span>
        {timetable.part} · {timetable.semester} · {timetable.groupName}
      </span>
      <em>{timetable.events.length} weekly events</em>
    </a>
  );
}

function HomePage() {
  usePageMetadata({
    title: "CalenderZW | Add your university timetable to your calendar",
    description:
      "Find a verified student timetable, choose useful reminders, and add lectures to Google Calendar, Apple Calendar, Outlook, or another calendar app.",
    canonicalPath: "/",
    ogTitle: "CalenderZW",
    ogDescription: "Add your university timetable to your calendar.",
  });

  return (
    <Shell>
      <main className="home-page">
        <section className="home-hero">
          <div className="home-hero-copy">
            <p className="eyebrow">Your timetable, already organised</p>
            <h1>Add your university timetable to your calendar</h1>
            <p>
              CalenderZW helps students find a verified class timetable, choose
              useful reminders, and add lectures to Google Calendar, Apple
              Calendar, Outlook, or another calendar app.
            </p>
            <p className="trust-copy">
              Google Calendar connection is optional. When you choose it,
              CalenderZW creates and manages a separate timetable calendar. It
              does not read or modify events in your existing personal
              calendars. CalenderZW is operated by aiDo.
            </p>
            <div className="hero-actions">
              <a className="primary" href="/find">
                <Search size={20} aria-hidden="true" />
                Find my timetable
              </a>
              <a className="secondary dark" href="#how-it-works">
                See how it works
              </a>
              <a className="text-link" href={`/t/${demoTimetable.slug}`}>
                View a sample timetable
              </a>
            </div>
          </div>
          <div className="product-preview" aria-label="CalenderZW product preview">
            <div className="preview-top">
              <img src={BRAND.iconPath} alt="" />
              <strong>CalenderZW</strong>
              <VerificationBadge status="community_verified" />
            </div>
            <ol>
              <li>Open a shared timetable or scan a QR code.</li>
              <li>Check the timetable and verification status.</li>
              <li>Choose reminder timing.</li>
              <li>Add it to a supported calendar.</li>
            </ol>
          </div>
        </section>

        <section id="how-it-works" className="home-section">
          <h2>How it works</h2>
          <div className="section-grid three">
            <article>
              <h3>Find your class</h3>
              <p>
                Search by institution, programme, year, semester, or shared
                class link.
              </p>
            </article>
            <article>
              <h3>Choose your reminders</h3>
              <p>
                Select a prepared, on-time, commuter, or custom reminder setup
                after you have seen the timetable.
              </p>
            </article>
            <article>
              <h3>Add your timetable</h3>
              <p>
                Connect Google Calendar, subscribe with Apple Calendar, or
                download a standard calendar file.
              </p>
            </article>
          </div>
        </section>

        <section id="calendar-options" className="home-section">
          <h2>Calendar options</h2>
          <div className="section-grid four">
            <article>
              <h3>Google Calendar</h3>
              <p>
                CalenderZW creates a dedicated secondary calendar, adds and
                maintains only timetable events selected by you, requires Google
                consent, and does not inspect existing personal calendars.
              </p>
            </article>
            <article>
              <h3>Apple Calendar</h3>
              <p>
                Use one-tap webcal subscription where supported. Apple Calendar
                asks you to confirm and controls refresh timing.
              </p>
            </article>
            <article>
              <h3>Universal .ics</h3>
              <p>
                Download a standard calendar file for many calendar apps. Future
                updates may require a new download unless you subscribe.
              </p>
            </article>
            <article>
              <h3>Outlook</h3>
              <p>
                Use supported subscription or .ics import paths. CalenderZW does
                not currently present a direct Outlook API connection.
              </p>
            </article>
          </div>
        </section>

        <section id="google-calendar-access" className="home-section disclosure-band">
          <h2>Why CalenderZW asks for Google Calendar access</h2>
          <p>
            If you choose direct Google Calendar synchronisation, CalenderZW asks
            for permission to create and manage a separate calendar created by
            CalenderZW. We use that permission to add the timetable you selected,
            apply your reminder choices, and update those CalenderZW-created
            events when the published timetable changes.
          </p>
          <p>
            We do not use this permission to read, analyse, change, or delete
            events in your existing personal calendars.
          </p>
          <div className="inline-links">
            <a href="/privacy">Read our Privacy Policy</a>
            <a href="/data-deletion">Learn about data deletion</a>
            <a href="/find">Use .ics instead</a>
          </div>
        </section>

        <section className="home-section">
          <h2>Timetable trust</h2>
          <div className="section-grid three">
            <article>
              <h3>Official</h3>
              <p>Published or confirmed by an institution or authorised team.</p>
            </article>
            <article>
              <h3>Community verified</h3>
              <p>Checked by class representatives or verified contributors.</p>
            </article>
            <article>
              <h3>Draft or unverified</h3>
              <p>
                Useful for coordination, but students should verify
                high-consequence information such as exam dates with official
                institution sources.
              </p>
            </article>
          </div>
          <p className="helper">
            Timetable information may be supplied by institutions, authorised
            programme administrators, class representatives, or verified
            contributors.
          </p>
        </section>

        <section className="home-section">
          <h2>Built for student routines</h2>
          <ul className="benefit-list">
            <li>Stop searching through screenshots and chat history.</li>
            <li>See times and venues in one place.</li>
            <li>Use calendar-native reminders.</li>
            <li>Receive timetable updates where supported.</li>
            <li>Share one class link or QR code.</li>
            <li>Report incorrect timetable details.</li>
          </ul>
        </section>

        <section className="home-section privacy-summary">
          <h2>Privacy summary</h2>
          <p>
            CalenderZW collects only the information needed to provide timetable
            and calendar features. Google Calendar access is optional and
            limited to a separate calendar created by CalenderZW. We do not sell
            Google user data or use it for advertising.
          </p>
          <div className="inline-links">
            <a href="/privacy">Privacy Policy</a>
            <a href="/terms">Terms of Service</a>
            <a href="/data-deletion">Data deletion</a>
            <a href="/support">Support</a>
          </div>
        </section>
      </main>
    </Shell>
  );
}

function PageHeader({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <header className="page-header">
      <span>{icon}</span>
      <div>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
    </header>
  );
}

function DashboardPage() {
  return (
    <Shell>
      <main className="page dashboard">
        <PageHeader
          icon={<Home />}
          title="Dashboard"
          text="Pilot operations for students, representatives, verifiers, and institution admins."
        />
        <div className="metrics">
          <MetricCard label="Views" value="1,248" icon={<BarChart3 />} />
          <MetricCard label="Syncs" value="534" icon={<CalendarCheck />} />
          <MetricCard label="Reports" value="7" icon={<AlertTriangle />} />
          <MetricCard label="Published" value="18" icon={<ShieldCheck />} />
        </div>
        <section className="ops-grid">
          <ActionPanel
            icon={<Upload />}
            title="Representative"
            items={[
              "Create draft timetable",
              "Import CSV",
              "Generate QR poster",
              "View activation stats",
            ]}
          />
          <ActionPanel
            icon={<FileClock />}
            title="Verifier"
            items={[
              "Review submitted versions",
              "Compare venue changes",
              "Publish official version",
              "Rollback safely",
            ]}
          />
          <ActionPanel
            icon={<Lock />}
            title="Institution admin"
            items={[
              "Manage programmes",
              "Assign roles",
              "Inspect reports",
              "Export audit logs",
            ]}
          />
        </section>
      </main>
    </Shell>
  );
}

function MetricCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <article className="metric-card">
      <span>{icon}</span>
      <small>{label}</small>
      <strong>{value}</strong>
    </article>
  );
}

function ActionPanel({
  icon,
  title,
  items,
}: {
  icon: React.ReactNode;
  title: string;
  items: string[];
}) {
  return (
    <article className="action-panel">
      <span>{icon}</span>
      <h2>{title}</h2>
      {items.map((item) => (
        <button key={item}>{item}</button>
      ))}
    </article>
  );
}

function HistoryPage() {
  return (
    <Shell>
      <main className="page">
        <PageHeader
          icon={<History />}
          title="Update history"
          text="Published changes remain auditable and reversible."
        />
        <div className="timeline">
          {demoTimetable.history.map((item) => (
            <article key={item.id}>
              <strong>{item.version}</strong>
              <p>{item.summary}</p>
              <small>
                {new Date(item.publishedAt).toLocaleString("en-ZW")} by{" "}
                {item.publishedBy}
              </small>
            </article>
          ))}
        </div>
      </main>
    </Shell>
  );
}

const privacySections = [
  "Scope",
  "Information we collect",
  "Google Calendar data",
  "Calendar subscriptions",
  "Use and sharing",
  "Retention and security",
  "Your choices",
  "Contact",
];

function LegalDocumentPage({ type }: { type: "privacy" | "terms" | "data" }) {
  const isPrivacy = type === "privacy";
  const isTerms = type === "terms";
  const title = isPrivacy
    ? "Privacy Policy"
    : isTerms
      ? "Terms of Service"
      : "Data deletion";
  usePageMetadata({
    title: `${title} | ${legalConfig.tradingName}`,
    description: `${title} for ${legalConfig.tradingName}, the student timetable and calendar synchronisation service operated by ${legalConfig.operatorName}.`,
    canonicalPath: type === "data" ? "/data-deletion" : `/${type}`,
  });

  return (
    <Shell>
      <main className="legal-page">
        <aside className="legal-toc" aria-label={`${title} sections`}>
          {(isPrivacy
            ? privacySections
            : [
                "Overview",
                "Google Calendar",
                "Private feeds",
                "Requests",
                "Contact",
              ]
          ).map((item) => (
            <a key={item} href={`#${item.toLowerCase().replaceAll(" ", "-")}`}>
              {item}
            </a>
          ))}
        </aside>
        <article className="legal-document">
          <p className="eyebrow">{legalConfig.tradingName} legal</p>
          <h1>{title}</h1>
          <p>
            Effective date: {legalConfig.effectiveDate}
            <br />
            Last updated: {legalConfig.lastUpdatedDate}
          </p>
          {isPrivacy && <PrivacyContent />}
          {isTerms && <TermsContent />}
          {type === "data" && <DataDeletionContent />}
        </article>
      </main>
    </Shell>
  );
}

function PrivacyContent() {
  return (
    <>
      <p className="summary-card">
        CalenderZW uses the minimum access needed to create and maintain a
        separate Google Calendar containing the timetable you choose. We do not
        read or modify your existing personal calendars.
      </p>
      <section id="scope">
        <h2>1. Scope</h2>
        <p>
          This policy applies to timetable pages, administrator tools, calendar
          feeds, Google Calendar connection, downloads, and support services
          for {legalConfig.tradingName}, operated by{" "}
          {legalConfig.operatorName} from {legalConfig.publicAppUrl}.
        </p>
      </section>
      <section id="information-we-collect">
        <h2>2. Information we collect</h2>
        <h3>Information you provide</h3>
        <p>
          We may collect account email, institution and class selections,
          timetable submissions, reminder preferences, reports, support
          messages, and payment references when paid services are enabled.
          Students can view public timetables and download public calendar files
          without an account.
        </p>
        <h3>Information collected automatically</h3>
        <p>
          We may collect device/browser type, operating system, approximate
          region, server IP logs, page interactions, diagnostics, timestamps,
          anonymous session identifiers, subscription identifiers, and feed
          retrieval timestamps for security and reliability.
        </p>
      </section>
      <section id="google-calendar-data">
        <h2>3. Google Calendar data</h2>
        <p>
          When you choose direct Google Calendar synchronisation, CalenderZW
          requests permission to create and manage a separate secondary calendar
          created by CalenderZW. We use it only to add selected timetable
          events, reminders, updates, cancellations, failure recovery, and
          disconnect actions for that app-created calendar.
        </p>
        <p>
          CalenderZW does not use this permission to read, analyse, modify, or
          delete events from your pre-existing personal calendars. CalenderZW's
          use and transfer of information received from Google APIs adheres to
          the Google API Services User Data Policy, including the Limited Use
          requirements.
        </p>
        <p>
          CalenderZW does not use information obtained through Google Workspace
          APIs to develop, improve, or train generalised or non-personalised
          artificial intelligence or machine-learning models.
        </p>
      </section>
      <section id="calendar-subscriptions">
        <h2>4. Calendar subscriptions</h2>
        <p>
          Private feed URLs are unguessable capability links. Anyone possessing
          one may be able to view the timetable feed. CalenderZW stores hashed
          feed tokens and lets feed records be revoked.
        </p>
      </section>
      <section id="use-and-sharing">
        <h2>5. Use and sharing</h2>
        <p>
          We use data to show timetables, create calendar files/subscriptions,
          apply reminders, process reports, provide support, protect the
          service, diagnose failures, comply with law, and improve user-facing
          features. We do not sell personal information or Google user data, and
          we do not use Google user data for targeted advertising.
        </p>
        <p>
          Current production processors should be confirmed by the operator
          before submission. CalenderZW does not share Google user data with
          advertising services.
        </p>
      </section>
      <section id="retention-and-security">
        <h2>6. Retention and security</h2>
        <p>
          Public timetable audit history may be retained for accuracy. Google
          tokens are retained only while direct sync remains connected. Current
          safeguards include HTTPS requirements, server-side credentials, secure
          SameSite cookies, hashed private-feed tokens, API validation, and
          dependency checks. Encrypted refresh-token persistence requires the
          production token store to be configured.
        </p>
      </section>
      <section id="your-choices">
        <h2>7. Your choices</h2>
        <p>
          You can avoid Google Calendar, use .ics instead, disconnect Google,
          revoke Google access in your Google Account, request feed revocation,
          change reminders by creating a new subscription, and request deletion
          at <a href="/data-deletion">/data-deletion</a>.
        </p>
      </section>
      <section id="contact">
        <h2>8. Contact</h2>
        <p>
          {legalConfig.operatorName}
          <br />
          Operator address: {legalConfig.operatorAddress}
          <br />
          {legalConfig.country}
          <br />
          Privacy:{" "}
          <a href={`mailto:${legalConfig.privacyEmail}`}>
            {legalConfig.privacyEmail}
          </a>
          <br />
          Support:{" "}
          <a href={`mailto:${legalConfig.supportEmail}`}>
            {legalConfig.supportEmail}
          </a>
        </p>
      </section>
    </>
  );
}

function TermsContent() {
  return (
    <>
      <section id="overview">
        <h2>1. Agreement and service</h2>
        <p>
          These Terms govern access to {legalConfig.tradingName}, a timetable
          discovery, calendar synchronisation, reminder, and academic scheduling
          service operated by {legalConfig.operatorName}. Availability may vary
          by institution, provider, device, and location.
        </p>
      </section>
      <section id="google-calendar">
        <h2>2. Google Calendar connection</h2>
        <p>
          Google connection is voluntary and narrowly scoped. CalenderZW creates
          and manages a separate secondary calendar, and you can disconnect
          access. Google services are governed by Google's terms, and no Google
          endorsement is implied.
        </p>
      </section>
      <section id="private-feeds">
        <h2>3. Accuracy, reminders, and private feeds</h2>
        <p>
          Academic schedules can change without immediate notice. Check critical
          dates against official institution sources. Calendar providers and
          devices control final alert delivery and feed refresh frequency.
        </p>
      </section>
      <section id="requests">
        <h2>4. Submissions and acceptable use</h2>
        <p>
          Submitted timetable data must be authorised or reasonably based,
          non-malicious, and respectful of institutional rules. You grant
          CalenderZW the limited licence needed to host and display submitted
          timetable content to operate the service.
        </p>
      </section>
      <section id="contact">
        <h2>5. Governing law, paid features, and contact</h2>
        <p>
          These Terms are governed by the laws of {legalConfig.governingLaw},
          without prejudice to mandatory consumer protections that may apply in
          your country. {legalConfig.disputeVenue} will have jurisdiction,
          subject to applicable law.
        </p>
        <p>
          Paid features may be introduced in the future. Before a paid
          transaction is offered, CalenderZW will display the applicable price,
          currency, payment terms, and refund conditions.
        </p>
        <p>
          Contact{" "}
          <a href={`mailto:${legalConfig.supportEmail}`}>
            {legalConfig.supportEmail}
          </a>
          .
        </p>
      </section>
    </>
  );
}

function DataDeletionContent() {
  return (
    <>
      <section id="overview">
        <h2>Delete an account or records</h2>
        <p>
          Email{" "}
          <a href={`mailto:${legalConfig.privacyEmail}`}>
            {legalConfig.privacyEmail}
          </a>{" "}
          from the address associated with the account or connection. We will
          display or send a confirmation reference.
        </p>
      </section>
      <section id="google-calendar">
        <h2>Disconnect Google Calendar</h2>
        <p>
          Use account settings to disconnect Google Calendar, or revoke
          CalenderZW access from your Google Account third-party connections.
          You may keep or delete the app-created calendar before revocation.
        </p>
      </section>
      <section id="private-feeds">
        <h2>Revoke private feeds</h2>
        <p>
          Submit a feed revocation request from the same browser session or
          contact support with the subscription reference.
        </p>
      </section>
    </>
  );
}

function SupportPage() {
  usePageMetadata({
    title: "Support | CalenderZW",
    description:
      "CalenderZW support for timetable setup, Google disconnect, Apple Calendar subscriptions, .ics imports, and timetable problem reports.",
    canonicalPath: "/support",
  });

  return (
    <Shell>
      <main className="page support-page">
        <PageHeader
          icon={<ShieldCheck />}
          title="CalenderZW support"
          text={`Get help with timetable and calendar setup. Email ${legalConfig.supportEmail}.`}
        />
        <section className="section-grid two">
          <article className="action-panel">
            <h2>Calendar setup issues</h2>
            <p>
              If a calendar does not appear immediately, check that the selected
              reminder preset was saved, your device calendar sync is enabled,
              and your calendar app has network access.
            </p>
          </article>
          <article className="action-panel">
            <h2>Disconnect Google Calendar</h2>
            <p>
              Open account settings, choose Disconnect Google Calendar, and
              decide whether to keep or delete the CalenderZW-created calendar.
              You can also revoke access in your Google Account.
            </p>
          </article>
          <article className="action-panel">
            <h2>Apple subscription guidance</h2>
            <p>
              Use the Apple Calendar subscription option from the live HTTPS
              site. Apple Calendar controls refresh timing and may not update
              immediately after timetable changes.
            </p>
          </article>
          <article className="action-panel">
            <h2>.ics import guidance</h2>
            <p>
              Downloaded .ics files are useful for one-time imports into many
              calendar apps. Future timetable updates may require another
              download unless you use a subscription option.
            </p>
          </article>
          <article className="action-panel">
            <h2>Notification delivery</h2>
            <p>
              CalenderZW creates calendar reminders, but final notification
              delivery depends on the calendar provider, phone settings,
              battery mode, connectivity, and notification permissions.
            </p>
          </article>
          <article className="action-panel">
            <h2>Report a timetable problem</h2>
            <p>
              Open the timetable page and choose Report a problem, or email{" "}
              <a href={`mailto:${legalConfig.supportEmail}`}>
                {legalConfig.supportEmail}
              </a>{" "}
              with the class link and the correction needed.
            </p>
            <a href="/privacy">Privacy Policy</a>
            <a href="/data-deletion">Data deletion</a>
          </article>
        </section>
      </main>
    </Shell>
  );
}

function GoogleVerificationReadinessPage() {
  usePageMetadata({
    title: "Google verification readiness | CalenderZW",
    description:
      "Development-only Google OAuth verification readiness checklist for CalenderZW.",
    canonicalPath: "/admin/google-verification-readiness",
    robots: "noindex, nofollow",
  });

  const rows = [
    ["Canonical app name", BRAND.productName],
    ["Homepage URL", `${BRAND.origin}/`],
    ["Privacy URL", `${BRAND.origin}/privacy`],
    ["Terms URL", `${BRAND.origin}/terms`],
    ["Deletion URL", `${BRAND.origin}/data-deletion`],
    ["Support URL", `${BRAND.origin}/support`],
    ["OAuth scope", "https://www.googleapis.com/auth/calendar.app.created"],
    [
      "Redirect URI",
      `${BRAND.origin}/api/calendar/google/callback`,
    ],
    ["Google Calendar API enabled status", "Locally unknowable"],
    ["Legacy-name scan result", "Checked by automated tests"],
    ["Homepage direct-200 test", "Run production smoke test"],
    ["Legal-placeholder scan result", "Checked by automated tests"],
    ["Google disclosure present", "Homepage and pre-consent flow"],
    ["Production logo asset", BRAND.squareIconPath],
    ["Domain-verification status", "Requires external confirmation"],
  ];

  return (
    <Shell>
      <main className="page">
        <PageHeader
          icon={<ShieldCheck />}
          title="Google verification readiness"
          text="Reviewer checklist without secrets, tokens, OAuth codes, or private feed tokens."
        />
        <section className="readiness-table" aria-label="Verification values">
          {rows.map(([label, value]) => (
            <div key={label}>
              <strong>{label}</strong>
              <span>{value}</span>
            </div>
          ))}
        </section>
        <a
          className="primary download-checklist"
          href="/google-oauth-reviewer-checklist.md"
          download
        >
          <Download size={18} aria-hidden="true" />
          Download reviewer checklist
        </a>
      </main>
    </Shell>
  );
}

function AccountSettingsPage() {
  const [message, setMessage] = useState("");
  return (
    <Shell>
      <main className="page">
        <PageHeader
          icon={<Lock />}
          title="Account settings"
          text="Calendar privacy controls and legal links."
        />
        <section className="action-panel settings-panel">
          <h2>Calendar connections</h2>
          <p>
            Disconnect Google Calendar or request feed revocation when you no
            longer want external calendar updates.
          </p>
          <button
            onClick={() =>
              setMessage(
                "Google disconnect request recorded locally. Production uses /api/calendar/google/disconnect to revoke provider access when stored credentials exist.",
              )
            }
          >
            Disconnect Google Calendar
          </button>
          <a href="/data-deletion">Account and data deletion</a>
          <a href="/privacy#google-calendar-data">Google data use</a>
          <a href="/terms">Terms of Service</a>
          {message && <p className="content-notice">{message}</p>}
        </section>
      </main>
    </Shell>
  );
}

function AdminLoginPage() {
  return (
    <Shell>
      <main className="page admin-page">
        <PageHeader
          icon={<Lock />}
          title="Admin login"
          text="Administrative access is disabled until Supabase Auth, server-side roles, and RLS are wired into this deployment."
        />
        <section className="action-panel">
          <h2>Admin sign-in unavailable</h2>
          <p>
            The previous MVP login checked a client-visible email allowlist and
            was not a security boundary. It has been retired so production
            traffic cannot enter mock administration flows.
          </p>
          <p className="content-notice">
            Configure Supabase Auth, server-side role provisioning, and database
            policies before re-enabling admin access.
          </p>
        </section>
      </main>
    </Shell>
  );
}

// TODO: Delete this retired mock workbench when the Supabase-backed AdminShell lands.
function AdminPage() {
  const [events, setEvents] = useState<AcademicCalendarEvent[]>(
    demoTimetable.events,
  );
  const [submissions, setSubmissions] =
    useState<TimetableSubmission[]>(readSubmissions);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftEvent, setDraftEvent] = useState({
    courseCode: "",
    title: "",
    weekdayDate: "2026-08-17",
    startTime: "08:00",
    endTime: "10:00",
    location: "",
    lecturer: "",
    groupName: demoTimetable.groupName,
  });

  function resetDraft() {
    setEditingId(null);
    setDraftEvent({
      courseCode: "",
      title: "",
      weekdayDate: "2026-08-17",
      startTime: "08:00",
      endTime: "10:00",
      location: "",
      lecturer: "",
      groupName: demoTimetable.groupName,
    });
  }

  function upsertEvent() {
    const startsAtLocal = `${draftEvent.weekdayDate}T${draftEvent.startTime}:00`;
    const endsAtLocal = `${draftEvent.weekdayDate}T${draftEvent.endTime}:00`;
    if (new Date(startsAtLocal) >= new Date(endsAtLocal)) {
      window.alert("Start time must be before end time.");
      return;
    }
    if (!draftEvent.courseCode || !draftEvent.title || !draftEvent.location) {
      window.alert("Course code, title, and venue are required.");
      return;
    }

    const nextEvent: AcademicCalendarEvent = {
      id:
        editingId ??
        `${draftEvent.courseCode.toLowerCase()}-${draftEvent.weekdayDate}-${draftEvent.startTime}`.replace(
          /[^a-z0-9]+/g,
          "-",
        ),
      timetableId: demoTimetable.id,
      timetableVersionId: `local-${demoTimetable.version}`,
      courseCode: draftEvent.courseCode.toUpperCase(),
      title: draftEvent.title,
      location: draftEvent.location,
      lecturer: draftEvent.lecturer || undefined,
      groupName: draftEvent.groupName,
      timezone: demoTimetable.timezone,
      startsAtLocal,
      endsAtLocal,
      recurrence: {
        frequency: "weekly",
        interval: 1,
        weekdays: ["MO"],
        until: demoTimetable.semesterEnd,
      },
      reminders: [1440, 30],
      status: "confirmed",
      verificationStatus: demoTimetable.verificationStatus,
      sequence: editingId ? 4 : 1,
      lastModified: new Date().toISOString(),
    };

    setEvents((current) =>
      editingId
        ? current.map((event) => (event.id === editingId ? nextEvent : event))
        : [nextEvent, ...current],
    );
    track(editingId ? "admin_timetable_updated" : "admin_timetable_created");
    resetDraft();
  }

  function editEvent(event: AcademicCalendarEvent) {
    setEditingId(event.id);
    setDraftEvent({
      courseCode: event.courseCode,
      title: event.title,
      weekdayDate: event.startsAtLocal.slice(0, 10),
      startTime: event.startsAtLocal.slice(11, 16),
      endTime: event.endsAtLocal.slice(11, 16),
      location: event.location ?? "",
      lecturer: event.lecturer ?? "",
      groupName: event.groupName ?? demoTimetable.groupName,
    });
  }

  function closeSubmission(id: string) {
    const next = submissions.map((submission) =>
      submission.id === id
        ? { ...submission, status: "closed" as const }
        : submission,
    );
    setSubmissions(next);
    saveSubmissions(next);
  }

  return (
    <Shell>
      <main className="page admin-page">
        <PageHeader
          icon={<FileClock />}
          title="Admin timetables"
          text="Simple MVP controls for creating, editing, publishing, previewing, and archiving timetables."
        />
        <section className="admin-grid">
          <article className="action-panel">
            <h2>{demoTimetable.programme}</h2>
            <p>
              {demoTimetable.part} · {demoTimetable.semester} · {events.length}{" "}
              events
            </p>
            <button onClick={() => track("admin_timetable_updated")}>
              Edit metadata
            </button>
            <button onClick={() => track("admin_timetable_updated")}>
              Edit lecture entries
            </button>
            <button onClick={() => track("admin_timetable_published")}>
              Publish new version
            </button>
            <a href={`/t/${demoTimetable.slug}`}>Preview public page</a>
          </article>
          <article className="action-panel">
            <h2>Create timetable</h2>
            <p>
              Production should persist these forms through Supabase with RLS
              and server validation.
            </p>
            <button onClick={() => track("admin_timetable_created")}>
              New timetable
            </button>
            <button>Duplicate current timetable</button>
            <button>Archive timetable</button>
            <button>Download QR code</button>
          </article>
          <article className="action-panel">
            <h2>Reports and sync</h2>
            <p>
              Publishing queues Google sync jobs and updates feed output while
              keeping stable event identities.
            </p>
            <button>View reported problems</button>
            <button>View subscription counts</button>
            <button>Revoke calendar link</button>
          </article>
        </section>
        <section className="admin-workbench">
          <article className="admin-editor">
            <h2>Lecture CRUD</h2>
            <div className="admin-form inline-editor">
              <label>
                Code
                <input
                  value={draftEvent.courseCode}
                  onChange={(event) =>
                    setDraftEvent((draft) => ({
                      ...draft,
                      courseCode: event.target.value,
                    }))
                  }
                  placeholder="SE201"
                />
              </label>
              <label>
                Class name
                <input
                  value={draftEvent.title}
                  onChange={(event) =>
                    setDraftEvent((draft) => ({
                      ...draft,
                      title: event.target.value,
                    }))
                  }
                  placeholder="Software Engineering"
                />
              </label>
              <label>
                Date
                <input
                  type="date"
                  value={draftEvent.weekdayDate}
                  onChange={(event) =>
                    setDraftEvent((draft) => ({
                      ...draft,
                      weekdayDate: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Start
                <input
                  type="time"
                  value={draftEvent.startTime}
                  onChange={(event) =>
                    setDraftEvent((draft) => ({
                      ...draft,
                      startTime: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                End
                <input
                  type="time"
                  value={draftEvent.endTime}
                  onChange={(event) =>
                    setDraftEvent((draft) => ({
                      ...draft,
                      endTime: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Venue
                <input
                  value={draftEvent.location}
                  onChange={(event) =>
                    setDraftEvent((draft) => ({
                      ...draft,
                      location: event.target.value,
                    }))
                  }
                  placeholder="Innovation Hub"
                />
              </label>
              <label>
                Lecturer
                <input
                  value={draftEvent.lecturer}
                  onChange={(event) =>
                    setDraftEvent((draft) => ({
                      ...draft,
                      lecturer: event.target.value,
                    }))
                  }
                  placeholder="Dr N. Chigora"
                />
              </label>
              <label>
                Group
                <input
                  value={draftEvent.groupName}
                  onChange={(event) =>
                    setDraftEvent((draft) => ({
                      ...draft,
                      groupName: event.target.value,
                    }))
                  }
                />
              </label>
              <button className="primary" onClick={upsertEvent}>
                <Plus size={18} /> {editingId ? "Save class" : "Add class"}
              </button>
              {editingId && (
                <button className="secondary light" onClick={resetDraft}>
                  Cancel edit
                </button>
              )}
            </div>
          </article>
          <article className="admin-editor">
            <h2>Classes</h2>
            <div className="admin-list">
              {events.map((event) => (
                <div className="admin-row" key={event.id}>
                  <span>
                    <strong>
                      {event.courseCode} · {event.title}
                    </strong>
                    <small>
                      {event.startsAtLocal.slice(0, 10)} ·{" "}
                      {event.startsAtLocal.slice(11, 16)}-
                      {event.endsAtLocal.slice(11, 16)} · {event.location}
                    </small>
                  </span>
                  <button
                    onClick={() => editEvent(event)}
                    aria-label={`Edit ${event.title}`}
                  >
                    <Pencil size={17} />
                  </button>
                  <button
                    onClick={() =>
                      setEvents((current) =>
                        current.filter((item) => item.id !== event.id),
                      )
                    }
                    aria-label={`Delete ${event.title}`}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              ))}
            </div>
          </article>
          <article className="admin-editor">
            <h2>Requests and uploads</h2>
            <div className="admin-list">
              {submissions.length === 0 && (
                <p className="helper">No public requests or uploads yet.</p>
              )}
              {submissions.map((submission) => (
                <div className="admin-row" key={submission.id}>
                  <span>
                    <strong>
                      {submission.type === "request" ? "Request" : "Upload"} ·{" "}
                      {submission.programme}
                    </strong>
                    <small>
                      {submission.institution} · {submission.part} ·{" "}
                      {submission.semester}
                      {submission.fileName ? ` · ${submission.fileName}` : ""}
                    </small>
                  </span>
                  <em>{submission.status}</em>
                  {submission.status !== "closed" && (
                    <button onClick={() => closeSubmission(submission.id)}>
                      Close
                    </button>
                  )}
                </div>
              ))}
            </div>
          </article>
        </section>
      </main>
    </Shell>
  );
}

void AdminPage;

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty-state">
      <GraduationCap size={28} />
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}

export function App() {
  const path = currentPath();
  if (path === "/") return <HomePage />;
  if (path === "/privacy") return <LegalDocumentPage type="privacy" />;
  if (path === "/terms") return <LegalDocumentPage type="terms" />;
  if (path === "/data-deletion") return <LegalDocumentPage type="data" />;
  if (path === "/support") return <SupportPage />;
  if (path === "/account/settings") return <AccountSettingsPage />;
  if (path === "/find" || path === "/institutions") return <FinderPage />;
  if (path === "/admin/google-verification-readiness")
    return <GoogleVerificationReadinessPage />;
  if (path === "/admin/login") return <AdminLoginPage />;
  if (path === "/admin") return <AdminPage />;
  if (path.startsWith("/admin/")) return <AdminLoginPage />;
  if (path === "/dashboard" || path.startsWith("/dashboard/"))
    return <DashboardPage />;
  if (path.endsWith("/history")) return <HistoryPage />;
  if (path.startsWith("/t/") || path.startsWith("/sync/"))
    return <PublicTimetablePage />;
  return <PublicTimetablePage />;
}
