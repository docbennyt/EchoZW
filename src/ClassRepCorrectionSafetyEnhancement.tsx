import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { track } from "./analytics";
import { Dialog } from "@base-ui/react/dialog";
import {
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  ChevronDown,
  Copy,
  Clock3,
  ExternalLink,
  LoaderCircle,
  MapPin,
  Pencil,
  RefreshCw,
  RotateCcw,
  Share2,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  fetchAdminSession,
  type AdminSessionAssignment,
} from "./api/adminSession";
import {
  CorrectionMutationError,
  createExtraClassUpdate,
  createRecurringClassUpdate,
  dedupeRecurringClassUpdates,
  dedupeSessionExceptions,
  editRecurringClassUpdate,
  editSessionException,
  listClassUpdates,
  restoreRecurringClassUpdate,
  restoreSessionException,
  revokeRecurringClassUpdate,
  revokeSessionException,
  type RecurringCorrectionInput,
  type SessionExceptionInput,
} from "./api/correctionMutations";
import { fetchPublicTimetable } from "./api/publicTimetable";
import type {
  PublicTimetable,
  TimetableCorrectionDirective,
  TimetableSessionException,
} from "./api/pilotTypes";
import {
  formatOccurrenceTime,
  getUpcomingOccurrences,
} from "./domain/publicTimetable";
import { getTomorrowSchedule } from "./domain/tomorrowSchedule";
import { buildClassSharePayload } from "./domain/shareAttribution";
import { createClient as createSupabaseBrowserClient } from "./utils/supabase/client";

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

const CONFIRMATION_KEY = "czw.dr53.confirmation";
const UNDO_KEY = "czw.dr53.undo";
const UNDO_WINDOW_MS = 10 * 60 * 1000;

type UpdateEntry =
  | { kind: "correction"; item: TimetableCorrectionDirective }
  | { kind: "exception"; item: TimetableSessionException };

type UndoState = {
  kind: UpdateEntry["kind"];
  id: string;
  updatedAt: string;
  label: string;
  expiresAt: number;
};

type RecurringFormState = {
  stableSessionKey: string;
  action: "add" | "modify" | "remove";
  sourceMayReplace: boolean;
  courseCode: string;
  courseName: string;
  weekday: number;
  startTime: string;
  endTime: string;
  venue: string;
  lecturer: string;
  reason: string;
  provenance: string;
};

type ExtraFormState = {
  exceptionDate: string;
  courseCode: string;
  courseName: string;
  startTime: string;
  endTime: string;
  venue: string;
  lecturer: string;
  reason: string;
  provenance: string;
};

function localDateInput() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function newMutationKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error(
      "This browser cannot create a secure timetable update key.",
    );
  }
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function defaultRecurringForm(): RecurringFormState {
  return {
    stableSessionKey: "",
    action: "add",
    sourceMayReplace: true,
    courseCode: "",
    courseName: "",
    weekday: 2,
    startTime: "08:00",
    endTime: "10:00",
    venue: "",
    lecturer: "",
    reason: "",
    provenance: "",
  };
}

function defaultExtraForm(): ExtraFormState {
  return {
    exceptionDate: localDateInput(),
    courseCode: "",
    courseName: "",
    startTime: "08:00",
    endTime: "10:00",
    venue: "",
    lecturer: "",
    reason: "",
    provenance: "",
  };
}

