import { z } from "zod";
import type {
  AcademicPauseImpact,
  AcademicSchedulePause,
  PublicTimetable,
} from "../src/api/pilotTypes.js";
import { withCandidatePause } from "../src/domain/academicPause.js";
import {
  addDaysToDateKey,
  resolveScheduleForDate,
} from "../src/domain/resolvedSchedule.js";
import {
  createAcademicPause,
  deactivateAcademicPause,
  getPublishedTimetableScopeForPause,
  listPublishedTimetableIdsForPauseScope,
  type AcademicPauseInput,
} from "./academicPauseRepository.js";
import { getPublishedTimetableById } from "./pilotRepository.js";
import type { StaffAuthContext } from "./supabase/auth.js";

const dateKey = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(`${value}T00:00:00.000Z`);
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, "Choose a valid calendar date.");
const pauseSchema = z.object({
  scopeType: z.enum([
    "institution",
    "programme",
    "cohort",
    "timetable",
    "session",
  ]),
  institutionId: z.string().uuid().nullable().optional(),
  programmeId: z.string().uuid().nullable().optional(),
  cohortId: z.string().uuid().nullable().optional(),
  timetableId: z.string().uuid().nullable().optional(),
  stableSessionKey: z.string().trim().min(1).nullable().optional(),
  startsOn: dateKey,
  endsOn: dateKey,
  allDay: z.boolean().default(true),
  startsAt: z.string().datetime({ offset: true }).nullable().optional(),
  endsAt: z.string().datetime({ offset: true }).nullable().optional(),
  reason: z.enum([
    "sim_break",
    "graduation",
    "swot_week",
    "holiday",
    "closure",
    "other",
  ]),
  label: z.string().trim().min(1).max(120),
  provenance: z.string().trim().max(500).nullable().optional(),
});

const scopedPauseSchema = pauseSchema
  .omit({
    institutionId: true,
    programmeId: true,
    cohortId: true,
    timetableId: true,
  })
  .extend({
    scopeType: z.enum(["timetable", "session"]).default("timetable"),
  });

function occurrenceKey(
  occurrence: ReturnType<typeof resolveScheduleForDate>[number],
) {
  return `${occurrence.session.stableSessionKey}|${occurrence.start.toISOString()}|${occurrence.end.toISOString()}`;
}

function candidateRule(pause: AcademicPauseInput): AcademicSchedulePause {
  return {
    id: "preview-academic-pause",
    scopeType: pause.scopeType,
    stableSessionKey:
      pause.scopeType === "session" ? (pause.stableSessionKey ?? null) : null,
    startsOn: pause.startsOn,
    endsOn: pause.endsOn,
    allDay: pause.allDay,
    startsAt: pause.allDay ? null : (pause.startsAt ?? null),
    endsAt: pause.allDay ? null : (pause.endsAt ?? null),
    reason: pause.reason,
    label: pause.label,
    active: true,
    createdAt: new Date().toISOString(),
  };
}

function countNewlySuppressed(
  timetable: PublicTimetable,
  pause: AcademicPauseInput,
  dayBudget: number,
) {
  const withPause = withCandidatePause(timetable, candidateRule(pause));
  const startsOn =
    timetable.startsOn && timetable.startsOn > pause.startsOn
      ? timetable.startsOn
      : pause.startsOn;
  const endsOn =
    timetable.endsOn && timetable.endsOn < pause.endsOn
      ? timetable.endsOn
      : pause.endsOn;
  let total = 0;
  let days = 0;
  let current = startsOn;
  for (; current <= endsOn && days < dayBudget; days += 1) {
    const before = resolveScheduleForDate(timetable, current);
    const afterKeys = new Set(
      resolveScheduleForDate(withPause, current).map(occurrenceKey),
    );
    total += before.filter(
      (occurrence) => !afterKeys.has(occurrenceKey(occurrence)),
    ).length;
    current = addDaysToDateKey(current, 1);
  }
  return { total, days, complete: current > endsOn };
}

// At six reads per hydration, preview uses at most 19 DB reads including scope
// lookup, leaving room for auth and the canonical write in a Free request.
const MAX_IMPACT_TIMETABLES = 3;
const MAX_IMPACT_TIMETABLE_DAYS = 31;

