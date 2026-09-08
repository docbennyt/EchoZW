from pathlib import Path

path = Path("src/ClassRepCorrectionSafetyEnhancement.tsx")
text = path.read_text()

if 'className="dr57-workspace"' in text:
    print("DR-57 cockpit already applied")
    raise SystemExit(0)

text = text.replace(
    'import { createPortal } from "react-dom";\n',
    'import { createPortal } from "react-dom";\nimport { Dialog } from "@base-ui/react/dialog";\n',
    1,
)

old_icons = '''import {
  CheckCircle2,
  LoaderCircle,
  RotateCcw,
  ShieldCheck,
  Trash2,
} from "lucide-react";'''
new_icons = '''import {
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  ChevronDown,
  Clock3,
  ExternalLink,
  LoaderCircle,
  MapPin,
  Pencil,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";'''
if old_icons not in text:
    raise SystemExit("Expected lucide import block not found")
text = text.replace(old_icons, new_icons, 1)

pilot_types_import = '''import type {
  PublicTimetable,
  TimetableCorrectionDirective,
  TimetableSessionException,
} from "./api/pilotTypes";'''
new_domain_imports = pilot_types_import + '''
import {
  formatOccurrenceTime,
  getUpcomingOccurrences,
} from "./domain/publicTimetable";
import { getTomorrowSchedule } from "./domain/tomorrowSchedule";'''
if pilot_types_import not in text:
    raise SystemExit("Expected pilot types import not found")
text = text.replace(pilot_types_import, new_domain_imports, 1)

text = text.replace('className="dr53-field"', 'className="dr57-field"', 1)

outcome_anchor = '''function outcomeMessage(outcome: string, saved: string) {'''
message_helper = '''function messageTone(message: string) {
  if (!message) return "neutral" as const;
  if (
    /could not|blocked|newer change|unavailable|network|failed|invalid|conflict|error/i.test(
      message,
    )
  ) {
    return "error" as const;
  }
  if (
    /saved|restored|complete|updated|already active|already exists|retry reused|added/i.test(
      message,
    )
  ) {
    return "success" as const;
  }
  return "neutral" as const;
}

'''
if outcome_anchor not in text:
    raise SystemExit("Outcome helper anchor not found")
text = text.replace(outcome_anchor, message_helper + outcome_anchor, 1)

state_anchor = '''  const recurringMutationKeyRef = useRef(newMutationKey());
  const extraMutationKeyRef = useRef(newMutationKey());'''
state_insert = state_anchor + '''
  const [activeDialog, setActiveDialog] = useState<"recurring" | "extra" | null>(
    null,
  );
  const [selectedDay, setSelectedDay] = useState(() => {
    const weekday = new Date().getDay();
    return weekday === 0 ? 7 : weekday;
  });
  const [showAllTomorrow, setShowAllTomorrow] = useState(false);
  const [showAllUpdates, setShowAllUpdates] = useState(false);'''
if state_anchor not in text:
    raise SystemExit("State anchor not found")
text = text.replace(state_anchor, state_insert, 1)

text = text.replace(
    '''      setEditingCorrection(null);
      setRecurringForm(defaultRecurringForm());
      await completeMutation(text);''',
    '''      setEditingCorrection(null);
      setRecurringForm(defaultRecurringForm());
      setActiveDialog(null);
      await completeMutation(text);''',
    1,
)
text = text.replace(
    '''      setEditingException(null);
      setExtraForm(defaultExtraForm());
      await completeMutation(text);''',
    '''      setEditingException(null);
      setExtraForm(defaultExtraForm());
      setActiveDialog(null);
      await completeMutation(text);''',
    1,
)