function readUndoState(): UndoState | null {
  try {
    const raw = window.sessionStorage.getItem(UNDO_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UndoState;
    if (!parsed.id || !parsed.updatedAt || parsed.expiresAt <= Date.now()) {
      window.sessionStorage.removeItem(UNDO_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function updateLabel(entry: UpdateEntry) {
  if (entry.kind === "correction") {
    const item = entry.item;
    const course =
      item.courseCode || item.stableSessionKey || "Recurring class";
    const when = item.weekday ? weekdayLabels[item.weekday] : "Recurring";
    return `${course} · ${when}${item.startTime ? ` ${item.startTime.slice(0, 5)}` : ""}`;
  }
  return `${entry.item.courseCode || entry.item.stableSessionKey || "Class update"} · ${entry.item.exceptionDate}${entry.item.startTime ? ` ${entry.item.startTime.slice(0, 5)}` : ""}`;
}

function messageTone(message: string) {
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

function outcomeMessage(outcome: string, saved: string) {
  if (outcome === "already_exists") {
    return "This class update is already active — no duplicate was created.";
  }
  if (outcome === "replayed") {
    return `${saved} The retry reused the original save instead of creating a duplicate.`;
  }
  return saved;
}

function mutationErrorMessage(error: unknown) {
  if (error instanceof CorrectionMutationError) {
    if (
      error.code === "STALE_CORRECTION_EDIT" ||
      error.code === "STALE_EXCEPTION_EDIT"
    ) {
      return "A newer change exists. Refresh the class updates and review it before editing again.";
    }
    if (error.code === "UNDO_CONFLICT") {
      return "Undo was blocked because a newer or equivalent update is already active.";
    }
    return error.message;
  }
  return error instanceof Error
    ? error.message
    : "Could not save this class update. Your input is still here — retry when ready.";
}

async function copyClassShareText(value: string) {
  if (!navigator.clipboard?.writeText) {
    throw new Error("Clipboard copy is unavailable.");
  }
  await navigator.clipboard.writeText(value);
}

function correctionFormFromItem(
  item: TimetableCorrectionDirective,
): RecurringFormState {
  return {
    stableSessionKey: item.stableSessionKey ?? "",
    action: item.action,
    sourceMayReplace: item.sourceMayReplace,
    courseCode: item.courseCode ?? "",
    courseName: item.courseName ?? "",
    weekday: item.weekday ?? 2,
    startTime: item.startTime?.slice(0, 5) ?? "08:00",
    endTime: item.endTime?.slice(0, 5) ?? "10:00",
    venue: item.venue ?? "",
    lecturer: item.lecturer ?? "",
    reason: item.reason,
    provenance: item.provenance ?? "",
  };
}

function extraFormFromItem(item: TimetableSessionException): ExtraFormState {
  return {
    exceptionDate: item.exceptionDate,
    courseCode: item.courseCode ?? "",
    courseName: item.courseName ?? "",
    startTime: item.startTime?.slice(0, 5) ?? "08:00",
    endTime: item.endTime?.slice(0, 5) ?? "10:00",
    venue: item.venue ?? "",
    lecturer: item.lecturer ?? "",
    reason: item.reason ?? "",
    provenance: item.provenance ?? "",
  };
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="dr57-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function DuplicateBanner({
  entries,
  busy,
  onResolve,
}: {
  entries: UpdateEntry[];
  busy: boolean;
  onResolve: () => void;
}) {
  return (
    <div className="dr53-duplicate-banner" role="alert">
      <div>
        <strong>{entries.length} exact copies detected</strong>
        <span>{updateLabel(entries[0])}</span>
      </div>
      <button disabled={busy} type="button" onClick={onResolve}>
        {busy ? "Cleaning…" : "Keep one, remove duplicates"}
      </button>
    </div>
  );
}

export function ClassRepCorrectionWorkspace({
  accessToken,
  assignment,
  reloadAfterMutation = true,
}: {
  accessToken: string;
  assignment: AdminSessionAssignment;
  reloadAfterMutation?: boolean;
}) {
  const [timetable, setTimetable] = useState<PublicTimetable | null>(null);
  const [entries, setEntries] = useState<UpdateEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(() => {
    const stored = window.sessionStorage.getItem(CONFIRMATION_KEY) ?? "";
    window.sessionStorage.removeItem(CONFIRMATION_KEY);
    return stored;
  });
  const [undoState, setUndoState] = useState<UndoState | null>(readUndoState);
  const [recurringForm, setRecurringForm] = useState(defaultRecurringForm);
  const [extraForm, setExtraForm] = useState(defaultExtraForm);
  const [editingCorrection, setEditingCorrection] =
    useState<TimetableCorrectionDirective | null>(null);
  const [editingException, setEditingException] =
    useState<TimetableSessionException | null>(null);
  const [savingRecurring, setSavingRecurring] = useState(false);
  const [savingExtra, setSavingExtra] = useState(false);
  const [busyUpdateId, setBusyUpdateId] = useState("");
  const [busyFingerprint, setBusyFingerprint] = useState("");
  const recurringPendingRef = useRef(false);
  const extraPendingRef = useRef(false);
  const recurringMutationKeyRef = useRef(newMutationKey());
  const extraMutationKeyRef = useRef(newMutationKey());
  const [activeDialog, setActiveDialog] = useState<
    "recurring" | "extra" | null
  >(null);
  const [selectedDay, setSelectedDay] = useState(() => {
    const weekday = new Date().getDay();
    return weekday === 0 ? 7 : weekday;
  });
  const [showAllTomorrow, setShowAllTomorrow] = useState(false);
  const [showAllUpdates, setShowAllUpdates] = useState(false);

  const refresh = useCallback(async () => {
    const [updates, publicTimetable] = await Promise.all([
      listClassUpdates(accessToken, assignment.timetableId),
      assignment.publicSlug
        ? fetchPublicTimetable(assignment.publicSlug)
        : Promise.resolve(null),
    ]);
    setEntries([
      ...(updates.corrections.corrections ?? []).map((item) => ({
        kind: "correction" as const,
        item,
      })),
      ...(updates.corrections.exceptions ?? []).map((item) => ({
        kind: "exception" as const,
        item,
      })),
    ]);
    setTimetable(publicTimetable);
  }, [accessToken, assignment.publicSlug, assignment.timetableId]);

  useEffect(() => {
    let active = true;
    const timeoutId = window.setTimeout(() => {
      void refresh()
        .catch((error) => {
          if (active) setMessage(mutationErrorMessage(error));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [refresh]);

  const duplicateGroups = useMemo(() => {
    const groups = new Map<string, UpdateEntry[]>();
    for (const entry of entries) {
      const fingerprint = entry.item.semanticFingerprint;
      if (!fingerprint) continue;
      const key = `${entry.kind}:${fingerprint}`;
      groups.set(key, [...(groups.get(key) ?? []), entry]);
    }
    return [...groups.entries()].filter(([, group]) => group.length > 1);
  }, [entries]);

  function persistConfirmation(text: string) {
    setMessage(text);
    window.sessionStorage.setItem(CONFIRMATION_KEY, text);
  }

  async function completeMutation(text: string) {
    persistConfirmation(text);
    if (reloadAfterMutation) {
      window.setTimeout(() => window.location.reload(), 350);
      return;
    }
    await refresh();
  }

  function selectExistingSession(stableSessionKey: string) {
    const selected = timetable?.sessions.find(
      (session) => session.stableSessionKey === stableSessionKey,
    );
    setEditingCorrection(null);
    recurringMutationKeyRef.current = newMutationKey();
    setRecurringForm((current) => ({
      ...current,
      stableSessionKey,
      action: stableSessionKey ? "modify" : "add",
      courseCode:
        selected?.courseCode ?? (stableSessionKey ? "" : current.courseCode),
      courseName:
        selected?.courseName ?? (stableSessionKey ? "" : current.courseName),
      weekday: selected?.weekday ?? current.weekday,
      startTime: selected?.startTime.slice(0, 5) ?? current.startTime,
      endTime: selected?.endTime.slice(0, 5) ?? current.endTime,
      venue: selected?.venue ?? "",
      lecturer: selected?.lecturer ?? "",
    }));
  }

  async function submitRecurring(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (recurringPendingRef.current) return;
    recurringPendingRef.current = true;
    setSavingRecurring(true);
    setMessage("");
    const input: RecurringCorrectionInput = {
      ...recurringForm,
      stableSessionKey: recurringForm.stableSessionKey || null,
      sessionType: "Lecture",
    };
    try {
      const result = editingCorrection
        ? await editRecurringClassUpdate(
            accessToken,
            assignment.timetableId,
            editingCorrection.id,
            recurringMutationKeyRef.current,
            editingCorrection.updatedAt ?? editingCorrection.createdAt,
            input,
          )
        : await createRecurringClassUpdate(
            accessToken,
            assignment.timetableId,
            recurringMutationKeyRef.current,
            input,
          );
      const savedLabel = `${recurringForm.courseCode || "Recurring class"} · ${weekdayLabels[recurringForm.weekday]} ${recurringForm.startTime}`;
      const text = outcomeMessage(
        result.mutationOutcome,
        `Saved — timetable updated: ${savedLabel}.`,
      );
      recurringMutationKeyRef.current = newMutationKey();
      setEditingCorrection(null);
      setRecurringForm(defaultRecurringForm());
      setActiveDialog(null);
      await completeMutation(text);
    } catch (error) {
      setMessage(mutationErrorMessage(error));
      // Form values and the mutation key are deliberately retained for retry.
    } finally {
      recurringPendingRef.current = false;
      setSavingRecurring(false);
    }
  }

  async function submitExtra(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (extraPendingRef.current) return;
    extraPendingRef.current = true;
    setSavingExtra(true);
    setMessage("");
    const input: SessionExceptionInput = {
      ...extraForm,
      exceptionType: "extra",
      sessionType: "Lecture",
    };
    try {
      const result = editingException
        ? await editSessionException(
            accessToken,
            assignment.timetableId,
            editingException.id,
            extraMutationKeyRef.current,
            editingException.updatedAt ?? editingException.createdAt,
            input,
          )
        : await createExtraClassUpdate(
            accessToken,
            assignment.timetableId,
            extraMutationKeyRef.current,
            input,
          );
      const savedLabel = `${extraForm.courseCode || "Extra class"} · ${extraForm.exceptionDate} ${extraForm.startTime}`;
      const text = outcomeMessage(
        result.mutationOutcome,
        `Saved — timetable updated: ${savedLabel}.`,
      );
      extraMutationKeyRef.current = newMutationKey();
      setEditingException(null);
      setExtraForm(defaultExtraForm());
      setActiveDialog(null);
      await completeMutation(text);
    } catch (error) {
      setMessage(mutationErrorMessage(error));
    } finally {
      extraPendingRef.current = false;
      setSavingExtra(false);
    }
  }

  async function removeUpdate(entry: UpdateEntry) {
    setBusyUpdateId(entry.item.id);
    setMessage("");
    try {
      let item: TimetableCorrectionDirective | TimetableSessionException;
      if (entry.kind === "correction") {
        const result = await revokeRecurringClassUpdate(
          accessToken,
          assignment.timetableId,
          entry.item.id,
        );
        item = result.correction;
      } else {
        const result = await revokeSessionException(
          accessToken,
          assignment.timetableId,
          entry.item.id,
        );
        item = result.exception;
      }
      const undo: UndoState = {
        kind: entry.kind,
        id: item.id,
        updatedAt: item.updatedAt ?? item.createdAt,
        label: updateLabel(entry),
        expiresAt: Date.now() + UNDO_WINDOW_MS,
      };
      setUndoState(undo);
      window.sessionStorage.setItem(UNDO_KEY, JSON.stringify(undo));
      await completeMutation(
        `Removed update — ${undo.label}. Undo is available for 10 minutes.`,
      );
    } catch (error) {
      setMessage(mutationErrorMessage(error));
    } finally {
      setBusyUpdateId("");
    }
  }

  async function undoRemoval() {
    if (!undoState || undoState.expiresAt <= Date.now()) {
      window.sessionStorage.removeItem(UNDO_KEY);
      setUndoState(null);
      setMessage("The quick undo window has expired.");
      return;
    }
    setBusyUpdateId(undoState.id);
    try {
      if (undoState.kind === "correction") {
        await restoreRecurringClassUpdate(
          accessToken,
          assignment.timetableId,
          undoState.id,
          undoState.updatedAt,
        );
      } else {
        await restoreSessionException(
          accessToken,
          assignment.timetableId,
          undoState.id,
          undoState.updatedAt,
        );
      }
      window.sessionStorage.removeItem(UNDO_KEY);
      setUndoState(null);
      await completeMutation(`Restored — ${undoState.label}.`);
    } catch (error) {
      setMessage(mutationErrorMessage(error));
    } finally {
      setBusyUpdateId("");
    }
  }

  async function resolveDuplicates(key: string, group: UpdateEntry[]) {
    const fingerprint = group[0]?.item.semanticFingerprint;
    if (!fingerprint) return;
    setBusyFingerprint(key);
    setMessage("");
    try {
      const result =
        group[0].kind === "correction"
          ? await dedupeRecurringClassUpdates(
              accessToken,
              assignment.timetableId,
              fingerprint,
            )
          : await dedupeSessionExceptions(
              accessToken,
              assignment.timetableId,
              fingerprint,
            );
      await completeMutation(
        result.dedupeResult.revokedCount > 0
          ? `Duplicate cleanup complete — kept one ${updateLabel(group[0])} and safely removed ${result.dedupeResult.revokedCount} duplicate update${result.dedupeResult.revokedCount === 1 ? "" : "s"}.`
          : "No active duplicates remained to clean up.",
      );
    } catch (error) {
      setMessage(mutationErrorMessage(error));
    } finally {
      setBusyFingerprint("");
    }
  }

  function startEdit(entry: UpdateEntry) {
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
  const classDistributionBlocked =
    !assignment.publicSlug || !timetable || duplicateGroups.length > 0;

  function classDistributionPayload() {
    if (!assignment.publicSlug) return null;
    return buildClassSharePayload({
      classLabel: assignment.classGroupLabel,
      publicUrl: `${window.location.origin}/t/${encodeURIComponent(assignment.publicSlug)}`,
      source: "class_rep",
    });
  }

  async function distributeClass(
    action: "share" | "copy-message" | "copy-link",
  ) {
    if (classDistributionBlocked) {
      setMessage(
        duplicateGroups.length > 0
          ? "Resolve the duplicate class-truth warning before broad sharing."
          : "Publish and load the class timetable before sharing it.",
      );
      return;
    }
    const payload = classDistributionPayload();
    if (!payload) return;
    setMessage("");
    try {
      if (action === "share" && navigator.share) {
        await navigator.share({
          title: payload.title,
          text: payload.text,
          url: payload.url,
        });
        track("timetable_shared", {
          method: "web-share",
          source: "class_rep",
          publicSlug: assignment.publicSlug,
        });
        setMessage("Class share sheet opened with the public timetable link.");
        return;
      }
      const value = action === "copy-link" ? payload.url : payload.message;
      await copyClassShareText(value);
      track("timetable_shared", {
        method: action === "copy-link" ? "copy-link" : "copy-message",
        source: "class_rep",
        publicSlug: assignment.publicSlug,
      });
      setMessage(
        action === "copy-link"
          ? "Public class link copied."
          : "Class-ready message copied — paste it into the class group.",
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage(
        "Could not share just now. The public timetable is unchanged.",
      );
    }
  }

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
          <>
            <button
              className="dr57-action secondary dr47-share-action"
              type="button"
              disabled={classDistributionBlocked}
              onClick={() => void distributeClass("share")}
            >
              <Share2 size={17} /> Share with class
            </button>
            <a
              className="dr57-action ghost"
              href={`/t/${assignment.publicSlug}`}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={17} /> View public
            </a>
          </>
        ) : null}
      </div>

      {assignment.publicSlug ? (
        <div
          className="dr47-distribution-kit"
          data-blocked={classDistributionBlocked ? "true" : "false"}
        >
          <div>
            <strong>Class distribution</strong>
            <span>
              {classDistributionBlocked
                ? "Resolve class-truth warnings before broad sharing."
                : "Public link only — never a student's private calendar feed."}
            </span>
          </div>
          <div className="dr47-distribution-actions">
            <button
              type="button"
              disabled={classDistributionBlocked}
              onClick={() => void distributeClass("copy-message")}
            >
              <Copy size={15} /> Copy class message
            </button>
            <button
              type="button"
              disabled={classDistributionBlocked}
              onClick={() => void distributeClass("copy-link")}
            >
              <ExternalLink size={15} /> Copy public link
            </button>
          </div>
        </div>
      ) : null}

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
              <div
                className="dr57-day-tabs"
                role="tablist"
                aria-label="Weekdays"
              >
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
                        {item.creatorRole || "staff"} · revision{" "}
                        {item.revision || 1}
                      </small>
                      <div className="dr57-update-actions">
                        {canEdit ? (
                          <button
                            type="button"
                            onClick={() => startEdit(entry)}
                          >
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
                    {editingCorrection
                      ? "Edit timetable update"
                      : "Update timetable"}
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
                      disabled={
                        Boolean(editingCorrection) ||
                        !timetable?.sessions.length
                      }
                      onChange={() =>
                        selectExistingSession(
                          timetable?.sessions[0]?.stableSessionKey ?? "",
                        )
                      }
                    />
                    <div>
                      <strong>Existing class</strong>
                      <span>
                        Change or remove something already on the week.
                      </span>
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
                      onChange={(event) =>
                        selectExistingSession(event.target.value)
                      }
                    >
                      {timetable?.sessions.map((session) => (
                        <option
                          key={session.stableSessionKey}
                          value={session.stableSessionKey}
                        >
                          {session.courseCode} ·{" "}
                          {weekdayLabels[session.weekday]}{" "}
                          {session.startTime.slice(0, 5)}
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
                        <span>
                          Time, venue, lecturer or class details changed.
                        </span>
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
                        <span>
                          Stop showing this weekly class in the resolved
                          schedule.
                        </span>
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
                    {extraForm.courseCode || "Course"} ·{" "}
                    {extraForm.exceptionDate} · {extraForm.startTime}
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
  );
}

function findClassRepMount() {
  const root = document.querySelector<HTMLElement>(
    "main.admin-page .pilot-stack",
  );
  if (!root) return null;
  const surfaces = [
    ...root.querySelectorAll<HTMLElement>(":scope > .pilot-surface"),
  ];
  const classSurface = surfaces.find(
    (surface) =>
      surface.querySelector("h2")?.textContent?.trim() === "Your Class",
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
}

export function ClassRepCorrectionSafetyEnhancement() {
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [accessToken, setAccessToken] = useState("");
  const [assignment, setAssignment] = useState<AdminSessionAssignment | null>(
    null,
  );

  useEffect(() => {
    if (!window.location.pathname.startsWith("/admin")) return;
    let active = true;
    let observer: MutationObserver | null = null;

    async function resolveSession() {
      let supabase;
      try {
        supabase = createSupabaseBrowserClient();
      } catch {
        return;
      }
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      try {
        const session = await fetchAdminSession(token);
        if (!active || session.staff.role !== "class_rep") return;
        const assigned = session.assignments[0];
        if (!assigned) return;
        setAccessToken(token);
        setAssignment(assigned);
        const target = findClassRepMount();
        if (target) {
          setMount(target);
          return;
        }
        observer = new MutationObserver(() => {
          const nextTarget = findClassRepMount();
          if (!nextTarget) return;
          setMount(nextTarget);
          observer?.disconnect();
        });
        observer.observe(document.body, { childList: true, subtree: true });
      } catch {
        // Existing admin access UI owns auth and recovery messaging.
      }
    }

    void resolveSession();
    return () => {
      active = false;
      observer?.disconnect();
    };
  }, []);

  if (!mount || !accessToken || !assignment) return null;
  return createPortal(
    <ClassRepCorrectionWorkspace
      accessToken={accessToken}
      assignment={assignment}
      reloadAfterMutation={false}
    />,
    mount,
  );
}
