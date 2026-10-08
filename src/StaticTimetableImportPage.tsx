import { Button } from "@base-ui/react/button";
import { useEffect, useMemo, useState } from "react";
import {
  createStaticTimetableDraft,
  getStaticTimetableImportOptions,
  type StaticImportOptions,
  type StaticImportReview,
  type StaticImportSession,
  uploadStaticTimetableDocx,
} from "./staticTimetableImportClient";
import { createClient } from "./utils/supabase/client";

const EMPTY_OPTIONS: StaticImportOptions = {
  institutions: [],
  programmes: [],
  cohorts: [],
  academicPeriods: [],
};

async function loadToken() {
  const supabase = createClient();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("AUTH_REQUIRED");
  return token;
}

type EditableSession = StaticImportSession & {
  courseNameDraft: string;
  courseCodeDraft: string;
  venueDraft: string;
  lecturerDraft: string;
};

function editableSessions(review: StaticImportReview): EditableSession[] {
  return review.parsed.sessions.map((session) => ({
    ...session,
    courseNameDraft: session.courseName ?? "",
    courseCodeDraft: session.courseCode,
    venueDraft: session.venueRaw ?? "",
    lecturerDraft: session.lecturerRaw ?? "",
  }));
}

export function StaticTimetableImportPage() {
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "auth" | "error">(
    "loading",
  );
  const [error, setError] = useState("");
  const [options, setOptions] = useState<StaticImportOptions>(EMPTY_OPTIONS);
  const [institutionId, setInstitutionId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [review, setReview] = useState<StaticImportReview | null>(null);
  const [sessions, setSessions] = useState<EditableSession[]>([]);
  const [programmeId, setProgrammeId] = useState("");
  const [cohortId, setCohortId] = useState("");
  const [academicPeriodId, setAcademicPeriodId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const accessToken = await loadToken();
        setToken(accessToken);
        const response = await getStaticTimetableImportOptions(accessToken);
        setOptions(response.options);
        setStatus("ready");
      } catch (caught) {
        if (caught instanceof Error && caught.message === "AUTH_REQUIRED") {
          setStatus("auth");
        } else {
          setError(
            caught instanceof Error
              ? caught.message
              : "Could not load importer.",
          );
          setStatus("error");
        }
      }
    })();
  }, []);

  async function changeInstitution(nextId: string) {
    setInstitutionId(nextId);
    setProgrammeId("");
    setCohortId("");
    setAcademicPeriodId("");
    setReview(null);
    setSessions([]);
    if (!token || !nextId) return;
    setBusy(true);
    setError("");
    try {
      const response = await getStaticTimetableImportOptions(token, nextId);
      setOptions(response.options);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not load institution options.",
      );
    } finally {
      setBusy(false);
    }
  }

  const availableCohorts = useMemo(
    () =>
      options.cohorts.filter(
        (cohort) => !programmeId || cohort.programme_id === programmeId,
      ),
    [options.cohorts, programmeId],
  );

  const blockingWarnings = useMemo(
    () =>
      review?.warnings.filter((warning) => warning.severity === "blocking") ??
      [],
    [review],
  );

  const unresolvedBlockers = useMemo(
    () =>
      blockingWarnings.filter(
        (warning) => !(resolutions[warning.id] ?? "").trim(),
      ),
    [blockingWarnings, resolutions],
  );

  const selectedTarget = useMemo(
    () =>
      review?.targets.find((target) => target.id === targetId) ??
      review?.targets[0] ??
      null,
    [review, targetId],
  );

  const targetSessions = useMemo(() => {
    if (!selectedTarget) return sessions;
    const candidateKeys = new Set(selectedTarget.candidateKeys);
    return sessions.filter((session) =>
      candidateKeys.has(session.candidateKey),
    );
  }, [selectedTarget, sessions]);

  const canCreateDraft = Boolean(
    review &&
    programmeId &&
    cohortId &&
    academicPeriodId &&
    sessions.length > 0 &&
    targetSessions.length > 0 &&
    targetSessions.every(
      (session) =>
        session.courseCodeDraft.trim() && session.courseNameDraft.trim(),
    ) &&
    unresolvedBlockers.length === 0 &&
    !review.createdDraft,
  );

  async function upload() {
    if (!token || !file || !institutionId) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const response = await uploadStaticTimetableDocx({
        accessToken: token,
        institutionId,
        file,
      });
      const next = response.review;
      setReview(next);
      setSessions(editableSessions(next));
      setTargetId(next.targets[0]?.id ?? "");
      setProgrammeId(next.suggestions.programmeId ?? "");
      setCohortId(next.suggestions.cohortId ?? "");
      setAcademicPeriodId(next.suggestions.academicPeriodId ?? "");
      setResolutions(
        Object.fromEntries(
          next.warnings
            .filter((warning) => warning.resolutionNote)
            .map((warning) => [warning.id, warning.resolutionNote ?? ""]),
        ),
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not import DOCX.",
      );
    } finally {
      setBusy(false);
    }
  }

  function patchSession(index: number, patch: Partial<EditableSession>) {
    setSessions((current) =>
      current.map((session, sessionIndex) =>
        sessionIndex === index ? { ...session, ...patch } : session,
      ),
    );
  }

  async function createDraft() {
    if (!token || !review || !canCreateDraft) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const result = await createStaticTimetableDraft(token, review.batch.id, {
        targetId: selectedTarget?.id ?? null,
        programmeId,
        cohortId,
        academicPeriodId,
        resolutions: blockingWarnings.map((warning) => ({
          warningId: warning.id,
          note: resolutions[warning.id].trim(),
        })),
        sessions: targetSessions.map((session) => ({
          candidateKey: session.candidateKey,
          courseCode: session.courseCodeDraft.trim(),
          courseName: session.courseNameDraft.trim(),
          weekday: session.weekday,
          startTime: session.startTime,
          endTime: session.endTime,
          venue: session.venueDraft.trim() || null,
          lecturer: session.lecturerDraft.trim() || null,
          sessionType: null,
          deliveryModeRaw: session.deliveryModeRaw,
        })),
      });
      setReview((current) =>
        current
          ? {
              ...current,
              createdDraft: {
                timetableId: result.draft.timetableId,
                draftVersionId: result.draft.draftVersionId,
                publicSlug: result.draft.publicSlug,
                sessionCount: result.draft.sessionCount,
              },
            }
          : current,
      );
      setSuccess(
        `Draft created with ${result.draft.sessionCount} sessions. Nothing has been published.`,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not create review draft.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (status === "auth") {
    return (
      <main className="czw-static-import czw-static-import-state">
        <h1>Static timetable import</h1>
        <p>Operational Admin or Superadmin sign-in is required.</p>
        <a className="czw-button czw-button-primary" href="/admin/login">
          Sign in
        </a>
      </main>
    );
  }

  if (status === "loading") {
    return (
      <main className="czw-static-import czw-static-import-state">
        Loading importer…
      </main>
    );
  }

  if (status === "error" && !token) {
    return (
      <main className="czw-static-import czw-static-import-state">
        <h1>Static timetable import</h1>
        <p>{error}</p>
      </main>
    );
  }

  return (
    <main className="czw-static-import">
      <header className="czw-static-import-header">
        <div>
          <span>CalenderZW · source truth</span>
          <h1>Import a class timetable document</h1>
          <p>
            DOCX is parsed deterministically into review evidence. Nothing is
            published until a human verifies it and the normal guarded
            publication path succeeds.
          </p>
        </div>
        <a href="/admin">Back to Admin</a>
      </header>

      {error ? (
        <div className="czw-static-import-alert error">{error}</div>
      ) : null}
      {success ? (
        <div className="czw-static-import-alert success">{success}</div>
      ) : null}

      <section className="czw-static-import-panel">
        <div className="czw-static-import-section-heading">
          <div>
            <span>1 · Source evidence</span>
            <h2>Upload authoritative DOCX</h2>
          </div>
          <small>Maximum 10 MB · structured DOCX · no OCR</small>
        </div>
        <div className="czw-static-import-upload-grid">
          <label>
            Institution
            <select
              value={institutionId}
              disabled={busy}
              onChange={(event) => void changeInstitution(event.target.value)}
            >
              <option value="">Choose institution</option>
              {options.institutions.map((institution) => (
                <option key={institution.id} value={institution.id}>
                  {institution.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            DOCX timetable
            <input
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              disabled={busy}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <Button
            type="button"
            disabled={busy || !institutionId || !file}
            onClick={() => void upload()}
          >
            {busy ? "Working…" : "Upload & extract"}
          </Button>
        </div>
      </section>

      {review ? (
        <>
          <section className="czw-static-import-panel">
            <div className="czw-static-import-section-heading">
              <div>
                <span>2 · Extracted identity</span>
                <h2>
                  {review.parsed.metadata.title ??
                    review.document.originalFilename}
                </h2>
              </div>
              <small>Parser {review.batch.parserVersion}</small>
            </div>
            <div className="czw-static-import-metrics">
              <article>
                <strong>{review.parsed.summary.sessionCount}</strong>
                <span>sessions</span>
              </article>
              <article>
                <strong>{review.parsed.summary.timetableContactHours}</strong>
                <span>contact hours</span>
              </article>
              <article>
                <strong>{review.parsed.summary.courseReferenceCount}</strong>
                <span>course references</span>
              </article>
              <article>
                <strong>{blockingWarnings.length}</strong>
                <span>blocking checks</span>
              </article>
            </div>
            <dl className="czw-static-import-evidence">
              <div>
                <dt>Department</dt>
                <dd>{review.parsed.metadata.departmentName ?? "Unresolved"}</dd>
              </div>
              <div>
                <dt>Academic year</dt>
                <dd>{review.parsed.metadata.academicYear ?? "Unresolved"}</dd>
              </div>
              <div>
                <dt>Part / level</dt>
                <dd>{review.parsed.metadata.yearLevel ?? "Unresolved"}</dd>
              </div>
              <div>
                <dt>Semester</dt>
                <dd>{review.parsed.metadata.semesterNumber ?? "Unresolved"}</dd>
              </div>
              <div>
                <dt>Mode wording</dt>
                <dd>{review.parsed.metadata.modeLabel ?? "Not stated"}</dd>
              </div>
              <div>
                <dt>Source SHA-256</dt>
                <dd>
                  <code>{review.document.sha256}</code>
                </dd>
              </div>
            </dl>
          </section>

          {review.targets.length > 0 ? (
            <section className="czw-static-import-panel">
              <div className="czw-static-import-section-heading">
                <div>
                  <span>3 · Detected targets</span>
                  <h2>Choose the timetable slice to review</h2>
                </div>
                <small>One document can create several drafts</small>
              </div>
              <div className="czw-static-import-target-list">
                {review.targets.map((target) => (
                  <label key={target.id} className="czw-static-import-target">
                    <input
                      type="radio"
                      name="static-import-target"
                      checked={(selectedTarget?.id ?? "") === target.id}
                      onChange={() => setTargetId(target.id)}
                    />
                    <span>
                      <strong>{target.titleRaw}</strong>
                      <small>
                        {target.candidateKeys.length} source candidates
                      </small>
                    </span>
                  </label>
                ))}
              </div>
            </section>
          ) : null}

          <section className="czw-static-import-panel">
            <div className="czw-static-import-section-heading">
              <div>
                <span>4 · Canonical mapping</span>
                <h2>Bind evidence to existing academic entities</h2>
              </div>
              <small>Exact suggestions only; no fuzzy entity creation</small>
            </div>
            <div className="czw-static-import-three-col">
              <label>
                Programme
                <select
                  value={programmeId}
                  onChange={(event) => {
                    setProgrammeId(event.target.value);
                    setCohortId("");
                  }}
                >
                  <option value="">Choose programme</option>
                  {options.programmes.map((programme) => (
                    <option key={programme.id} value={programme.id}>
                      {programme.code ? `${programme.code} · ` : ""}
                      {programme.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Cohort / class
                <select
                  value={cohortId}
                  onChange={(event) => setCohortId(event.target.value)}
                >
                  <option value="">Choose cohort</option>
                  {availableCohorts.map((cohort) => (
                    <option key={cohort.id} value={cohort.id}>
                      {cohort.label || cohort.level_label || cohort.code}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Academic period
                <select
                  value={academicPeriodId}
                  onChange={(event) => setAcademicPeriodId(event.target.value)}
                >
                  <option value="">Choose period</option>
                  {options.academicPeriods.map((period) => (
                    <option key={period.id} value={period.id}>
                      {period.name} · {period.academic_year}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <section className="czw-static-import-panel">
            <div className="czw-static-import-section-heading">
              <div>
                <span>5 · Review warnings</span>
                <h2>Resolve source ambiguities explicitly</h2>
              </div>
              <small>
                {unresolvedBlockers.length} blocking checks unresolved
              </small>
            </div>
            <div className="czw-static-import-warning-list">
              {review.warnings.length === 0 ? <p>No parser warnings.</p> : null}
              {review.warnings.map((warning) => (
                <article
                  key={warning.id}
                  className={`warning ${warning.severity}`}
                >
                  <div>
                    <strong>{warning.code.replaceAll("_", " ")}</strong>
                    <span>{warning.severity}</span>
                  </div>
                  <p>{warning.message}</p>
                  {warning.candidateKey ? (
                    <small>Evidence: {warning.candidateKey}</small>
                  ) : null}
                  {warning.severity === "blocking" ? (
                    <label>
                      Human resolution note
                      <textarea
                        value={resolutions[warning.id] ?? ""}
                        onChange={(event) =>
                          setResolutions((current) => ({
                            ...current,
                            [warning.id]: event.target.value,
                          }))
                        }
                        placeholder="Explain the verified interpretation/correction. This note becomes audit evidence."
                      />
                    </label>
                  ) : null}
                </article>
              ))}
            </div>
          </section>

          <section className="czw-static-import-panel">
            <div className="czw-static-import-section-heading">
              <div>
                <span>6 · Session verification</span>
                <h2>Correct only what the document review proves</h2>
              </div>
              <small>
                {selectedTarget
                  ? `${selectedTarget.titleRaw} · ${targetSessions.length} sessions`
                  : "Raw source remains preserved beside normalized fields"}
              </small>
            </div>
            <div className="czw-static-import-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Day / time</th>
                    <th>Course</th>
                    <th>Venue</th>
                    <th>Lecturer</th>
                    <th>Delivery evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {targetSessions.map((session) => {
                    const index = sessions.findIndex(
                      (item) => item.candidateKey === session.candidateKey,
                    );
                    return (
                      <tr key={session.candidateKey}>
                        <td>
                          <code>
                            t{session.sourceTableIndex}:r
                            {session.sourceRowIndex}
                            :c
                            {session.sourceColumnIndex}
                          </code>
                          <small>{session.rawText}</small>
                        </td>
                        <td>
                          {session.weekdayLabel}
                          <br />
                          <strong>
                            {session.startTime}–{session.endTime}
                          </strong>
                        </td>
                        <td>
                          <input
                            aria-label={`Course code ${session.candidateKey}`}
                            value={session.courseCodeDraft}
                            onChange={(event) =>
                              patchSession(index, {
                                courseCodeDraft: event.target.value,
                              })
                            }
                          />
                          <input
                            aria-label={`Course name ${session.candidateKey}`}
                            value={session.courseNameDraft}
                            placeholder="Verified course name"
                            onChange={(event) =>
                              patchSession(index, {
                                courseNameDraft: event.target.value,
                              })
                            }
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`Venue ${session.candidateKey}`}
                            value={session.venueDraft}
                            onChange={(event) =>
                              patchSession(index, {
                                venueDraft: event.target.value,
                              })
                            }
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`Lecturer ${session.candidateKey}`}
                            value={session.lecturerDraft}
                            onChange={(event) =>
                              patchSession(index, {
                                lecturerDraft: event.target.value,
                              })
                            }
                          />
                        </td>
                        <td>{session.deliveryModeRaw ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="czw-static-import-panel">
            <div className="czw-static-import-section-heading">
              <div>
                <span>7 · Evidence ledger</span>
                <h2>Inspect reference and non-session source evidence</h2>
              </div>
              <small>Read-only source truth retained for audit</small>
            </div>

            <h3>Course reference evidence</h3>
            <div className="czw-static-import-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Raw code</th>
                    <th>Title</th>
                    <th>Hours</th>
                    <th>Lecturer</th>
                  </tr>
                </thead>
                <tbody>
                  {review.parsed.courses.map((course) => (
                    <tr key={course.candidateKey}>
                      <td>
                        <code>
                          t{course.sourceTableIndex}:r{course.sourceRowIndex}
                        </code>
                        <small>{course.rawCells.join(" | ")}</small>
                      </td>
                      <td>{course.courseCodeRaw}</td>
                      <td>{course.courseName}</td>
                      <td>{course.hoursPerWeek ?? "—"}</td>
                      <td>{course.lecturerRaw ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3>Unparsed timetable-looking cells</h3>
            {review.parsed.unparsed.length === 0 ? (
              <p>No unparsed timetable-looking cells.</p>
            ) : (
              <div className="czw-static-import-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Day / time</th>
                      <th>Raw evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {review.parsed.unparsed.map((candidate) => (
                      <tr key={candidate.candidateKey}>
                        <td>
                          <code>
                            t{candidate.sourceTableIndex}:r
                            {candidate.sourceRowIndex}:c
                            {candidate.sourceColumnIndex}
                          </code>
                        </td>
                        <td>
                          {candidate.weekdayLabel} · {candidate.startTime}–
                          {candidate.endTime}
                        </td>
                        <td>{candidate.rawText}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <h3>Ignored structural evidence</h3>
            <div className="czw-static-import-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Kind</th>
                    <th>Time</th>
                    <th>Raw evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {review.parsed.ignored.map((record, index) => (
                    <tr
                      key={`${record.sourceTableIndex}:${record.sourceRowIndex}:${record.kind}:${index}`}
                    >
                      <td>
                        <code>
                          t{record.sourceTableIndex}:r{record.sourceRowIndex}
                        </code>
                      </td>
                      <td>{record.kind}</td>
                      <td>
                        {record.startTime && record.endTime
                          ? `${record.startTime}–${record.endTime}`
                          : "—"}
                      </td>
                      <td>{record.rawText || "Blank source cell"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="czw-static-import-panel czw-static-import-finalize">
            <div>
              <span>7 · Verify</span>
              <h2>Create a review draft</h2>
              <p>
                This action creates an immutable draft version and marks the
                class as
                <code> static_document</code>. It does not publish or replace a
                published timetable.
              </p>
            </div>
            {review.createdDraft ? (
              <div className="czw-static-import-created">
                <strong>Draft ready</strong>
                <span>
                  {review.createdDraft.sessionCount} sessions ·{" "}
                  {review.createdDraft.publicSlug}
                </span>
              </div>
            ) : (
              <Button
                type="button"
                disabled={busy || !canCreateDraft}
                onClick={() => void createDraft()}
              >
                {busy ? "Creating draft…" : "Verify & create draft"}
              </Button>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