start = text.index("  function startEdit(entry: UpdateEntry) {")
return_marker = '\n\n  return (\n    <section className="dr53-workspace"'
return_start = text.index(return_marker, start)
new_start_edit = '''  function startEdit(entry: UpdateEntry) {
    setMessage("");
    if (entry.kind === "correction") {
      setEditingException(null);
      setEditingCorrection(entry.item);
      recurringMutationKeyRef.current = newMutationKey();
      setRecurringForm(correctionFormFromItem(entry.item));
      setActiveDialog("recurring");
      return;
    }
    if (entry.item.exceptionType !== "extra") {
      setMessage(
        "This moved/cancelled update can be safely removed here. Editing it is intentionally limited until its full replacement-time form is available.",
      );
      return;
    }
    setEditingCorrection(null);
    setEditingException(entry.item);
    extraMutationKeyRef.current = newMutationKey();
    setExtraForm(extraFormFromItem(entry.item));
    setActiveDialog("extra");
  }

  const tomorrow = timetable ? getTomorrowSchedule(timetable) : null;
  const nextClass = timetable
    ? getUpcomingOccurrences(timetable, new Date(), 1)[0]
    : null;
  const scheduleDays = [
    ...new Set((timetable?.sessions ?? []).map((session) => session.weekday)),
  ].sort((left, right) => left - right);
  const activeScheduleDay = scheduleDays.includes(selectedDay)
    ? selectedDay
    : (scheduleDays[0] ?? selectedDay);
  const activeSchedule = (timetable?.sessions ?? []).filter(
    (session) => session.weekday === activeScheduleDay,
  );
  const tomorrowSessions = tomorrow?.sessions ?? [];
  const visibleTomorrow = showAllTomorrow
    ? tomorrowSessions
    : tomorrowSessions.slice(0, 3);
  const orderedEntries = [...entries].sort((left, right) => {
    const leftTime = new Date(
      left.item.updatedAt ?? left.item.createdAt,
    ).getTime();
    const rightTime = new Date(
      right.item.updatedAt ?? right.item.createdAt,
    ).getTime();
    return rightTime - leftTime;
  });
  const visibleEntries = showAllUpdates
    ? orderedEntries
    : orderedEntries.slice(0, 5);
'''
text = text[:start] + new_start_edit + text[return_start:]

