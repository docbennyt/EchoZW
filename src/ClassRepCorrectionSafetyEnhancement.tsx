import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CheckCircle2,
  LoaderCircle,
  RotateCcw,
  ShieldCheck,
  Trash2,
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
    <label className="dr53-field">
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
            editingCorrection.updatedAt,
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
            editingException.updatedAt,
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
      const result =
        entry.kind === "correction"
          ? await revokeRecurringClassUpdate(
              accessToken,
              assignment.timetableId,
              entry.item.id,
            )
          : await revokeSessionException(
              accessToken,
              assignment.timetableId,
              entry.item.id,
            );
      const item =
        entry.kind === "correction" ? result.correction : result.exception;
      const undo: UndoState = {
        kind: entry.kind,
        id: item.id,
        updatedAt: item.updatedAt,
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
      document.getElementById("dr53-recurring-form")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
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
    document.getElementById("dr53-extra-form")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  return (
    <section className="dr53-workspace" aria-labelledby="dr53-workspace-title">
      <div className="dr53-heading">
        <div>
          <span className="dr53-kicker">
            <ShieldCheck size={15} /> Safe correction controls
          </span>
          <h2 id="dr53-workspace-title">Class updates</h2>
          <p>
            One tap creates one logical update. Retries reuse the same save, and
            exact duplicates are blocked before they reach students.
          </p>
        </div>
        <span className="dr53-class-pill">{assignment.classGroupLabel}</span>
      </div>

      {message ? (
        <div className="dr53-message" role="status" aria-live="polite">
          <CheckCircle2 size={18} />
          <span>{message}</span>
        </div>
      ) : null}

      {undoState ? (
        <div className="dr53-undo" role="status">
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

      <div className="dr53-form-grid">
        <form id="dr53-extra-form" className="dr53-card" onSubmit={submitExtra}>
          <div className="dr53-card-title">
            <div>
              <h3>
                {editingException ? "Edit extra class" : "Add extra class"}
              </h3>
              <p>One date only. It will not repeat next week.</p>
            </div>
            {editingException ? (
              <button
                className="dr53-text-button"
                type="button"
                disabled={savingExtra}
                onClick={() => {
                  setEditingException(null);
                  setExtraForm(defaultExtraForm());
                  extraMutationKeyRef.current = newMutationKey();
                }}
              >
                Cancel edit
              </button>
            ) : null}
          </div>
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
          <div className="dr53-two-col">
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
          <div className="dr53-two-col">
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
          <button className="dr53-primary" disabled={savingExtra} type="submit">
            {savingExtra ? (
              <LoaderCircle className="dr53-spin" size={18} />
            ) : null}
            {savingExtra
              ? "Saving…"
              : editingException
                ? "Save extra-class edit"
                : "Add extra class"}
          </button>
        </form>

        <form
          id="dr53-recurring-form"
          className="dr53-card"
          onSubmit={submitRecurring}
        >
          <div className="dr53-card-title">
            <div>
              <h3>
                {editingCorrection
                  ? "Edit recurring update"
                  : "Update timetable"}
              </h3>
              <p>Recurring correction for this assigned class.</p>
            </div>
            {editingCorrection ? (
              <button
                className="dr53-text-button"
                type="button"
                disabled={savingRecurring}
                onClick={() => {
                  setEditingCorrection(null);
                  setRecurringForm(defaultRecurringForm());
                  recurringMutationKeyRef.current = newMutationKey();
                }}
              >
                Cancel edit
              </button>
            ) : null}
          </div>
          <Field label="Existing class">
            <select
              value={recurringForm.stableSessionKey}
              disabled={Boolean(editingCorrection)}
              onChange={(event) => selectExistingSession(event.target.value)}
            >
              <option value="">Add new recurring class</option>
              {timetable?.sessions.map((session) => (
                <option
                  key={session.stableSessionKey}
                  value={session.stableSessionKey}
                >
                  {session.courseCode} · {weekdayLabels[session.weekday]}{" "}
                  {session.startTime.slice(0, 5)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Correction type">
            <select
              value={recurringForm.action}
              onChange={(event) =>
                setRecurringForm((current) => ({
                  ...current,
                  action: event.target.value as RecurringFormState["action"],
                }))
              }
            >
              <option value="modify">Update class</option>
              <option value="add">Add recurring class</option>
              <option value="remove">Remove recurring class</option>
            </select>
          </Field>
          {recurringForm.action !== "remove" ? (
            <>
              <div className="dr53-two-col">
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
              <div className="dr53-two-col">
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
          <fieldset className="dr53-policy">
            <legend>Official information policy</legend>
            <label>
              <input
                type="radio"
                name="dr53-source-policy"
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
                name="dr53-source-policy"
                checked={!recurringForm.sourceMayReplace}
                onChange={() =>
                  setRecurringForm((current) => ({
                    ...current,
                    sourceMayReplace: false,
                  }))
                }
              />
              Keep until manually removed
            </label>
          </fieldset>
          <button
            className="dr53-primary"
            disabled={savingRecurring}
            type="submit"
          >
            {savingRecurring ? (
              <LoaderCircle className="dr53-spin" size={18} />
            ) : null}
            {savingRecurring
              ? "Saving…"
              : editingCorrection
                ? "Save correction edit"
                : "Save correction"}
          </button>
        </form>
      </div>

      <div className="dr53-card dr53-updates">
        <div className="dr53-card-title">
          <div>
            <h3>Active class updates</h3>
            <p>
              Audit-preserving correction layer; official source evidence is
              untouched.
            </p>
          </div>
          <button
            className="dr53-text-button"
            disabled={loading}
            type="button"
            onClick={() => void refresh()}
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
        {loading ? <p className="dr53-muted">Loading active updates…</p> : null}
        {!loading && entries.length === 0 ? (
          <p className="dr53-muted">No active corrections or extra classes.</p>
        ) : null}
        <div className="dr53-update-list">
          {entries.map((entry) => {
            const item = entry.item;
            const policy =
              entry.kind === "correction"
                ? entry.item.sourceMayReplace
                  ? "Use newer official information"
                  : "Keep until removed"
                : "Date-specific update";
            return (
              <article
                className="dr53-update-row"
                key={`${entry.kind}:${item.id}`}
              >
                <div className="dr53-update-copy">
                  <strong>{updateLabel(entry)}</strong>
                  <span>
                    {entry.kind === "correction"
                      ? `${entry.item.action} · ${policy}`
                      : `${entry.item.exceptionType} · ${policy}`}
                  </span>
                  <span>{item.courseName || "Course name not recorded"}</span>
                  <small>{item.reason || "No reason recorded"}</small>
                  <small>
                    {item.creatorRole || "staff"} · revision{" "}
                    {item.revision || 1} ·{" "}
                    {new Date(item.createdAt).toLocaleString("en-ZW")}
                  </small>
                </div>
                <div className="dr53-row-actions">
                  <button type="button" onClick={() => startEdit(entry)}>
                    Edit
                  </button>
                  <button
                    className="dr53-danger"
                    disabled={busyUpdateId === item.id}
                    type="button"
                    onClick={() => void removeUpdate(entry)}
                  >
                    <Trash2 size={15} />
                    {busyUpdateId === item.id ? "Removing…" : "Remove update"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </div>
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
  const byTitle = (title: string) =>
    surfaces.find(
      (surface) => surface.querySelector("h2")?.textContent?.trim() === title,
    );
  const legacy = [
    byTitle("Add Extra Class"),
    byTitle("Update Timetable"),
    byTitle("Recent Updates"),
  ].filter((surface): surface is HTMLElement => Boolean(surface));
  if (legacy.length < 2) return null;
  for (const surface of legacy) surface.dataset.dr53Legacy = "true";

  let host = document.getElementById("czw-dr53-correction-workspace");
  if (!host) {
    host = document.createElement("div");
    host.id = "czw-dr53-correction-workspace";
    root.insertBefore(host, legacy[0]);
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
    />,
    mount,
  );
}
