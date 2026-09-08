import { useEffect, useMemo, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { CalendarOff, CheckCircle2, Play, X } from "lucide-react";
import {
  createBroadPause,
  deactivateBroadPause,
  listAcademicPauses,
  previewBroadPause,
  type BroadPauseInput,
} from "./api/academicPauses";
import type {
  AcademicPauseImpact,
  AcademicPauseReason,
  AcademicPauseScope,
  AdminAcademicSchedulePause,
  AdminClassGroup,
  AdminInstitution,
  AdminProgramme,
  AdminTimetableSummary,
} from "./api/pilotTypes";
import "./classRepAcademicPauseControl.css";

const reasons: Array<{ value: AcademicPauseReason; label: string }> = [
  { value: "sim_break", label: "Sim Break" },
  { value: "graduation", label: "Graduation" },
  { value: "swot_week", label: "SWOT week" },
  { value: "holiday", label: "Holiday" },
  { value: "closure", label: "Campus closure" },
  { value: "other", label: "Other" },
];

type BroadScope = Exclude<AcademicPauseScope, "session">;

type Props = {
  accessToken: string;
  institutions: AdminInstitution[];
  programmes: AdminProgramme[];
  classGroups: AdminClassGroup[];
  timetables: AdminTimetableSummary[];
};

function todayKey() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function AdminAcademicPauseControl({
  accessToken,
  institutions,
  programmes,
  classGroups,
  timetables,
}: Props) {
  const [open, setOpen] = useState(false);
  const [scopeType, setScopeType] = useState<BroadScope>("institution");
  const [targetId, setTargetId] = useState(institutions[0]?.id ?? "");
  const [startsOn, setStartsOn] = useState(todayKey);
  const [endsOn, setEndsOn] = useState(todayKey);
  const [reason, setReason] = useState<AcademicPauseReason>("other");
  const [label, setLabel] = useState("");
  const [provenance, setProvenance] = useState("");
  const [preview, setPreview] = useState<AcademicPauseImpact | null>(null);
  const [pauses, setPauses] = useState<AdminAcademicSchedulePause[]>([]);
  const [busy, setBusy] = useState<"preview" | "save" | string>("");
  const [message, setMessage] = useState("");

  const targets = useMemo(() => {
    if (scopeType === "institution") {
      return institutions.map((item) => ({
        id: item.id,
        label: item.shortName || item.name,
      }));
    }
    if (scopeType === "programme") {
      return programmes.map((item) => ({
        id: item.id,
        label: `${item.name} · ${item.institutionName}`,
      }));
    }
    if (scopeType === "cohort") {
      return classGroups.map((item) => ({
        id: item.id,
        label: `${item.label} · ${item.programmeName}`,
      }));
    }
    return timetables.map((item) => ({
      id: item.id,
      label: `${item.classGroupLabel} · ${item.academicPeriodName}`,
    }));
  }, [classGroups, institutions, programmes, scopeType, timetables]);

  async function refresh() {
    const result = await listAcademicPauses(accessToken);
    setPauses(result.pauses ?? []);
  }

  useEffect(() => {
    const timeout = window.setTimeout(
      () => void refresh().catch(() => undefined),
      0,
    );
    return () => window.clearTimeout(timeout);
  }, [accessToken]);

  function chooseScope(next: BroadScope) {
    setScopeType(next);
    setPreview(null);
    const first =
      next === "institution"
        ? institutions[0]?.id
        : next === "programme"
          ? programmes[0]?.id
          : next === "cohort"
            ? classGroups[0]?.id
            : timetables[0]?.id;
    setTargetId(first ?? "");
  }

  function input(): BroadPauseInput {
    return {
      scopeType,
      institutionId: scopeType === "institution" ? targetId : null,
      programmeId: scopeType === "programme" ? targetId : null,
      cohortId: scopeType === "cohort" ? targetId : null,
      timetableId: scopeType === "timetable" ? targetId : null,
      stableSessionKey: null,
      startsOn,
      endsOn,
      allDay: true,
      reason,
      label,
      provenance: provenance || null,
    };
  }

  const active = pauses.filter((pause) => pause.active);

  return (
    <section className="dr58-admin-panel" aria-labelledby="dr58-admin-title">
      <div className="dr58-admin-heading">
        <div>
          <span className="foc-eyebrow">Academic calendar</span>
          <h2 id="dr58-admin-title">No-lecture periods</h2>
          <p>
            Pause lectures without deleting timetable truth. Calendar
            subscriptions resolve from the same rule.
          </p>
        </div>
        <button
          className="foc-primary-action"
          type="button"
          onClick={() => setOpen(true)}
        >
          <CalendarOff size={17} /> Add pause
        </button>
      </div>

      {message ? (
        <div className="dr58-impact" role="status">
          {message}
        </div>
      ) : null}

      {active.length ? (
        <div className="dr58-admin-list">
          {active.slice(0, 8).map((pause) => (
            <article key={pause.id}>
              <div>
                <strong>{pause.label}</strong>
                <span>
                  {pause.scopeType.replaceAll("_", " ")} · {pause.startsOn} →{" "}
                  {pause.endsOn}
                </span>
              </div>
              <button
                type="button"
                disabled={busy === pause.id}
                onClick={() => {
                  setBusy(pause.id);
                  void deactivateBroadPause(accessToken, pause.id)
                    .then(async () => {
                      setMessage(`Classes resumed — ${pause.label}.`);
                      await refresh();
                    })
                    .catch((error) =>
                      setMessage(
                        error instanceof Error
                          ? error.message
                          : "Could not resume classes.",
                      ),
                    )
                    .finally(() => setBusy(""));
                }}
              >
                <Play size={14} />
                {busy === pause.id ? "Resuming…" : "Resume"}
              </button>
            </article>
          ))}
        </div>
      ) : (
        <p className="dr58-admin-empty">No active academic pauses.</p>
      )}

      <Dialog.Root open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <Dialog.Portal>
          <Dialog.Backdrop className="dr57-dialog-backdrop" />
          <Dialog.Viewport className="dr57-dialog-viewport">
            <Dialog.Popup className="dr57-dialog dr58-dialog">
              <div className="dr57-dialog-header">
                <div>
                  <Dialog.Title>Add no-lecture period</Dialog.Title>
                  <Dialog.Description>
                    Preview the exact impact before suppressing lectures.
                  </Dialog.Description>
                </div>
                <Dialog.Close
                  className="dr57-dialog-close"
                  aria-label="Close academic pause"
                  disabled={Boolean(busy)}
                >
                  <X size={18} />
                </Dialog.Close>
              </div>

              <div className="dr57-form">
                <label className="dr57-field">
                  <span>Scope</span>
                  <select
                    value={scopeType}
                    onChange={(event) =>
                      chooseScope(event.target.value as BroadScope)
                    }
                  >
                    <option value="institution">Institution</option>
                    <option value="programme">Programme</option>
                    <option value="cohort">Class group</option>
                    <option value="timetable">Timetable</option>
                  </select>
                </label>

                <label className="dr57-field">
                  <span>Target</span>
                  <select
                    required
                    value={targetId}
                    onChange={(event) => {
                      setTargetId(event.target.value);
                      setPreview(null);
                    }}
                  >
                    {targets.map((target) => (
                      <option key={target.id} value={target.id}>
                        {target.label}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="dr57-two-col">
                  <label className="dr57-field">
                    <span>From</span>
                    <input
                      required
                      type="date"
                      value={startsOn}
                      onChange={(event) => {
                        setStartsOn(event.target.value);
                        setPreview(null);
                      }}
                    />
                  </label>
                  <label className="dr57-field">
                    <span>Until</span>
                    <input
                      required
                      type="date"
                      min={startsOn}
                      value={endsOn}
                      onChange={(event) => {
                        setEndsOn(event.target.value);
                        setPreview(null);
                      }}
                    />
                  </label>
                </div>

                <label className="dr57-field">
                  <span>Reason</span>
                  <select
                    value={reason}
                    onChange={(event) => {
                      setReason(event.target.value as AcademicPauseReason);
                      setPreview(null);
                    }}
                  >
                    {reasons.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="dr57-field">
                  <span>Student-facing label</span>
                  <input
                    required
                    value={label}
                    placeholder="e.g. Sim Break"
                    onChange={(event) => {
                      setLabel(event.target.value);
                      setPreview(null);
                    }}
                  />
                </label>

                <label className="dr57-field">
                  <span>Source note</span>
                  <input
                    value={provenance}
                    placeholder="e.g. Registrar notice"
                    onChange={(event) => {
                      setProvenance(event.target.value);
                      setPreview(null);
                    }}
                  />
                </label>

                {preview ? (
                  <div className="dr58-impact" role="status">
                    <CheckCircle2 size={18} />
                    <div>
                      <strong>
                        {preview.newlySuppressedLectureCount} lectures across{" "}
                        {preview.affectedTimetableCount} timetable
                        {preview.affectedTimetableCount === 1 ? "" : "s"}
                      </strong>
                      <span>
                        Recurring timetable records stay intact and restore
                        automatically after {endsOn}.
                      </span>
                    </div>
                  </div>
                ) : null}

                <div className="dr57-form-actions">
                  <button
                    type="button"
                    className="secondary"
                    disabled={!targetId || !label || Boolean(busy)}
                    onClick={() => {
                      setBusy("preview");
                      setMessage("");
                      void previewBroadPause(accessToken, input())
                        .then((result) => setPreview(result.impact))
                        .catch((error) =>
                          setMessage(
                            error instanceof Error
                              ? error.message
                              : "Could not preview pause.",
                          ),
                        )
                        .finally(() => setBusy(""));
                    }}
                  >
                    {busy === "preview" ? "Checking…" : "Preview impact"}
                  </button>
                  <button
                    type="button"
                    disabled={!preview || Boolean(busy)}
                    onClick={() => {
                      setBusy("save");
                      void createBroadPause(accessToken, input())
                        .then(async (result) => {
                          setMessage(
                            `Paused — ${result.impact.newlySuppressedLectureCount} lectures suppressed across ${result.impact.affectedTimetableCount} timetable${result.impact.affectedTimetableCount === 1 ? "" : "s"}.`,
                          );
                          setOpen(false);
                          setPreview(null);
                          setLabel("");
                          await refresh();
                        })
                        .catch((error) =>
                          setMessage(
                            error instanceof Error
                              ? error.message
                              : "Could not save pause.",
                          ),
                        )
                        .finally(() => setBusy(""));
                    }}
                  >
                    <CalendarOff size={16} />
                    {busy === "save" ? "Pausing…" : "Confirm pause"}
                  </button>
                </div>
              </div>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
