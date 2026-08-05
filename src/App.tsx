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
const submissionStorageKey = "echo_calendar_submissions";

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
          <span className="brand-mark">EC</span>
          <span>
            <strong>{appConfig.productName}</strong>
            <small>
              {appConfig.familyName} by {appConfig.companyName}
            </small>
          </span>
        </a>
        <nav aria-label="Main navigation">
          <a href="/find">Find</a>
          <a href="/dashboard">Dashboard</a>
          <a href={appConfig.companyUrl}>aiDo</a>
        </nav>
      </header>
      {children}
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
                External calendar providers cannot fetch localhost. Use a public
                HTTPS tunnel or preview deployment for Apple, Google, and
                Outlook subscriptions. The personalised .ics download works
                locally.
              </p>
            )}
            <div className="provider-list always-options">
              <CalendarProviderCard
                icon={<GoogleGlyph />}
                title="Add to Google Calendar"
                text="Best for Gmail and Android. Creates a dedicated Echo Calendar calendar."
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
                text="Inferior fallback. It imports once and will not auto-update."
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
          {status === "error" && error}
        </div>

        {status === "success" && (
          <div className="success-state tall">
            <Check size={24} aria-hidden="true" />
            <strong>Your semester is organised.</strong>
            <span>
              {providerUsed} · {timetable.events.length} events ·{" "}
              {selectedPreset.label} reminders
            </span>
            {next && nextReminder && (
              <span>
                Next: {next.event.title}. Reminder at{" "}
                {nextReminder.toLocaleTimeString("en-ZW", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}
            {providerUsed === "Apple Calendar" && (
              <span>
                Apple Calendar opened. Confirm the subscription to finish.
              </span>
            )}
            {providerUsed === "calendar file" && (
              <span>
                Calendar file downloaded. Open it and confirm the import.
              </span>
            )}
          </div>
        )}

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
              window.alert(
                "Google uses OAuth for reliable updates. Apple uses webcal on public HTTPS. Download .ics works offline but will not receive future updates automatically.",
              );
            }}
          >
            View setup help
          </button>
          {subscription?.warnings.map((warning) => (
            <span key={warning}>{warning}</span>
          ))}
        </div>
      </section>
    </div>
  );
}

function PublicTimetablePage() {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState(reminderPresets[0]);
  const [reportOpen, setReportOpen] = useState(false);
  const calendarState = new URLSearchParams(window.location.search).get(
    "calendar",
  );
  return (
    <Shell>
      <main>
        <TimetableHero
          timetable={demoTimetable}
          onSync={() => setWizardOpen(true)}
        />
        {calendarState && (
          <div className="content-notice" role="status">
            {calendarState === "google-success" &&
              "Google Calendar is connected. Your classes were added to a dedicated Echo Calendar calendar."}
            {calendarState === "google-setup-needed" &&
              "Google Calendar direct sync is almost ready. For now, download the calendar file or use Apple Calendar subscription."}
            {calendarState === "google-failed" &&
              "Google Calendar could not finish setup. Your timetable is still safe here; try again or download the calendar file."}
          </div>
        )}
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

function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");

  return (
    <Shell>
      <main className="page admin-page">
        <PageHeader
          icon={<Lock />}
          title="Admin login"
          text="MVP admin access is restricted to the configured bootstrap list."
        />
        <form
          className="admin-form"
          onSubmit={(event) => {
            event.preventDefault();
            const allowed = (import.meta.env.VITE_MVP_ADMIN_EMAILS ?? "")
              .split(",")
              .map((item: string) => item.trim().toLowerCase())
              .filter(Boolean);
            if (!allowed.includes(email.toLowerCase())) {
              setError(
                "This email is not configured as an MVP administrator. Add it to MVP_ADMIN_EMAILS and create the server-side admin profile before production.",
              );
              return;
            }
            track("admin_logged_in");
            window.location.href = "/admin";
          }}
        >
          <label>
            Admin email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="admin@example.com"
              required
            />
          </label>
          {error && <p className="field-error">{error}</p>}
          <button className="primary" type="submit">
            Log in
          </button>
        </form>
      </main>
    </Shell>
  );
}

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
  if (path === "/find" || path === "/institutions") return <FinderPage />;
  if (path === "/admin/login") return <AdminLoginPage />;
  if (path === "/admin" || path.startsWith("/admin/")) return <AdminPage />;
  if (path === "/dashboard" || path.startsWith("/dashboard/"))
    return <DashboardPage />;
  if (path.endsWith("/history")) return <HistoryPage />;
  if (path.startsWith("/t/") || path.startsWith("/sync/"))
    return <PublicTimetablePage />;
  return <PublicTimetablePage />;
}
