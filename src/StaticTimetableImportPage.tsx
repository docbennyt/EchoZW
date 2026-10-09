import { Button } from "@base-ui/react/button";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  createAcademicPeriod,
  createClassGroup,
  createProgramme,
} from "./api/pilotAdmin";
import {
  createStaticTimetableDraft,
  getStaticTimetableImport,
  getStaticTimetableImportOptions,
  patchStaticTimetableTargetMapping,
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

type Mapping = {
  programmeId: string;
  cohortId: string;
  academicPeriodId: string;
};

type EditableSession = StaticImportSession & {
  courseNameDraft: string;
  courseCodeDraft: string;
  venueDraft: string;
  lecturerDraft: string;
};

type SearchOption = {
  id: string;
  label: string;
  aliases: string[];
};

function normalize(value: string) {
  return value.trim().toLocaleLowerCase("en").replace(/\s+/g, " ");
}

function findExactOption(query: string, options: SearchOption[]) {
  const wanted = normalize(query);
  if (!wanted) return null;
  const matches = options.filter(
    (option) =>
      normalize(option.label) === wanted ||
      option.aliases.some((alias) => normalize(alias) === wanted),
  );
  return matches.length === 1 ? matches[0] : null;
}

function editableSessions(review: StaticImportReview): EditableSession[] {
  return review.parsed.sessions.map((session) => ({
    ...session,
    courseNameDraft: session.courseName ?? "",
    courseCodeDraft: session.courseCode,
    venueDraft: session.venueRaw ?? "",
    lecturerDraft: session.lecturerRaw ?? "",
  }));
}

function mappingsFromReview(review: StaticImportReview) {
  return Object.fromEntries(
    review.targets.map((target) => [
      target.id,
      {
        programmeId: target.matchedProgrammeId ?? "",
        cohortId: target.matchedCohortId ?? "",
        academicPeriodId: target.matchedAcademicPeriodId ?? "",
      },
    ]),
  ) as Record<string, Mapping>;
}

async function loadToken() {
  const supabase = createClient();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("AUTH_REQUIRED");
  return token;
}

function SearchCreateField({
  label,
  inputId,
  query,
  options,
  disabled,
  helper,
  createLabel,
  onQuery,
  onSelect,
  onCreate,
}: {
  label: string;
  inputId: string;
  query: string;
  options: SearchOption[];
  disabled?: boolean;
  helper?: string;
  createLabel: string;
  onQuery: (value: string) => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  const exact = findExactOption(query, options);
  return (
    <div className="czw-static-import-combobox">
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        list={`${inputId}-options`}
        role="combobox"
        aria-autocomplete="list"
        autoComplete="off"
        value={query}
        disabled={disabled}
        placeholder={
          disabled
            ? "Choose a programme first"
            : `Search or type ${label.toLowerCase()}`
        }
        onChange={(event) => {
          const value = event.target.value;
          onQuery(value);
          const match = findExactOption(value, options);
          if (match) onSelect(match.id);
        }}
      />
      <datalist id={`${inputId}-options`}>
        {options.map((option) => (
          <option key={option.id} value={option.label} />
        ))}
      </datalist>
      {helper ? <small>{helper}</small> : null}
      {!disabled && query.trim() && !exact ? (
        <button
          type="button"
          className="czw-static-import-inline-action"
          onClick={onCreate}
        >
          + {createLabel}
        </button>
      ) : null}
    </div>
  );
}

export function StaticTimetableImportPage() {
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "auth" | "error">(
    "loading",
  );
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState<StaticImportOptions>(EMPTY_OPTIONS);
  const [institutionId, setInstitutionId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [review, setReview] = useState<StaticImportReview | null>(null);
  const [sessions, setSessions] = useState<EditableSession[]>([]);
  const [targetId, setTargetId] = useState("");
  const [mappings, setMappings] = useState<Record<string, Mapping>>({});
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [activeStep, setActiveStep] = useState(1);
  const [programmeQuery, setProgrammeQuery] = useState("");
  const [cohortQuery, setCohortQuery] = useState("");
  const [periodQuery, setPeriodQuery] = useState("");
  const [createMode, setCreateMode] = useState<
    "programme" | "cohort" | "period" | null
  >(null);
  const [programmeForm, setProgrammeForm] = useState({ name: "", code: "" });
  const [cohortForm, setCohortForm] = useState({
    label: "",
    yearLevel: "",
    semesterNumber: "",
    groupName: "",
  });
  const [periodForm, setPeriodForm] = useState({
    name: "",
    startsOn: "",
    endsOn: "",
  });

  const sourceRef = useRef<HTMLElement>(null);
  const matchRef = useRef<HTMLElement>(null);
  const reviewRef = useRef<HTMLElement>(null);
  const draftRef = useRef<HTMLElement>(null);

  const selectedTarget = useMemo(
    () =>
      review?.targets.find((target) => target.id === targetId) ??
      review?.targets[0] ??
      null,
    [review, targetId],
  );
  const selectedMapping = selectedTarget
    ? (mappings[selectedTarget.id] ?? {
        programmeId: "",
        cohortId: "",
        academicPeriodId: "",
      })
    : { programmeId: "", cohortId: "", academicPeriodId: "" };

  const programmeOptions = useMemo<SearchOption[]>(
    () =>
      options.programmes.map((programme) => ({
        id: programme.id,
        label: programme.name,
        aliases: [programme.name, programme.code ?? ""].filter(Boolean),
      })),
    [options.programmes],
  );

  const cohortOptions = useMemo<SearchOption[]>(() => {
    if (!selectedMapping.programmeId) return [];
    return options.cohorts
      .filter((cohort) => cohort.programme_id === selectedMapping.programmeId)
      .sort((a, b) => {
        const aScore =
          Number(a.year_level === selectedTarget?.yearLevel) +
          Number(a.semester_number === selectedTarget?.semesterNumber);
        const bScore =
          Number(b.year_level === selectedTarget?.yearLevel) +
          Number(b.semester_number === selectedTarget?.semesterNumber);
        return bScore - aScore;
      })
      .map((cohort) => {
        const context = [
          cohort.label || cohort.level_label || cohort.code,
          cohort.year_level ? `Year ${cohort.year_level}` : null,
          cohort.semester_number ? `Sem ${cohort.semester_number}` : null,
          cohort.group_name || cohort.group_label || null,
        ]
          .filter(Boolean)
          .join(" · ");
        return {
          id: cohort.id,
          label: context,
          aliases: [
            cohort.label,
            cohort.level_label,
            cohort.code,
            context,
          ].filter(Boolean),
        };
      });
  }, [
    options.cohorts,
    selectedMapping.programmeId,
    selectedTarget?.semesterNumber,
    selectedTarget?.yearLevel,
  ]);

  const periodOptions = useMemo<SearchOption[]>(
    () =>
      options.academicPeriods.map((period) => ({
        id: period.id,
        label: [
          period.name,
          period.academic_year,
          period.starts_on && period.ends_on
            ? `${period.starts_on} → ${period.ends_on}`
            : null,
        ]
          .filter(Boolean)
          .join(" · "),
        aliases: [period.name, period.academic_year],
      })),
    [options.academicPeriods],
  );

  const blockingWarnings = useMemo(
    () =>
      review?.warnings.filter((warning) => warning.severity === "blocking") ??
      [],
    [review],
  );

  function blockersForTarget(target: StaticImportReview["targets"][number]) {
    const keys = new Set(target.candidateKeys);
    return blockingWarnings.filter(
      (warning) => !warning.candidateKey || keys.has(warning.candidateKey),
    );
  }

  function sessionsForTarget(target: StaticImportReview["targets"][number]) {
    const keys = new Set(target.candidateKeys);
    return sessions.filter((session) => keys.has(session.candidateKey));
  }

  const targetSessions = selectedTarget
    ? sessionsForTarget(selectedTarget)
    : sessions;
  const targetBlockers = selectedTarget
    ? blockersForTarget(selectedTarget)
    : blockingWarnings;
  const unresolvedTargetBlockers = targetBlockers.filter(
    (warning) => !(resolutions[warning.id] ?? "").trim(),
  );
  const greenSessionCount = sessions.filter(
    (session) => session.warningCodes.length === 0,
  ).length;

  function targetPeriodHasDates(target: StaticImportReview["targets"][number]) {
    const mapping = mappings[target.id];
    if (!mapping?.academicPeriodId) return false;
    const period = options.academicPeriods.find(
      (item) => item.id === mapping.academicPeriodId,
    );
    return Boolean(period?.starts_on && period?.ends_on);
  }

  function targetReady(target: StaticImportReview["targets"][number]) {
    const mapping = mappings[target.id];
    const targetSessions = sessionsForTarget(target);
    return Boolean(
      mapping?.programmeId &&
      mapping.cohortId &&
      mapping.academicPeriodId &&
      targetPeriodHasDates(target) &&
      blockersForTarget(target).every(
        (warning) => (resolutions[warning.id] ?? "").trim().length > 0,
      ) &&
      targetSessions.length > 0 &&
      targetSessions.every(
        (session) =>
          session.courseCodeDraft.trim() && session.courseNameDraft.trim(),
      ),
    );
  }

  function hydrateReview(next: StaticImportReview, resetSessions = true) {
    setReview(next);
    if (resetSessions) setSessions(editableSessions(next));
    setMappings(mappingsFromReview(next));
    setInstitutionId(next.document.institutionId);
    setTargetId((current) =>
      next.targets.some((target) => target.id === current)
        ? current
        : (next.targets[0]?.id ?? ""),
    );
    setResolutions((current) => ({
      ...current,
      ...Object.fromEntries(
        next.warnings
          .filter((warning) => warning.resolutionNote)
          .map((warning) => [warning.id, warning.resolutionNote ?? ""]),
      ),
    }));
  }

  async function refreshOptions(nextInstitutionId = institutionId) {
    if (!token || !nextInstitutionId) return EMPTY_OPTIONS;
    const response = await getStaticTimetableImportOptions(
      token,
      nextInstitutionId,
    );
    setOptions(response.options);
    return response.options;
  }

  function goToStep(step: number) {
    setActiveStep(step);
    const ref = [sourceRef, matchRef, reviewRef, draftRef][step - 1];
    requestAnimationFrame(() => {
      ref?.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      ref?.current?.focus({ preventScroll: true });
    });
  }

  useEffect(() => {
    void (async () => {
      try {
        const accessToken = await loadToken();
        setToken(accessToken);
        const initial = await getStaticTimetableImportOptions(accessToken);
        setOptions(initial.options);
        const batchId = new URLSearchParams(window.location.search).get(
          "batch",
        );
        if (batchId) {
          const loaded = await getStaticTimetableImport(accessToken, batchId);
          const scoped = await getStaticTimetableImportOptions(
            accessToken,
            loaded.review.document.institutionId,
          );
          setOptions(scoped.options);
          hydrateReview(loaded.review);
          setActiveStep(2);
        }
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

  function selectTarget(nextTargetId: string) {
    setTargetId(nextTargetId);
    const mapping = mappings[nextTargetId];
    const programme = options.programmes.find(
      (item) => item.id === mapping?.programmeId,
    );
    const cohort = options.cohorts.find(
      (item) => item.id === mapping?.cohortId,
    );
    const period = options.academicPeriods.find(
      (item) => item.id === mapping?.academicPeriodId,
    );
    setProgrammeQuery(programme?.name ?? "");
    setCohortQuery(
      cohort
        ? [
            cohort.label || cohort.level_label || cohort.code,
            cohort.year_level ? `Year ${cohort.year_level}` : null,
            cohort.semester_number ? `Sem ${cohort.semester_number}` : null,
            cohort.group_name || cohort.group_label || null,
          ]
            .filter(Boolean)
            .join(" · ")
        : "",
    );
    setPeriodQuery(
      period
        ? [
            period.name,
            period.academic_year,
            period.starts_on && period.ends_on
              ? `${period.starts_on} → ${period.ends_on}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")
        : "",
    );
    setCreateMode(null);
  }

  async function changeInstitution(nextId: string) {
    setInstitutionId(nextId);
    setReview(null);
    setSessions([]);
    setMappings({});
    setTargetId("");
    setError("");
    setSuccess("");
    setFile(null);
    window.history.replaceState({}, "", "/admin/static-import");
    if (!token || !nextId) {
      setOptions((current) => ({
        ...EMPTY_OPTIONS,
        institutions: current.institutions,
      }));
      return;
    }
    setBusy(true);
    try {
      await refreshOptions(nextId);
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
      hydrateReview(response.review);
      await refreshOptions(response.review.document.institutionId);
      window.history.replaceState(
        {},
        "",
        `/admin/static-import?batch=${response.review.batch.id}`,
      );
      goToStep(2);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not import DOCX.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function persistMapping(
    target: StaticImportReview["targets"][number],
    patch: Partial<Mapping>,
  ) {
    if (!token || !review) return;
    const current = mappings[target.id] ?? {
      programmeId: "",
      cohortId: "",
      academicPeriodId: "",
    };
    const next = { ...current, ...patch };
    setBusy(true);
    setError("");
    try {
      const response = await patchStaticTimetableTargetMapping(
        token,
        review.batch.id,
        target.id,
        {
          programmeId: next.programmeId || null,
          cohortId: next.cohortId || null,
          academicPeriodId: next.academicPeriodId || null,
        },
      );
      setReview(response.review);
      setMappings(mappingsFromReview(response.review));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not save canonical mapping.",
      );
      throw caught;
    } finally {
      setBusy(false);
    }
  }

  async function createProgrammeInline(event: FormEvent) {
    event.preventDefault();
    if (!token || !selectedTarget || !institutionId) return;
    const name = programmeForm.name.trim() || programmeQuery.trim();
    if (!name) return;
    setBusy(true);
    setError("");
    try {
      const exact = options.programmes.find(
        (programme) =>
          normalize(programme.name) === normalize(name) ||
          normalize(programme.code ?? "") === normalize(name),
      );
      let programmeId = exact?.id ?? "";
      if (!programmeId) {
        try {
          const result = await createProgramme(token, {
            institutionId,
            name,
            code: programmeForm.code.trim() || null,
          });
          programmeId = result.programme.id;
        } catch (caught) {
          const refreshed = await refreshOptions(institutionId);
          const raced = refreshed.programmes.find(
            (programme) =>
              normalize(programme.name) === normalize(name) ||
              normalize(programme.code ?? "") === normalize(programmeForm.code),
          );
          if (!raced) throw caught;
          programmeId = raced.id;
        }
      }
      await refreshOptions(institutionId);
      await persistMapping(selectedTarget, {
        programmeId,
        cohortId: "",
      });
      setProgrammeQuery(name);
      setCohortQuery("");
      setCreateMode(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not create programme.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function createCohortInline(event: FormEvent) {
    event.preventDefault();
    if (!token || !selectedTarget || !selectedMapping.programmeId) return;
    const label = cohortForm.label.trim() || selectedTarget.titleRaw;
    setBusy(true);
    setError("");
    try {
      const scoped = options.cohorts.filter(
        (cohort) => cohort.programme_id === selectedMapping.programmeId,
      );
      const exact = scoped.find(
        (cohort) =>
          normalize(cohort.label) === normalize(label) &&
          (cohort.group_name ?? "") === cohortForm.groupName.trim(),
      );
      let cohortId = exact?.id ?? "";
      if (!cohortId) {
        try {
          const result = await createClassGroup(token, {
            programmeId: selectedMapping.programmeId,
            label,
            yearLevel: cohortForm.yearLevel
              ? Number(cohortForm.yearLevel)
              : selectedTarget.yearLevel,
            semesterNumber: cohortForm.semesterNumber
              ? Number(cohortForm.semesterNumber)
              : selectedTarget.semesterNumber,
            groupName: cohortForm.groupName.trim() || null,
          });
          cohortId = result.classGroup.id;
        } catch (caught) {
          const refreshed = await refreshOptions(institutionId);
          const raced = refreshed.cohorts.find(
            (cohort) =>
              cohort.programme_id === selectedMapping.programmeId &&
              normalize(cohort.label) === normalize(label),
          );
          if (!raced) throw caught;
          cohortId = raced.id;
        }
      }
      await refreshOptions(institutionId);
      await persistMapping(selectedTarget, { cohortId });
      setCreateMode(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not create class.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function createPeriodInline(event: FormEvent) {
    event.preventDefault();
    if (!token || !selectedTarget || !institutionId) return;
    const name = periodForm.name.trim() || periodQuery.trim();
    if (!name || !periodForm.startsOn || !periodForm.endsOn) return;
    setBusy(true);
    setError("");
    try {
      const exact = options.academicPeriods.find(
        (period) =>
          normalize(period.name) === normalize(name) &&
          period.starts_on === periodForm.startsOn &&
          period.ends_on === periodForm.endsOn,
      );
      let academicPeriodId = exact?.id ?? "";
      if (!academicPeriodId) {
        try {
          const result = await createAcademicPeriod(token, {
            institutionId,
            name,
            startsOn: periodForm.startsOn,
            endsOn: periodForm.endsOn,
          });
          academicPeriodId = result.academicPeriod.id;
        } catch (caught) {
          const refreshed = await refreshOptions(institutionId);
          const raced = refreshed.academicPeriods.find(
            (period) =>
              normalize(period.name) === normalize(name) &&
              period.starts_on === periodForm.startsOn &&
              period.ends_on === periodForm.endsOn,
          );
          if (!raced) throw caught;
          academicPeriodId = raced.id;
        }
      }
      await refreshOptions(institutionId);
      await persistMapping(selectedTarget, { academicPeriodId });
      setCreateMode(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not create academic period.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function applyProgrammeToAll() {
    if (!review || !selectedMapping.programmeId) return;
    for (const target of review.targets) {
      const mapping = mappings[target.id];
      const existingCohort = options.cohorts.find(
        (cohort) => cohort.id === mapping?.cohortId,
      );
      await persistMapping(target, {
        programmeId: selectedMapping.programmeId,
        cohortId:
          existingCohort?.programme_id === selectedMapping.programmeId
            ? (mapping?.cohortId ?? "")
            : "",
      });
    }
  }

  async function applyPeriodToAll() {
    if (!review || !selectedMapping.academicPeriodId) return;
    for (const target of review.targets) {
      await persistMapping(target, {
        academicPeriodId: selectedMapping.academicPeriodId,
      });
    }
  }

  function patchSession(candidateKey: string, patch: Partial<EditableSession>) {
    setSessions((current) =>
      current.map((session) =>
        session.candidateKey === candidateKey
          ? { ...session, ...patch }
          : session,
      ),
    );
  }

  async function createTargetDraft(
    target: StaticImportReview["targets"][number],
  ) {
    if (!token || !review || !targetReady(target) || target.createdDraft)
      return;
    const mapping = mappings[target.id];
    const targetSessions = sessionsForTarget(target);
    const result = await createStaticTimetableDraft(token, review.batch.id, {
      targetId: target.id,
      programmeId: mapping.programmeId,
      cohortId: mapping.cohortId,
      academicPeriodId: mapping.academicPeriodId,
      resolutions: blockersForTarget(target).map((warning) => ({
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
    return result.draft;
  }

  async function refreshReviewAfterDraft() {
    if (!token || !review) return;
    const refreshed = await getStaticTimetableImport(token, review.batch.id);
    hydrateReview(refreshed.review, false);
  }

  async function createAllReadyDrafts() {
    if (!token || !review) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      let created = 0;
      for (const target of review.targets) {
        if (targetReady(target) && !target.createdDraft) {
          await createTargetDraft(target);
          created += 1;
        }
      }
      await refreshReviewAfterDraft();
      setSuccess(
        created
          ? `${created} review draft${created === 1 ? "" : "s"} created. Nothing has been published.`
          : "No additional drafts were ready to create.",
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not create drafts.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function createSingleDraft(
    target: StaticImportReview["targets"][number],
  ) {
    setBusy(true);
    setError("");
    try {
      await createTargetDraft(target);
      await refreshReviewAfterDraft();
      setSuccess("Review draft created. Nothing has been published.");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not create draft.",
      );
    } finally {
      setBusy(false);
    }
  }

  function beginProgrammeCreate() {
    setProgrammeForm({
      name:
        programmeQuery.trim() || review?.parsed.metadata.departmentName || "",
      code: "",
    });
    setCreateMode("programme");
  }

  function beginCohortCreate() {
    setCohortForm({
      label: cohortQuery.trim() || selectedTarget?.titleRaw || "",
      yearLevel: selectedTarget?.yearLevel
        ? String(selectedTarget.yearLevel)
        : "",
      semesterNumber: selectedTarget?.semesterNumber
        ? String(selectedTarget.semesterNumber)
        : "",
      groupName: "",
    });
    setCreateMode("cohort");
  }

  function beginPeriodCreate() {
    const year =
      selectedTarget?.academicYearRaw ??
      review?.parsed.metadata.academicYearRaw ??
      "";
    const semester =
      selectedTarget?.semesterNumber ??
      review?.parsed.metadata.semesterNumber ??
      "";
    setPeriodForm({
      name:
        periodQuery.trim() ||
        [semester ? `Semester ${semester}` : "", year]
          .filter(Boolean)
          .join(", "),
      startsOn: "",
      endsOn: "",
    });
    setCreateMode("period");
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

  const progress = [20, 50, 80, 100][activeStep - 1];
  const selectedProgramme = options.programmes.find(
    (item) => item.id === selectedMapping.programmeId,
  );
  const selectedPeriod = options.academicPeriods.find(
    (item) => item.id === selectedMapping.academicPeriodId,
  );
  const readyTargets =
    review?.targets.filter(
      (target) => targetReady(target) && !target.createdDraft,
    ) ?? [];

  return (
    <main className="czw-static-import">
      <header className="czw-static-import-header">
        <div>
          <span>CalenderZW · source truth</span>
          <h1>Import a class timetable document</h1>
          <p>
            Upload once, confirm only what CalenderZW cannot prove, then create
            guarded review drafts. Nothing is published automatically.
          </p>
        </div>
        <a href="/admin">Back to Admin</a>
      </header>

      <nav className="czw-import-progress" aria-label="Import progress">
        <div
          className="czw-import-progress-track"
          role="progressbar"
          aria-label="Timetable import workflow"
          aria-valuemin={20}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <span style={{ width: `${progress}%` }} />
        </div>
        <div className="czw-import-progress-steps">
          {[
            [1, "20%", "Source"],
            [2, "50%", "Match"],
            [3, "80%", "Review"],
            [4, "100%", "Draft"],
          ].map(([step, pct, label]) => (
            <button
              key={String(step)}
              type="button"
              className={activeStep === step ? "active" : ""}
              aria-current={activeStep === step ? "step" : undefined}
              disabled={Number(step) > 1 && !review}
              onClick={() => goToStep(Number(step))}
            >
              <strong>{pct}</strong>
              <span>{label}</span>
            </button>
          ))}
        </div>
      </nav>

      {error ? (
        <div className="czw-static-import-alert error">{error}</div>
      ) : null}
      {success ? (
        <div className="czw-static-import-alert success">{success}</div>
      ) : null}

      {activeStep === 1 ? (
        <section
          ref={sourceRef}
          tabIndex={-1}
          className="czw-static-import-panel czw-import-step"
        >
          <div className="czw-static-import-section-heading">
            <div>
              <span>20% · Source</span>
              <h2>
                {review ? "Source captured" : "Upload authoritative DOCX"}
              </h2>
            </div>
            <small>Maximum 10 MB · structured DOCX · no OCR</small>
          </div>
          {!review ? (
            <div className="czw-static-import-upload-grid">
              <label>
                Institution
                <select
                  value={institutionId}
                  disabled={busy}
                  onChange={(event) =>
                    void changeInstitution(event.target.value)
                  }
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
          ) : (
            <>
              <div className="czw-import-found">
                <div>
                  <span>We found</span>
                  <h3>
                    {review.parsed.metadata.title ??
                      review.document.originalFilename}
                  </h3>
                  <p>
                    {review.parsed.metadata.departmentName ??
                      "Department unresolved"}
                    {" · "}
                    {review.parsed.metadata.academicYearRaw ??
                      review.parsed.metadata.academicYear ??
                      "Academic year unresolved"}
                    {" · "}
                    Semester {review.parsed.metadata.semesterNumber ?? "?"}
                  </p>
                </div>
                <div className="czw-static-import-metrics">
                  <article>
                    <strong>{review.parsed.summary.sessionCount}</strong>
                    <span>sessions</span>
                  </article>
                  <article>
                    <strong>
                      {review.parsed.summary.timetableContactHours}
                    </strong>
                    <span>contact hours</span>
                  </article>
                  <article>
                    <strong>
                      {review.parsed.summary.courseReferenceCount}
                    </strong>
                    <span>course references</span>
                  </article>
                  <article>
                    <strong>{blockingWarnings.length}</strong>
                    <span>blockers</span>
                  </article>
                </div>
                <p>
                  {review.targets.length} timetable target
                  {review.targets.length === 1 ? "" : "s"} detected:{" "}
                  {review.targets.map((target) => target.titleRaw).join(", ")}.
                </p>
              </div>
              <div className="czw-import-actions">
                <button
                  type="button"
                  className="czw-button-secondary"
                  onClick={() => {
                    setReview(null);
                    setSessions([]);
                    setMappings({});
                    setTargetId("");
                    window.history.replaceState({}, "", "/admin/static-import");
                  }}
                >
                  Use another document
                </button>
                <Button type="button" onClick={() => goToStep(2)}>
                  Continue to mapping
                </Button>
              </div>
            </>
          )}
        </section>
      ) : null}

      {activeStep === 2 && review ? (
        <section
          ref={matchRef}
          tabIndex={-1}
          className="czw-static-import-panel czw-import-step"
        >
          <div className="czw-static-import-section-heading">
            <div>
              <span>50% · Match</span>
              <h2>Match these timetables to CalenderZW</h2>
            </div>
            <small>Mappings are saved to the import target</small>
          </div>

          <div
            className="czw-import-target-tabs"
            role="tablist"
            aria-label="Detected timetable targets"
          >
            {review.targets.map((target) => {
              const mapping = mappings[target.id];
              const ready = Boolean(
                mapping?.programmeId &&
                mapping.cohortId &&
                mapping.academicPeriodId,
              );
              return (
                <button
                  key={target.id}
                  type="button"
                  role="tab"
                  aria-selected={selectedTarget?.id === target.id}
                  className={selectedTarget?.id === target.id ? "active" : ""}
                  onClick={() => selectTarget(target.id)}
                >
                  <strong>{target.titleRaw}</strong>
                  <span>{ready ? "Mapped" : "Needs mapping"}</span>
                </button>
              );
            })}
          </div>

          {selectedTarget ? (
            <>
              <div className="czw-import-detected-meta">
                <span>
                  Detected level:{" "}
                  <strong>{selectedTarget.yearLevel ?? "—"}</strong>
                </span>
                <span>
                  Semester:{" "}
                  <strong>{selectedTarget.semesterNumber ?? "—"}</strong>
                </span>
                <span>
                  Academic year:{" "}
                  <strong>
                    {selectedTarget.academicYearRaw ??
                      review.parsed.metadata.academicYearRaw ??
                      "—"}
                  </strong>
                </span>
              </div>

              <div className="czw-import-mapping-grid">
                <SearchCreateField
                  label="Programme"
                  inputId="static-import-programme"
                  query={programmeQuery}
                  options={programmeOptions}
                  createLabel={`Create “${programmeQuery.trim()}”`}
                  helper={
                    selectedProgramme
                      ? `Linked to ${selectedProgramme.name}`
                      : "Search existing or create it here."
                  }
                  onQuery={setProgrammeQuery}
                  onSelect={(programmeId) => {
                    const cohort = options.cohorts.find(
                      (item) => item.id === selectedMapping.cohortId,
                    );
                    void persistMapping(selectedTarget, {
                      programmeId,
                      cohortId:
                        cohort?.programme_id === programmeId
                          ? selectedMapping.cohortId
                          : "",
                    });
                  }}
                  onCreate={beginProgrammeCreate}
                />
                <SearchCreateField
                  label="Cohort / class"
                  inputId="static-import-cohort"
                  query={cohortQuery}
                  options={cohortOptions}
                  disabled={!selectedMapping.programmeId}
                  createLabel="Create this class"
                  helper={
                    selectedMapping.programmeId
                      ? "Only classes in the selected programme are shown."
                      : "Choose or create a programme first."
                  }
                  onQuery={setCohortQuery}
                  onSelect={(cohortId) =>
                    void persistMapping(selectedTarget, { cohortId })
                  }
                  onCreate={beginCohortCreate}
                />
                <SearchCreateField
                  label="Academic period"
                  inputId="static-import-period"
                  query={periodQuery}
                  options={periodOptions}
                  createLabel="Create this academic period"
                  helper={
                    selectedPeriod && !targetPeriodHasDates(selectedTarget)
                      ? "This period needs start and end dates before draft creation."
                      : "Search existing or create it here."
                  }
                  onQuery={setPeriodQuery}
                  onSelect={(academicPeriodId) =>
                    void persistMapping(selectedTarget, { academicPeriodId })
                  }
                  onCreate={beginPeriodCreate}
                />
              </div>

              {createMode === "programme" ? (
                <form
                  className="czw-import-inline-create"
                  onSubmit={createProgrammeInline}
                >
                  <div>
                    <strong>Create programme</strong>
                    <small>Canonical programme · same institution</small>
                  </div>
                  <label>
                    Name
                    <input
                      required
                      value={programmeForm.name}
                      onChange={(event) =>
                        setProgrammeForm((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Code <span>(optional)</span>
                    <input
                      value={programmeForm.code}
                      onChange={(event) =>
                        setProgrammeForm((current) => ({
                          ...current,
                          code: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <div className="czw-import-actions">
                    <button
                      type="button"
                      className="czw-button-secondary"
                      onClick={() => setCreateMode(null)}
                    >
                      Cancel
                    </button>
                    <Button type="submit" disabled={busy}>
                      Create & use
                    </Button>
                  </div>
                </form>
              ) : null}

              {createMode === "cohort" ? (
                <form
                  className="czw-import-inline-create"
                  onSubmit={createCohortInline}
                >
                  <div>
                    <strong>Create class</strong>
                    <small>Prefilled from this detected target</small>
                  </div>
                  <label>
                    Label
                    <input
                      required
                      value={cohortForm.label}
                      onChange={(event) =>
                        setCohortForm((current) => ({
                          ...current,
                          label: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Year level
                    <input
                      type="number"
                      min="1"
                      value={cohortForm.yearLevel}
                      onChange={(event) =>
                        setCohortForm((current) => ({
                          ...current,
                          yearLevel: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Semester
                    <input
                      type="number"
                      min="1"
                      value={cohortForm.semesterNumber}
                      onChange={(event) =>
                        setCohortForm((current) => ({
                          ...current,
                          semesterNumber: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Group name <span>(optional)</span>
                    <input
                      value={cohortForm.groupName}
                      onChange={(event) =>
                        setCohortForm((current) => ({
                          ...current,
                          groupName: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <div className="czw-import-actions">
                    <button
                      type="button"
                      className="czw-button-secondary"
                      onClick={() => setCreateMode(null)}
                    >
                      Cancel
                    </button>
                    <Button type="submit" disabled={busy}>
                      Create & use
                    </Button>
                  </div>
                </form>
              ) : null}

              {createMode === "period" ? (
                <form
                  className="czw-import-inline-create"
                  onSubmit={createPeriodInline}
                >
                  <div>
                    <strong>Create academic period</strong>
                    <small>
                      Source wording is preserved; dates are human-confirmed.
                    </small>
                  </div>
                  <label>
                    Name
                    <input
                      required
                      value={periodForm.name}
                      onChange={(event) =>
                        setPeriodForm((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Starts on
                    <input
                      required
                      type="date"
                      value={periodForm.startsOn}
                      onChange={(event) =>
                        setPeriodForm((current) => ({
                          ...current,
                          startsOn: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Ends on
                    <input
                      required
                      type="date"
                      value={periodForm.endsOn}
                      onChange={(event) =>
                        setPeriodForm((current) => ({
                          ...current,
                          endsOn: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <div className="czw-import-actions">
                    <button
                      type="button"
                      className="czw-button-secondary"
                      onClick={() => setCreateMode(null)}
                    >
                      Cancel
                    </button>
                    <Button type="submit" disabled={busy}>
                      Create & use
                    </Button>
                  </div>
                </form>
              ) : null}

              <div className="czw-import-shared-actions">
                <span>Shared across this document?</span>
                <button
                  type="button"
                  className="czw-button-secondary"
                  disabled={!selectedMapping.programmeId || busy}
                  onClick={() => void applyProgrammeToAll()}
                >
                  Apply programme to all {review.targets.length}
                </button>
                <button
                  type="button"
                  className="czw-button-secondary"
                  disabled={!selectedMapping.academicPeriodId || busy}
                  onClick={() => void applyPeriodToAll()}
                >
                  Apply academic period to all {review.targets.length}
                </button>
              </div>
            </>
          ) : null}

          <div className="czw-import-actions czw-import-step-actions">
            <button
              type="button"
              className="czw-button-secondary"
              onClick={() => goToStep(1)}
            >
              Back
            </button>
            <Button type="button" onClick={() => goToStep(3)}>
              Review issues
            </Button>
          </div>
        </section>
      ) : null}

      {activeStep === 3 && review ? (
        <section
          ref={reviewRef}
          tabIndex={-1}
          className="czw-static-import-panel czw-import-step"
        >
          <div className="czw-static-import-section-heading">
            <div>
              <span>80% · Review</span>
              <h2>Resolve exceptions, not the whole document</h2>
            </div>
            <small>
              {greenSessionCount} sessions need no action ·{" "}
              {blockingWarnings.length} blockers
            </small>
          </div>

          <div
            className="czw-import-target-tabs"
            role="tablist"
            aria-label="Review target"
          >
            {review.targets.map((target) => (
              <button
                key={target.id}
                type="button"
                role="tab"
                aria-selected={selectedTarget?.id === target.id}
                className={selectedTarget?.id === target.id ? "active" : ""}
                onClick={() => selectTarget(target.id)}
              >
                <strong>{target.titleRaw}</strong>
                <span>{sessionsForTarget(target).length} sessions</span>
              </button>
            ))}
          </div>

          {selectedTarget ? (
            <>
              <div className="czw-import-review-summary">
                <strong>{targetSessions.length} sessions in this target</strong>
                <span>
                  {unresolvedTargetBlockers.length
                    ? `${unresolvedTargetBlockers.length} blocking issue${unresolvedTargetBlockers.length === 1 ? "" : "s"} need a decision`
                    : "No unresolved blockers for this target"}
                </span>
              </div>

              <div className="czw-static-import-warning-list">
                {targetBlockers.length === 0 ? (
                  <div className="czw-import-all-clear">
                    No blocking source ambiguity for this target.
                  </div>
                ) : null}
                {targetBlockers.map((warning) => (
                  <article key={warning.id} className="warning blocking">
                    <div>
                      <strong>{warning.code.replaceAll("_", " ")}</strong>
                      <span>Action required</span>
                    </div>
                    <p>{warning.message}</p>
                    <label>
                      Verified resolution
                      <textarea
                        value={resolutions[warning.id] ?? ""}
                        onChange={(event) =>
                          setResolutions((current) => ({
                            ...current,
                            [warning.id]: event.target.value,
                          }))
                        }
                        placeholder="Record the verified source interpretation or correction."
                      />
                    </label>
                  </article>
                ))}
              </div>

              <details
                className="czw-import-details"
                open={targetBlockers.length === 0}
              >
                <summary>
                  Timetable preview · {targetSessions.length} sessions
                </summary>
                <div className="czw-import-session-cards">
                  {targetSessions.slice(0, 10).map((session) => (
                    <article key={session.candidateKey}>
                      <div>
                        <strong>{session.courseCodeDraft}</strong>
                        <span>
                          {session.courseNameDraft || "Course name unresolved"}
                        </span>
                      </div>
                      <small>
                        {session.weekdayLabel} · {session.startTime}–
                        {session.endTime}
                        {session.venueDraft ? ` · ${session.venueDraft}` : ""}
                      </small>
                    </article>
                  ))}
                </div>
              </details>

              <details className="czw-import-details">
                <summary>
                  View and edit all {targetSessions.length} sessions
                </summary>
                <div className="czw-static-import-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Source</th>
                        <th>Day / time</th>
                        <th>Course</th>
                        <th>Venue</th>
                        <th>Lecturer</th>
                      </tr>
                    </thead>
                    <tbody>
                      {targetSessions.map((session) => (
                        <tr key={session.candidateKey}>
                          <td>
                            <code>
                              t{session.sourceTableIndex}:r
                              {session.sourceRowIndex}:c
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
                                patchSession(session.candidateKey, {
                                  courseCodeDraft: event.target.value,
                                })
                              }
                            />
                            <input
                              aria-label={`Course name ${session.candidateKey}`}
                              value={session.courseNameDraft}
                              onChange={(event) =>
                                patchSession(session.candidateKey, {
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
                                patchSession(session.candidateKey, {
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
                                patchSession(session.candidateKey, {
                                  lecturerDraft: event.target.value,
                                })
                              }
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>

              <details className="czw-import-details">
                <summary>Source evidence · read-only audit trail</summary>
                <div className="czw-import-evidence-stack">
                  <div>
                    <h3>Course references</h3>
                    <ul>
                      {review.parsed.courses.map((course) => (
                        <li key={course.candidateKey}>
                          <strong>{course.courseCodeRaw}</strong> —{" "}
                          {course.courseName}
                          {course.lecturerRaw ? ` · ${course.lecturerRaw}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                  {review.parsed.unparsed.length ? (
                    <div>
                      <h3>Unparsed timetable-looking cells</h3>
                      <ul>
                        {review.parsed.unparsed.map((candidate) => (
                          <li key={candidate.candidateKey}>
                            {candidate.rawText}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <div>
                    <h3>Meaningful ignored evidence</h3>
                    <ul>
                      {review.parsed.ignored
                        .filter((record) => record.rawText.trim())
                        .map((record, index) => (
                          <li
                            key={`${record.sourceTableIndex}:${record.sourceRowIndex}:${index}`}
                          >
                            {record.rawText}
                          </li>
                        ))}
                    </ul>
                  </div>
                </div>
              </details>
            </>
          ) : null}

          <div className="czw-import-actions czw-import-step-actions">
            <button
              type="button"
              className="czw-button-secondary"
              onClick={() => goToStep(2)}
            >
              Back
            </button>
            <Button type="button" onClick={() => goToStep(4)}>
              Review drafts
            </Button>
          </div>
        </section>
      ) : null}

      {activeStep === 4 && review ? (
        <section
          ref={draftRef}
          tabIndex={-1}
          className="czw-static-import-panel czw-import-step"
        >
          <div className="czw-static-import-section-heading">
            <div>
              <span>100% · Draft</span>
              <h2>Review what CalenderZW will create</h2>
            </div>
            <small>Nothing will be published.</small>
          </div>

          <div className="czw-import-draft-list">
            {review.targets.map((target) => {
              const mapping = mappings[target.id];
              const programme = options.programmes.find(
                (item) => item.id === mapping?.programmeId,
              );
              const cohort = options.cohorts.find(
                (item) => item.id === mapping?.cohortId,
              );
              const period = options.academicPeriods.find(
                (item) => item.id === mapping?.academicPeriodId,
              );
              const blockers = blockersForTarget(target).filter(
                (warning) => !(resolutions[warning.id] ?? "").trim(),
              );
              const ready = targetReady(target);
              return (
                <article key={target.id} className={ready ? "ready" : ""}>
                  <div>
                    <strong>{target.titleRaw}</strong>
                    <span>{sessionsForTarget(target).length} sessions</span>
                  </div>
                  <dl>
                    <div>
                      <dt>Programme</dt>
                      <dd>{programme?.name ?? "Not mapped"}</dd>
                    </div>
                    <div>
                      <dt>Class</dt>
                      <dd>{cohort?.label ?? "Not mapped"}</dd>
                    </div>
                    <div>
                      <dt>Period</dt>
                      <dd>{period?.name ?? "Not mapped"}</dd>
                    </div>
                  </dl>
                  {target.createdDraft ? (
                    <div className="czw-static-import-created">
                      <strong>Draft ready</strong>
                      <span>{target.createdDraft.sessionCount} sessions</span>
                      <a
                        href={`/admin/timetables/${target.createdDraft.timetableId}`}
                      >
                        Open draft
                      </a>
                    </div>
                  ) : ready ? (
                    <Button
                      type="button"
                      disabled={busy}
                      onClick={() => void createSingleDraft(target)}
                    >
                      Create this draft
                    </Button>
                  ) : (
                    <small className="czw-import-not-ready">
                      {!mapping?.programmeId ||
                      !mapping?.cohortId ||
                      !mapping?.academicPeriodId
                        ? "Finish canonical mapping. "
                        : ""}
                      {mapping?.academicPeriodId &&
                      !targetPeriodHasDates(target)
                        ? "Academic period needs dates. "
                        : ""}
                      {blockers.length
                        ? `${blockers.length} blocker${blockers.length === 1 ? "" : "s"} unresolved.`
                        : ""}
                    </small>
                  )}
                </article>
              );
            })}
          </div>

          <div className="czw-import-final-note">
            <strong>Nothing will be published.</strong>
            <p>
              Draft creation preserves source provenance and leaves the current
              published timetable untouched.
            </p>
          </div>

          <div className="czw-import-actions czw-import-step-actions">
            <button
              type="button"
              className="czw-button-secondary"
              onClick={() => goToStep(3)}
            >
              Back
            </button>
            <Button
              type="button"
              disabled={busy || readyTargets.length === 0}
              onClick={() => void createAllReadyDrafts()}
            >
              {busy
                ? "Creating drafts…"
                : `Create all ready drafts (${readyTargets.length})`}
            </Button>
          </div>
        </section>
      ) : null}
    </main>
  );
}
