import { useRef, useState } from "react";
import { createExtraClassUpdate } from "./api/correctionMutations";
import { fetchPublicTimetable } from "./api/publicTimetable";
import { academicEventCategory } from "./domain/academicEventCategory";

type ExamFields = {
  exceptionDate: string;
  courseCode: string;
  courseName: string;
  startTime: string;
  endTime: string;
  venue: string;
  provenance: string;
};

const blankExam: ExamFields = {
  exceptionDate: "",
  courseCode: "",
  courseName: "",
  startTime: "",
  endTime: "",
  venue: "",
  provenance: "",
};

const normalizedCode = (code: string | null | undefined) =>
  (code ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();

/**
 * Date-specific exams must never pass through the recurring-session editor:
 * only explicit "Examination" exceptions survive institution lecture pauses.
 */
export function AdminDatedExamEntry({
  accessToken,
  timetableId,
  publicSlug,
  periodStartsOn,
  periodEndsOn,
  hasPublishedVersion,
}: {
  accessToken: string;
  timetableId: string;
  publicSlug: string;
  periodStartsOn: string | null;
  periodEndsOn: string | null;
  hasPublishedVersion: boolean;
}) {
  const [fields, setFields] = useState<ExamFields>(blankExam);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const pending = useRef(false);
  const mutationKey = useRef<string | null>(null);

  function setField<K extends keyof ExamFields>(key: K, value: ExamFields[K]) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || !hasPublishedVersion) return;
    pending.current = true;
    setSaving(true);
    setMessage("");
    setIsError(false);

    try {
      const code = normalizedCode(fields.courseCode);
      if (!code || fields.startTime >= fields.endTime) {
        throw new Error("Check the examination course code and start/end times.");
      }
      if (
        (periodStartsOn && fields.exceptionDate < periodStartsOn) ||
        (periodEndsOn && fields.exceptionDate > periodEndsOn)
      ) {
        throw new Error("The examination date is outside this class's academic period.");
      }

      // Fail closed: an admin must not silently attach an exam to the wrong class.
      const published = await fetchPublicTimetable(publicSlug);
      if (published.timetableId !== timetableId) {
        throw new Error("The published timetable identity has changed. Reload the editor.");
      }
      const courses = published.effectiveSessions ?? published.sessions;
      if (!courses.some((course) => normalizedCode(course.courseCode) === code)) {
        throw new Error("That course code is not in this published class. Check its cohort mapping.");
      }
      if (
        (published.exceptions ?? []).some(
          (item) =>
            item.active &&
            !item.revokedAt &&
            !item.supersededAt &&
            item.exceptionType === "extra" &&
            academicEventCategory(item.sessionType) === "exam" &&
            normalizedCode(item.courseCode) === code &&
            item.exceptionDate === fields.exceptionDate,
        )
      ) {
        throw new Error("An exam already exists for this course and date. Review it before editing.");
      }

      if (!mutationKey.current) {
        if (!globalThis.crypto?.randomUUID) {
          throw new Error("This browser cannot create a secure save key.");
        }
        mutationKey.current = globalThis.crypto.randomUUID();
      }
      const saved = await createExtraClassUpdate(
        accessToken,
        timetableId,
        mutationKey.current,
        {
          exceptionDate: fields.exceptionDate,
          exceptionType: "extra",
          stableSessionKey: null,
          courseCode: fields.courseCode.trim(),
          courseName: fields.courseName.trim(),
          startTime: fields.startTime,
          endTime: fields.endTime,
          venue: fields.venue.trim(),
          sessionType: "Examination",
          lecturer: null,
          reason: "Verified examination timetable",
          provenance: fields.provenance.trim(),
        },
      );

      // A successful write is not proof that an original subscriber feed refreshed.
      mutationKey.current = null;
      setFields(blankExam);
      const refreshed = await fetchPublicTimetable(publicSlug).catch(() => null);
      const visible = refreshed?.exceptions?.some(
        (item) => item.active && item.id === saved.exception.id,
      );
      setMessage(
        visible
          ? "Exam saved and visible in the public timetable API. Verify the original ICS feed."
          : "Exam save accepted. Public timetable/feed verification is still required.",
      );
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : "Could not save the examination.");
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return (
    <section className="pilot-surface" aria-label="Dated examinations">
      <div className="pilot-surface-header">
        <div>
          <h2>Dated examinations</h2>
          <p>One-off exams use the published class calendar, not recurring lectures.</p>
        </div>
      </div>
      {!hasPublishedVersion ? (
        <p className="pilot-muted">Publish the class timetable before adding examinations.</p>
      ) : (
        <form className="pilot-form" onSubmit={(event) => void submit(event)}>
          <label className="pilot-field">
            <span>Exam date</span>
            <input type="date" required min={periodStartsOn ?? undefined} max={periodEndsOn ?? undefined} value={fields.exceptionDate} onChange={(event) => setField("exceptionDate", event.target.value)} />
          </label>
          <label className="pilot-field">
            <span>Course code</span>
            <input required maxLength={50} value={fields.courseCode} onChange={(event) => setField("courseCode", event.target.value)} />
          </label>
          <label className="pilot-field">
            <span>Course name</span>
            <input required maxLength={250} value={fields.courseName} onChange={(event) => setField("courseName", event.target.value)} />
          </label>
          <label className="pilot-field">
            <span>Start time</span>
            <input type="time" required value={fields.startTime} onChange={(event) => setField("startTime", event.target.value)} />
          </label>
          <label className="pilot-field">
            <span>End time</span>
            <input type="time" required value={fields.endTime} onChange={(event) => setField("endTime", event.target.value)} />
          </label>
          <label className="pilot-field">
            <span>Exam venue</span>
            <input required maxLength={250} value={fields.venue} onChange={(event) => setField("venue", event.target.value)} />
          </label>
          <label className="pilot-field">
            <span>Verified source and page</span>
            <input required maxLength={1000} placeholder="Issuer, revision/date, PDF page" value={fields.provenance} onChange={(event) => setField("provenance", event.target.value)} />
          </label>
          <p className="pilot-muted">Use only source-verified exams matching this published class. Lecture pauses do not suppress explicit examinations.</p>
          <button className="primary" type="submit" disabled={saving}>
            {saving ? "Saving examination..." : "Save dated examination"}
          </button>
        </form>
      )}
      {message ? <p role={isError ? "alert" : "status"} className="content-notice">{message}</p> : null}
    </section>
  );
}
