import type {
  AcademicSchedulePause,
  AcademicPauseScope,
  PublicTimetable,
} from "../api/pilotTypes.js";

export type PauseCandidateOccurrence = {
  start: Date;
  end: Date;
  dateKey: string;
  stableSessionKey: string | null;
};

const scopeSpecificity: Record<AcademicPauseScope, number> = {
  institution: 1,
  programme: 2,
  cohort: 3,
  timetable: 4,
  session: 5,
};

function boundedPauseOverlaps(
  pause: AcademicSchedulePause,
  occurrence: PauseCandidateOccurrence,
) {
  if (!pause.startsAt || !pause.endsAt) return false;
  const pauseStart = new Date(pause.startsAt);
  const pauseEnd = new Date(pause.endsAt);
  if (Number.isNaN(pauseStart.getTime()) || Number.isNaN(pauseEnd.getTime())) {
    return false;
  }
  return occurrence.start < pauseEnd && occurrence.end > pauseStart;
}

export function pauseAppliesToOccurrence(
  pause: AcademicSchedulePause,
  occurrence: PauseCandidateOccurrence,
) {
  if (!pause.active) return false;
  if (
    occurrence.dateKey < pause.startsOn ||
    occurrence.dateKey > pause.endsOn
  ) {
    return false;
  }
  if (
    pause.scopeType === "session" &&
    pause.stableSessionKey !== occurrence.stableSessionKey
  ) {
    return false;
  }
  return pause.allDay ? true : boundedPauseOverlaps(pause, occurrence);
}

/**
 * Suppression is monotonic: overlapping pauses never bring a lecture back. When
 * multiple rules apply, this deterministic order chooses the explanation shown
 * to humans while every matching rule remains auditable in storage.
 */
export function getApplicableAcademicPause(
  pauses: AcademicSchedulePause[] | undefined,
  occurrence: PauseCandidateOccurrence,
) {
  return (pauses ?? [])
    .filter((pause) => pauseAppliesToOccurrence(pause, occurrence))
    .sort((left, right) => {
      const specificity =
        scopeSpecificity[right.scopeType] - scopeSpecificity[left.scopeType];
      if (specificity !== 0) return specificity;
      const created = right.createdAt.localeCompare(left.createdAt);
      if (created !== 0) return created;
      return right.id.localeCompare(left.id);
    })[0];
}

export function withCandidatePause(
  timetable: PublicTimetable,
  pause: AcademicSchedulePause,
): PublicTimetable {
  return {
    ...timetable,
    pauses: [...(timetable.pauses ?? []), pause],
  };
}
