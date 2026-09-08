import { useMemo, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { CalendarOff, CheckCircle2, Play, X } from "lucide-react";
import {
  createTimetablePause,
  deactivateTimetablePause,
  previewTimetablePause,
  type TimetablePauseInput,
} from "./api/academicPauses";
import type { AdminSessionAssignment } from "./api/adminSession";
import type {
  AcademicPauseImpact,
  AcademicPauseReason,
  PublicTimetable,
} from "./api/pilotTypes";
import "./classRepAcademicPauseControl.css";

const reasonOptions: Array<{ value: AcademicPauseReason; label: string }> = [
  { value: "sim_break", label: "Sim Break" },
  { value: "graduation", label: "Graduation" },
  { value: "swot_week", label: "SWOT week" },
  { value: "holiday", label: "Holiday" },
  { value: "closure", label: "Campus/class closure" },
  { value: "other", label: "Other" },
];

function todayKey() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

type PauseForm = {
  scopeType: "timetable" | "session";
  stableSessionKey: string;
  startsOn: string;
  endsOn: string;
  reason: AcademicPauseReason;
  label: string;
  provenance: string;
};

function initialForm(): PauseForm {
  const today = todayKey();
  return {
    scopeType: "timetable",
    stableSessionKey: "",
    startsOn: today,
    endsOn: today,
    reason: "other",
    label: "",
    provenance: "",
  };
}

function toInput(form: PauseForm): TimetablePauseInput {
  return {
    scopeType: form.scopeType,
    stableSessionKey:
      form.scopeType === "session" ? form.stableSessionKey || null : null,
    startsOn: form.startsOn,
    endsOn: form.endsOn,
    allDay: true,
    reason: form.reason,
    label: form.label,
    provenance: form.provenance || null,
  };
}

function pauseDates(startsOn: string, endsOn: string) {
  return startsOn === endsOn ? startsOn : `${startsOn} → ${endsOn}`;
}

export function ActiveAcademicPauseNotice({
  accessToken,
  assignment,
  timetable,
  onRefresh,
  onMessage,
}: {
  accessToken: string;
  assignment: AdminSessionAssignment;
  timetable: PublicTimetable | null;
  onRefresh: () => Promise<void>;
  onMessage: (message: string) => void;
}) {
  const [busyId, setBusyId] = useState("");
  const pauses = useMemo(
    () => (timetable?.pauses ?? []).filter((pause) => pause.active),
    [timetable?.pauses],
  );
  if (!pauses.length) return null;

  return (
    <section className="dr58-active-pauses" aria-label="Active no-lecture periods">
      <div className="dr58-active-pauses-heading">
        <div>
          <span>Academic calendar</span>
          <strong>
            {pauses.length} active no-lecture {pauses.length === 1 ? "rule" : "rules"}
          </strong>
        </div>
        <CalendarOff size={20} aria-hidden="true" />
      </div>
      <div className="dr58-active-pause-list">
        {pauses.map((pause) => {
          const classRepCanResume =
            pause.scopeType === "timetable" || pause.scopeType === "session";
          return (
            <article key={pause.id}>
              <div>
                <strong>{pause.label}</strong>
                <span>
                  {pause.scopeType.replaceAll("_", " ")} · {pauseDates(pause.startsOn, pause.endsOn)}
                </span>
              </div>
              {classRepCanResume ? (
                <button
                  type="button"
                  disabled={busyId === pause.id}
                  onClick={() => {
                    setBusyId(pause.id);
                    void deactivateTimetablePause(
                      accessToken,
                      assignment.timetableId,
                      pause.id,
                    )
                      .then(async () => {
                        onMessage(`Classes resumed — ${pause.label}. Calendar subscribers will receive the restored schedule.`);
                        await onRefresh();
                      })
                      .catch((error) =>
                        onMessage(
                          error instanceof Error
                            ? error.message
                            : "Could not resume classes for this pause.",
                        ),
                      )
                      .finally(() => setBusyId(""));
                  }}
                >
                  <Play size={14} aria-hidden="true" />
                  {busyId === pause.id ? "Resuming…" : "Resume"}
                </button>
              ) : (
                <small>Managed by Admin</small>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function ClassRepAcademicPauseAction({
  accessToken,
  assignment,
  timetable,
  onRefresh,
  onMessage,
}: {
  accessToken: string;
  assignment: AdminSessionAssignment;
  timetable: PublicTimetable | null;
  onRefresh: () => Promise<void>;
  onMessage: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<PauseForm>(initialForm);
  const [preview, setPreview] = useState<AcademicPauseImpact | null>(null);
  const [busy, setBusy] = useState<"preview" | "save" | "">("");
  const [error, setError] = useState("");

  const resetPreview = (next: PauseForm) => {
    setForm(next);
    setPreview(null);
    setError("");
  };

  const previewPause = async () => {
    setBusy("preview");
    setError("");
    try {
      const result = await previewTimetablePause(
        accessToken,
        assignment.timetableId,
        toInput(form),
      );
      setPreview(result.impact);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not preview this pause.",
      );
    } finally {
      setBusy("");
    }
  };

  const savePause = async () => {
    setBusy("save");
    setError("");
    try {
      const result = await createTimetablePause(
        accessToken,
        assignment.timetableId,
        toInput(form),
      );
      onMessage(
        `Paused — ${result.pause.label}. ${result.impact.newlySuppressedLectureCount} lecture${result.impact.newlySuppressedLectureCount === 1 ? "" : "s"} suppressed without deleting the weekly timetable.`,
      );
      setOpen(false);
      setForm(initialForm());
      setPreview(null);
      await onRefresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not save this pause.",
      );
    } finally {
      setBusy("");
    }
  };

  const scopeSession = form.scopeType === "session";

  return (
    <>
      <button
        className="dr57-action secondary"
        type="button"
        onClick={() => setOpen(true)}
      >
        <CalendarOff size={18} aria-hidden="true" /> Pause classes
      </button>

      <Dialog.Root
        open={open}
        onOpenChange={(nextOpen) => {
          if (!busy) setOpen(nextOpen);
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="dr57-dialog-backdrop" />
          <Dialog.Viewport className="dr57-dialog-viewport">
            <Dialog.Popup className="dr57-dialog dr58-dialog">
              <div className="dr57-dialog-header">
                <div>
                  <Dialog.Title>Pause classes</Dialog.Title>
                  <Dialog.Description>
                    Temporarily suppress lectures without deleting the recurring timetable. Existing calendar subscriptions update from the same schedule truth.
                  </Dialog.Description>
                </div>
                <Dialog.Close
                  className="dr57-dialog-close"
                  aria-label="Close pause classes"
                  disabled={Boolean(busy)}
                >
                  <X size={18} />
                </Dialog.Close>
              </div>

              <div className="dr57-form">
                <fieldset className="dr57-choice-grid">
                  <legend>Pause scope</legend>
                  <label className="dr57-choice">
                    <input
                      type="radio"
                      checked={!scopeSession}
                      name="dr58-scope"
                      onChange={() =>
                        resetPreview({
                          ...form,
                          scopeType: "timetable",
                          stableSessionKey: "",
                        })
                      }
                    />
                    <div>
                      <strong>Whole class timetable</strong>
                      <span>Use for class-wide breaks or closures.</span>
                    </div>
                  </label>
                  <label className="dr57-choice">
                    <input
                      type="radio"
                      checked={scopeSession}
                      name="dr58-scope"
                      disabled={!timetable?.sessions.length}
                      onChange={() =>
                        resetPreview({
                          ...form,
                          scopeType: "session",
                          stableSessionKey:
                            timetable?.sessions[0]?.stableSessionKey ?? "",
                        })
                      }
                    />
                    <div>
                      <strong>One recurring class</strong>
                      <span>Pause one course while the rest continue.</span>
                    </div>
                  </label>
                </fieldset>

                {scopeSession ? (
                  <label className="dr57-field">
                    <span>Recurring class</span>
                    <select
                      required
                      value={form.stableSessionKey}
                      onChange={(event) =>
                        resetPreview({ ...form, stableSessionKey: event.target.value })
                      }
                    >
                      {timetable?.sessions.map((session) => (
                        <option key={session.stableSessionKey} value={session.stableSessionKey}>
                          {session.courseCode} · {session.startTime.slice(0, 5)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                <div className="dr57-two-col">
                  <label className="dr57-field">
                    <span>From</span>
                    <input
                      type="date"
                      required
                      value={form.startsOn}
                      onChange={(event) =>
                        resetPreview({ ...form, startsOn: event.target.value })
                      }
                    />
                  </label>
                  <label className="dr57-field">
                    <span>Until</span>
                    <input
                      type="date"
                      required
                      min={form.startsOn}
                      value={form.endsOn}
                      onChange={(event) =>
                        resetPreview({ ...form, endsOn: event.target.value })
                      }
                    />
                  </label>
                </div>

                <label className="dr57-field">
                  <span>Reason type</span>
                  <select
                    value={form.reason}
                    onChange={(event) =>
                      resetPreview({
                        ...form,
                        reason: event.target.value as AcademicPauseReason,
                      })
                    }
                  >
                    {reasonOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="dr57-field">
                  <span>What should students see?</span>
                  <input
                    required
                    value={form.label}
                    placeholder="e.g. Sim Break"
                    onChange={(event) =>
                      resetPreview({ ...form, label: event.target.value })
                    }
                  />
                </label>

                <label className="dr57-field">
                  <span>Source note (optional)</span>
                  <input
                    value={form.provenance}
                    placeholder="e.g. department notice / lecturer confirmation"
                    onChange={(event) =>
                      resetPreview({ ...form, provenance: event.target.value })
                    }
                  />
                </label>

                {error ? <div className="dr58-error" role="alert">{error}</div> : null}

                {preview ? (
                  <div className="dr58-impact" role="status">
                    <CheckCircle2 size={18} aria-hidden="true" />
                    <div>
                      <strong>
                        {preview.newlySuppressedLectureCount} lecture{preview.newlySuppressedLectureCount === 1 ? "" : "s"} will be suppressed
                      </strong>
                      <span>
                        No recurring class is deleted. The schedule restores automatically after {form.endsOn} or when you resume early.
                      </span>
                    </div>
                  </div>
                ) : null}

                <div className="dr57-form-actions">
                  <button
                    type="button"
                    className="secondary"
                    disabled={Boolean(busy) || !form.label || (scopeSession && !form.stableSessionKey)}
                    onClick={() => void previewPause()}
                  >
                    {busy === "preview" ? "Checking…" : preview ? "Refresh preview" : "Preview impact"}
                  </button>
                  <button
                    type="button"
                    disabled={!preview || Boolean(busy)}
                    onClick={() => void savePause()}
                  >
                    <CalendarOff size={16} aria-hidden="true" />
                    {busy === "save" ? "Pausing…" : "Confirm pause"}
                  </button>
                </div>
              </div>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