export async function previewImpact(
  pause: AcademicPauseInput,
  env?: NodeJS.ProcessEnv,
): Promise<{
  impact: AcademicPauseImpact;
  timetableIds: string[];
}> {
  let timetableIds: string[];
  let totalCount: number | null;
  try {
    ({ timetableIds, totalCount } = await getPublishedTimetableScopeForPause(
      pause,
      env,
    ));
  } catch {
    return {
      impact: {
        affectedTimetableCount: 0,
        affectedTimetableCountKnown: false,
        newlySuppressedLectureCount: 0,
        previewStatus: "unknown",
        previewReason: "read_failed",
        evaluatedTimetableCount: 0,
        evaluatedDayCount: 0,
      },
      timetableIds: [],
    };
  }
  let newlySuppressedLectureCount = 0;
  let evaluatedTimetableCount = 0;
  let evaluatedDayCount = 0;
  let complete = true;
  let readFailed = false;
  for (const timetableId of timetableIds.slice(0, MAX_IMPACT_TIMETABLES)) {
    if (evaluatedDayCount >= MAX_IMPACT_TIMETABLE_DAYS) break;
    try {
      const timetable = await getPublishedTimetableById(timetableId, env);
      const counted = countNewlySuppressed(
        timetable,
        pause,
        MAX_IMPACT_TIMETABLE_DAYS - evaluatedDayCount,
      );
      newlySuppressedLectureCount += counted.total;
      evaluatedTimetableCount += 1;
      evaluatedDayCount += counted.days;
      complete = complete && counted.complete;
    } catch {
      readFailed = true;
      break;
    }
  }
  const scopeComplete =
    totalCount !== null && totalCount === timetableIds.length;
  complete =
    complete &&
    scopeComplete &&
    evaluatedTimetableCount === timetableIds.length;
  return {
    impact: {
      affectedTimetableCount: totalCount ?? timetableIds.length,
      affectedTimetableCountKnown: totalCount !== null,
      newlySuppressedLectureCount,
      previewStatus: complete
        ? "exact"
        : evaluatedTimetableCount > 0
          ? "partial"
          : "unknown",
      ...(complete
        ? {}
        : {
            previewReason: readFailed
              ? ("read_failed" as const)
              : !scopeComplete
                ? ("scope_incomplete" as const)
                : ("bounds" as const),
          }),
      evaluatedTimetableCount,
      evaluatedDayCount,
    },
    timetableIds,
  };
}

export function scopedInput(
  timetableId: string,
  body: unknown,
): AcademicPauseInput {
  const parsed = scopedPauseSchema.parse(body);
  return {
    ...parsed,
    timetableId,
    institutionId: null,
    programmeId: null,
    cohortId: null,
    stableSessionKey:
      parsed.scopeType === "session" ? (parsed.stableSessionKey ?? null) : null,
  };
}

export function broadInput(body: unknown): AcademicPauseInput {
  return pauseSchema.parse(body);
}

export function inputFromStoredPause(
  pause: Awaited<ReturnType<typeof deactivateAcademicPause>>,
): AcademicPauseInput {
  return {
    scopeType: pause.scopeType,
    institutionId: pause.institutionId,
    programmeId: pause.programmeId,
    cohortId: pause.cohortId,
    timetableId: pause.timetableId,
    stableSessionKey: pause.stableSessionKey,
    startsOn: pause.startsOn,
    endsOn: pause.endsOn,
    allDay: pause.allDay,
    startsAt: pause.startsAt,
    endsAt: pause.endsAt,
    reason: pause.reason,
    label: pause.label,
    provenance: pause.provenance,
  };
}

export async function createPauseWithImpact(
  actor: StaffAuthContext,
  pauseInput: AcademicPauseInput,
  env?: NodeJS.ProcessEnv,
) {
  const { impact, timetableIds } = await previewImpact(pauseInput, env);
  const pause = await createAcademicPause({ actor, pause: pauseInput }, env);
  return { pause, impact, timetableIds };
}

export async function deactivatePauseWithTimetables(
  input: Parameters<typeof deactivateAcademicPause>[0],
  env?: NodeJS.ProcessEnv,
) {
  const pause = await deactivateAcademicPause(input, env);
  const timetableIds = await listPublishedTimetableIdsForPauseScope(
    inputFromStoredPause(pause),
    env,
  );
  return { pause, timetableIds };
}