start = text.index('\n\n  return (\n    <section className="dr53-workspace"')
end_marker = '\n}\n\nfunction findClassRepMount()'
end = text.index(end_marker, start)
new_return = r'''

  return (
    <section className="dr57-workspace" aria-labelledby="dr57-workspace-title">
      <div className="dr57-topline">
        <div>
          <span className="dr57-eyebrow">
            <Sparkles size={14} /> Class truth cockpit
          </span>
          <h2 id="dr57-workspace-title">{assignment.classGroupLabel}</h2>
          <p>
            {assignment.programmeName} · {assignment.academicPeriodName}. Keep
            one class accurate without wading through admin settings.
          </p>
        </div>
        {assignment.publicSlug ? (
          <a
            className="dr57-public-link"
            href={`/t/${assignment.publicSlug}`}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={16} /> Public timetable
          </a>
        ) : null}
      </div>

      {message ? (
        <div
          className="dr57-message"
          data-tone={messageTone(message)}
          role="status"
          aria-live="polite"
        >
          <CheckCircle2 size={18} />
          <span>{message}</span>
        </div>
      ) : null}

      {undoState ? (
        <div className="dr57-undo" role="status">
          <span>Removed: {undoState.label}</span>
          <button
            type="button"
            disabled={busyUpdateId === undoState.id}
            onClick={() => void undoRemoval()}
          >
            <RotateCcw size={16} />
            {busyUpdateId === undoState.id ? "Restoring…" : "Undo"}
          </button>
        </div>
      ) : null}

      {duplicateGroups.length > 0 ? (
        <div className="dr53-duplicate-stack">
          {duplicateGroups.map(([key, group]) => (
            <DuplicateBanner
              key={key}
              entries={group}
              busy={busyFingerprint === key}
              onResolve={() => void resolveDuplicates(key, group)}
            />
          ))}
        </div>
      ) : null}

      <div className="dr57-live-grid">
        <article className="dr57-card dr57-next-card">
          <span className="dr57-card-label">
            <Clock3 size={15} /> Next class
          </span>
          {nextClass ? (
            <>
              <div className="dr57-next-course">
                {nextClass.session.courseCode}
              </div>
              <p className="dr57-next-name">{nextClass.session.courseName}</p>
              <div className="dr57-next-meta">
                <span>
                  <CalendarClock size={16} />
                  {formatOccurrenceTime(
                    nextClass.start,
                    timetable?.institutionTimezone || "Africa/Harare",
                  )}
                </span>
                <span>
                  <MapPin size={16} />
                  {nextClass.session.venue || "Venue not set"}
                </span>
              </div>
            </>
          ) : (
            <div className="dr57-empty-mini">
              {loading
                ? "Resolving your next class…"
                : "No upcoming class is currently resolved."}
            </div>
          )}
        </article>

        <article className="dr57-card dr57-tomorrow-card">
          <div className="dr57-card-heading">
            <div>
              <span className="dr57-card-label">
                <CalendarDays size={14} /> Tomorrow
              </span>
              <h3>{tomorrow?.tomorrowLabel || "Tomorrow's schedule"}</h3>
            </div>
            {tomorrowSessions.length ? (
              <small>{tomorrowSessions.length} classes</small>
            ) : null}
          </div>
          {visibleTomorrow.length ? (
            <div className="dr57-tomorrow-list">
              {visibleTomorrow.map((item) => (
                <div
                  className="dr57-tomorrow-row"
                  key={item.session.stableSessionKey}
                >
                  <time>{item.session.startTime.slice(0, 5)}</time>
                  <strong>{item.session.courseCode}</strong>
                  <span>
                    {item.session.courseName} · {item.session.venue || "TBA"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="dr57-empty-mini">
              {loading
                ? "Checking tomorrow…"
                : "No classes are currently resolved for tomorrow."}
            </div>
          )}
          {tomorrowSessions.length > 3 ? (
            <button
              className="dr57-inline-button"
              type="button"
              onClick={() => setShowAllTomorrow((current) => !current)}
            >
              {showAllTomorrow ? "Show less" : "View all tomorrow"}
            </button>
          ) : null}
        </article>
      </div>

      <div className="dr57-action-bar" aria-label="Class Rep quick actions">
        <button
          className="dr57-action primary"
          type="button"
          onClick={() => {
            setEditingCorrection(null);
            recurringMutationKeyRef.current = newMutationKey();
            setRecurringForm(defaultRecurringForm());
            setActiveDialog("recurring");
          }}
        >
          <Pencil size={18} /> Update timetable
        </button>
        <button
          className="dr57-action secondary"
          type="button"
          onClick={() => {
            setEditingException(null);
            extraMutationKeyRef.current = newMutationKey();
            setExtraForm(defaultExtraForm());
            setActiveDialog("extra");
          }}
        >
          <CalendarPlus size={18} /> Add extra class
        </button>
        {assignment.publicSlug ? (
          <a
            className="dr57-action ghost"
            href={`/t/${assignment.publicSlug}`}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={17} /> View public
          </a>
        ) : null}
      </div>

      <div className="dr57-main-grid">
        <article className="dr57-card dr57-section">
          <div className="dr57-card-heading">
            <div>
              <span className="dr57-card-label">Weekly schedule</span>
              <h3>Current class rhythm</h3>
            </div>
            <small>{timetable?.sessions.length ?? 0} recurring classes</small>
          </div>

          {scheduleDays.length ? (
            <>
              <div className="dr57-day-tabs" role="tablist" aria-label="Weekdays">
                {scheduleDays.map((day) => (
                  <button
                    className="dr57-day-tab"
                    type="button"
                    role="tab"
                    key={day}
                    aria-selected={activeScheduleDay === day}
                    onClick={() => setSelectedDay(day)}
                  >
                    {weekdayLabels[day].slice(0, 3)}
                  </button>
                ))}
              </div>
              <div className="dr57-schedule-list" role="tabpanel">
                {activeSchedule.map((session) => (
                  <div className="dr57-session" key={session.stableSessionKey}>
                    <time className="dr57-session-time">
                      {session.startTime.slice(0, 5)}
                    </time>
                    <strong>{session.courseCode}</strong>
                    <span>{session.courseName}</span>
                    <span className="dr57-session-venue">
                      <MapPin size={13} /> {session.venue || "TBA"}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="dr57-empty-mini">
              {loading
                ? "Loading your published schedule…"
                : "No recurring classes are currently published for this class."}
            </div>
          )}
        </article>

        <aside>
          <article className="dr57-card dr57-trust-card">
            <div>
              <ShieldCheck size={20} />
              <div>
                <span className="dr57-card-label">Safety layer</span>
                <h3>Class Rep updates stay auditable</h3>
              </div>
            </div>
            <p>
              Corrections never rewrite official source evidence. Retries reuse
              one logical save, exact duplicates are blocked, and newer official
              information only replaces a correction when its policy allows it.
            </p>
          </article>

          <article className="dr57-card dr57-section dr57-updates">
            <div className="dr57-card-heading">
              <div>
                <span className="dr57-card-label">Activity</span>
                <h3>Recent updates</h3>
              </div>
              <button
                className="dr57-inline-button"
                disabled={loading}
                type="button"
                onClick={() => void refresh()}
                aria-label="Refresh class updates"
              >
                <RefreshCw size={15} />
              </button>
            </div>

            {!loading && orderedEntries.length === 0 ? (
              <div className="dr57-empty-mini">
                No active corrections or extra classes.
              </div>
            ) : null}
            {loading && orderedEntries.length === 0 ? (
              <div className="dr57-empty-mini">Loading class updates…</div>
            ) : null}

            <div className="dr57-update-list">
              {visibleEntries.map((entry) => {
                const item = entry.item;
                const policy =
                  entry.kind === "correction"
                    ? entry.item.sourceMayReplace
                      ? "newer official info may replace"
                      : "kept until removed"
                    : "date-specific";
                const canEdit =
                  entry.kind === "correction" ||
                  entry.item.exceptionType === "extra";
                return (
                  <details
                    className="dr57-update-item"
                    key={`${entry.kind}:${item.id}`}
                  >
                    <summary>
                      <div>
                        <strong>{updateLabel(entry)}</strong>
                        <span>
                          {entry.kind === "correction"
                            ? `${entry.item.action} · ${policy}`
                            : `${entry.item.exceptionType} · ${policy}`}
                        </span>
                      </div>
                      <ChevronDown size={16} />
                    </summary>
                    <div className="dr57-update-details">
                      <p>{item.courseName || "Course name not recorded"}</p>
                      <small>{item.reason || "No reason recorded"}</small>
                      <small>
                        {item.creatorRole || "staff"} · revision {item.revision || 1}
                      </small>
                      <div className="dr57-update-actions">
                        {canEdit ? (
                          <button type="button" onClick={() => startEdit(entry)}>
                            <Pencil size={14} /> Edit
                          </button>
                        ) : null}
                        <button
                          className="danger"
                          disabled={busyUpdateId === item.id}
                          type="button"
                          onClick={() => void removeUpdate(entry)}
                        >
                          <Trash2 size={14} />
                          {busyUpdateId === item.id ? "Removing…" : "Remove"}
                        </button>
                      </div>
                    </div>
                  </details>
                );
              })}
            </div>
            {orderedEntries.length > 5 ? (
              <button
                className="dr57-inline-button"
                type="button"
                onClick={() => setShowAllUpdates((current) => !current)}
              >
                {showAllUpdates
                  ? "Show fewer updates"
                  : `Show all ${orderedEntries.length} updates`}
              </button>
            ) : null}
          </article>
        </aside>
      </div>

      <Dialog.Root
        open={activeDialog === "recurring"}
        onOpenChange={(open) => {
          if (!open && !savingRecurring) setActiveDialog(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="dr57-dialog-backdrop" />
          <Dialog.Viewport className="dr57-dialog-viewport">
            <Dialog.Popup className="dr57-dialog">
              <div className="dr57-dialog-header">
                <div>
                  <Dialog.Title>
                    {editingCorrection ? "Edit timetable update" : "Update timetable"}
                  </Dialog.Title>
                  <Dialog.Description>
                    Change one recurring class or add a new one. Nothing here
                    rewrites the official source record.
                  </Dialog.Description>
                </div>
                <Dialog.Close
                  className="dr57-dialog-close"
                  aria-label="Close timetable update"
                  disabled={savingRecurring}
                >
                  <X size={18} />
                </Dialog.Close>
              </div>

              <form className="dr57-form" onSubmit={submitRecurring}>
                <fieldset className="dr57-choice-grid">
                  <legend>Start with</legend>
                  <label className="dr57-choice">
                    <input
                      type="radio"
                      name="dr57-class-mode"
                      checked={Boolean(recurringForm.stableSessionKey)}
                      disabled={Boolean(editingCorrection) || !timetable?.sessions.length}
                      onChange={() =>
                        selectExistingSession(
                          timetable?.sessions[0]?.stableSessionKey ?? "",
                        )
                      }
                    />
                    <div>
                      <strong>Existing class</strong>
                      <span>Change or remove something already on the week.</span>
                    </div>
                  </label>
                  <label className="dr57-choice">
                    <input
                      type="radio"
                      name="dr57-class-mode"
                      checked={!recurringForm.stableSessionKey}
                      disabled={Boolean(editingCorrection)}
                      onChange={() => selectExistingSession("")}
                    />
                    <div>
                      <strong>New recurring class</strong>
                      <span>Add a class that should repeat every week.</span>
                    </div>
                  </label>
                </fieldset>

                {recurringForm.stableSessionKey ? (
                  <Field label="Which class?">
                    <select
                      value={recurringForm.stableSessionKey}
                      disabled={Boolean(editingCorrection)}
                      onChange={(event) => selectExistingSession(event.target.value)}
                    >
                      {timetable?.sessions.map((session) => (
                        <option
                          key={session.stableSessionKey}
                          value={session.stableSessionKey}
                        >
                          {session.courseCode} · {weekdayLabels[session.weekday]} {session.startTime.slice(0, 5)}
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : null}

                {recurringForm.stableSessionKey ? (
                  <fieldset className="dr57-choice-grid">
                    <legend>What changed?</legend>
                    <label className="dr57-choice">
                      <input
                        type="radio"
                        name="dr57-update-action"
                        checked={recurringForm.action === "modify"}
                        onChange={() =>
                          setRecurringForm((current) => ({
                            ...current,
                            action: "modify",
                          }))
                        }
                      />
                      <div>
                        <strong>Update class</strong>
                        <span>Time, venue, lecturer or class details changed.</span>
                      </div>
                    </label>
                    <label className="dr57-choice">
                      <input
                        type="radio"
                        name="dr57-update-action"
                        checked={recurringForm.action === "remove"}
                        onChange={() =>
                          setRecurringForm((current) => ({
                            ...current,
                            action: "remove",
                          }))
                        }
                      />
                      <div>
                        <strong>Remove recurring class</strong>
                        <span>Stop showing this weekly class in the resolved schedule.</span>
                      </div>
                    </label>
                  </fieldset>
                ) : null}

                {recurringForm.action !== "remove" ? (
                  <>
                    <div className="dr57-two-col">
                      <Field label="Course code">
                        <input
                          required
                          value={recurringForm.courseCode}
                          onChange={(event) =>
                            setRecurringForm((current) => ({
                              ...current,
                              courseCode: event.target.value,
                            }))
                          }
                        />
                      </Field>
                      <Field label="Course name">
                        <input
                          required
                          value={recurringForm.courseName}
                          onChange={(event) =>
                            setRecurringForm((current) => ({
                              ...current,
                              courseName: event.target.value,
                            }))
                          }
                        />
                      </Field>
                    </div>
                    <Field label="Weekday">
                      <select
                        value={recurringForm.weekday}
                        onChange={(event) =>
                          setRecurringForm((current) => ({
                            ...current,
                            weekday: Number(event.target.value),
                          }))
                        }
                      >
                        {weekdayLabels.slice(1).map((label, index) => (
                          <option key={label} value={index + 1}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <div className="dr57-two-col">
                      <Field label="Start">
                        <input
                          required
                          type="time"
                          value={recurringForm.startTime}
                          onChange={(event) =>
                            setRecurringForm((current) => ({
                              ...current,
                              startTime: event.target.value,
                            }))
                          }
                        />
                      </Field>
                      <Field label="End">
                        <input
                          required
                          type="time"
                          value={recurringForm.endTime}
                          onChange={(event) =>
                            setRecurringForm((current) => ({
                              ...current,
                              endTime: event.target.value,
                            }))
                          }
                        />
                      </Field>
                    </div>
                    <div className="dr57-two-col">
                      <Field label="Venue">
                        <input
                          value={recurringForm.venue}
                          onChange={(event) =>
                            setRecurringForm((current) => ({
                              ...current,
                              venue: event.target.value,
                            }))
                          }
                        />
                      </Field>
                      <Field label="Lecturer">
                        <input
                          value={recurringForm.lecturer}
                          onChange={(event) =>
                            setRecurringForm((current) => ({
                              ...current,
                              lecturer: event.target.value,
                            }))
                          }
                        />
                      </Field>
                    </div>
                  </>
                ) : null}

                <Field label="Reason">
                  <textarea
                    required
                    rows={3}
                    value={recurringForm.reason}
                    onChange={(event) =>
                      setRecurringForm((current) => ({
                        ...current,
                        reason: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="Source note (optional)">
                  <input
                    value={recurringForm.provenance}
                    placeholder="e.g. lecturer confirmed in class group"
                    onChange={(event) =>
                      setRecurringForm((current) => ({
                        ...current,
                        provenance: event.target.value,
                      }))
                    }
                  />
                </Field>

                <fieldset className="dr57-policy">
                  <legend>Official information policy</legend>
                  <label>
                    <input
                      type="radio"
                      name="dr57-source-policy"
                      checked={recurringForm.sourceMayReplace}
                      onChange={() =>
                        setRecurringForm((current) => ({
                          ...current,
                          sourceMayReplace: true,
                        }))
                      }
                    />
                    Use newer official information when available
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="dr57-source-policy"
                      checked={!recurringForm.sourceMayReplace}
                      onChange={() =>
                        setRecurringForm((current) => ({
                          ...current,
                          sourceMayReplace: false,
                        }))
                      }
                    />
                    Keep this update until someone deliberately removes it
                  </label>
                </fieldset>

                <div className="dr57-review" aria-label="Update review">
                  <strong>Review before save</strong>
                  <span>
                    {recurringForm.action === "add"
                      ? "Add recurring class"
                      : recurringForm.action === "remove"
                        ? "Remove recurring class"
                        : "Update recurring class"}
                    {recurringForm.action !== "remove"
                      ? ` · ${recurringForm.courseCode || "Course"} · ${weekdayLabels[recurringForm.weekday]} ${recurringForm.startTime}`
                      : ` · ${recurringForm.courseCode || "Selected class"}`}
                  </span>
                </div>

                <div className="dr57-form-actions">
                  <button
                    className="cancel"
                    type="button"
                    disabled={savingRecurring}
                    onClick={() => setActiveDialog(null)}
                  >
                    Cancel
                  </button>
                  <button
                    className="save"
                    disabled={savingRecurring}
                    type="submit"
                  >
                    {savingRecurring ? (
                      <LoaderCircle className="dr57-spin" size={17} />
                    ) : null}
                    {savingRecurring
                      ? "Saving…"
                      : editingCorrection
                        ? "Save correction edit"
                        : "Save correction"}
                  </button>
                </div>
              </form>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root
        open={activeDialog === "extra"}
        onOpenChange={(open) => {
          if (!open && !savingExtra) setActiveDialog(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="dr57-dialog-backdrop" />
          <Dialog.Viewport className="dr57-dialog-viewport">
            <Dialog.Popup className="dr57-dialog">
              <div className="dr57-dialog-header">
                <div>
                  <Dialog.Title>
                    {editingException ? "Edit extra class" : "Add extra class"}
                  </Dialog.Title>
                  <Dialog.Description>
                    Add one date-specific class. It will not repeat next week.
                  </Dialog.Description>
                </div>
                <Dialog.Close
                  className="dr57-dialog-close"
                  aria-label="Close extra class"
                  disabled={savingExtra}
                >
                  <X size={18} />
                </Dialog.Close>
              </div>

              <form className="dr57-form" onSubmit={submitExtra}>
                <Field label="Date">
                  <input
                    required
                    type="date"
                    value={extraForm.exceptionDate}
                    onChange={(event) =>
                      setExtraForm((current) => ({
                        ...current,
                        exceptionDate: event.target.value,
                      }))
                    }
                  />
                </Field>
                <div className="dr57-two-col">
                  <Field label="Course code">
                    <input
                      required
                      value={extraForm.courseCode}
                      onChange={(event) =>
                        setExtraForm((current) => ({
                          ...current,
                          courseCode: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="Course name">
                    <input
                      required
                      value={extraForm.courseName}
                      onChange={(event) =>
                        setExtraForm((current) => ({
                          ...current,
                          courseName: event.target.value,
                        }))
                      }
                    />
                  </Field>
                </div>
                <div className="dr57-two-col">
                  <Field label="Start">
                    <input
                      required
                      type="time"
                      value={extraForm.startTime}
                      onChange={(event) =>
                        setExtraForm((current) => ({
                          ...current,
                          startTime: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="End">
                    <input
                      required
                      type="time"
                      value={extraForm.endTime}
                      onChange={(event) =>
                        setExtraForm((current) => ({
                          ...current,
                          endTime: event.target.value,
                        }))
                      }
                    />
                  </Field>
                </div>
                <div className="dr57-two-col">
                  <Field label="Venue">
                    <input
                      value={extraForm.venue}
                      onChange={(event) =>
                        setExtraForm((current) => ({
                          ...current,
                          venue: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="Lecturer">
                    <input
                      value={extraForm.lecturer}
                      onChange={(event) =>
                        setExtraForm((current) => ({
                          ...current,
                          lecturer: event.target.value,
                        }))
                      }
                    />
                  </Field>
                </div>
                <Field label="Reason">
                  <textarea
                    required
                    rows={3}
                    value={extraForm.reason}
                    onChange={(event) =>
                      setExtraForm((current) => ({
                        ...current,
                        reason: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="Source note (optional)">
                  <input
                    value={extraForm.provenance}
                    placeholder="e.g. lecturer announced make-up class"
                    onChange={(event) =>
                      setExtraForm((current) => ({
                        ...current,
                        provenance: event.target.value,
                      }))
                    }
                  />
                </Field>

                <div className="dr57-review" aria-label="Extra class review">
                  <strong>Review before save</strong>
                  <span>
                    {extraForm.courseCode || "Course"} · {extraForm.exceptionDate} · {extraForm.startTime}
                    {extraForm.venue ? ` · ${extraForm.venue}` : ""}
                  </span>
                </div>

                <div className="dr57-form-actions">
                  <button
                    className="cancel"
                    type="button"
                    disabled={savingExtra}
                    onClick={() => setActiveDialog(null)}
                  >
                    Cancel
                  </button>
                  <button className="save" disabled={savingExtra} type="submit">
                    {savingExtra ? (
                      <LoaderCircle className="dr57-spin" size={17} />
                    ) : null}
                    {savingExtra
                      ? "Saving…"
                      : editingException
                        ? "Save extra-class edit"
                        : "Add extra class"}
                  </button>
                </div>
              </form>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );'''
text = text[:start] + new_return + text[end:]

find_start = text.index("function findClassRepMount() {")
find_end = text.index("\n}\n\nexport function ClassRepCorrectionSafetyEnhancement()", find_start)
new_find = '''function findClassRepMount() {
  const root = document.querySelector<HTMLElement>(
    "main.admin-page .pilot-stack",
  );
  if (!root) return null;
  const surfaces = [
    ...root.querySelectorAll<HTMLElement>(":scope > .pilot-surface"),
  ];
  const classSurface = surfaces.find(
    (surface) => surface.querySelector("h2")?.textContent?.trim() === "Your Class",
  );
  if (!classSurface) return null;

  for (const surface of surfaces) surface.dataset.dr57Legacy = "true";
  root.closest("main.admin-page")?.classList.add("class-rep-cockpit-page");

  let host = document.getElementById("czw-dr53-correction-workspace");
  if (!host) {
    host = document.createElement("div");
    host.id = "czw-dr53-correction-workspace";
    root.prepend(host);
  }
  return host;
}'''
text = text[:find_start] + new_find + text[find_end + 2:]

portal_old = '''    <ClassRepCorrectionWorkspace
      accessToken={accessToken}
      assignment={assignment}
    />,'''
portal_new = '''    <ClassRepCorrectionWorkspace
      accessToken={accessToken}
      assignment={assignment}
      reloadAfterMutation={false}
    />,'''
if portal_old not in text:
    raise SystemExit("Portal render anchor not found")
text = text.replace(portal_old, portal_new, 1)

path.write_text(text)
print("Applied DR-57 Class Rep cockpit transformation")
