import type { PublishedTimetableSummary } from "../api/publicDiscovery.js";

export type AcademicPeriodSelectionReason =
  "none" | "single" | "current" | "ambiguous" | "overlap";

export type AcademicPeriodSelection = {
  selectedPeriodName: string | null;
  reason: AcademicPeriodSelectionReason;
};

type AcademicPeriodWindow = Pick<
  PublishedTimetableSummary,
  "academicPeriodName" | "startsOn" | "endsOn" | "timezone"
>;

export function institutionLocalDate(now: Date, timeZone: string) {
  if (!timeZone.trim() || Number.isNaN(now.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    return year && month && day ? `${year}-${month}-${day}` : null;
  } catch {
    return null;
  }
}

export function isAcademicPeriodCurrent(
  period: AcademicPeriodWindow,
  now: Date,
) {
  if (!period.startsOn || !period.endsOn) return false;
  if (period.endsOn < period.startsOn) return false;
  const localDate = institutionLocalDate(now, period.timezone);
  if (!localDate) return false;
  return period.startsOn <= localDate && localDate <= period.endsOn;
}

export function chooseAcademicPeriod(
  candidates: readonly AcademicPeriodWindow[],
  now: Date = new Date(),
): AcademicPeriodSelection {
  const periodNames = Array.from(
    new Set(
      candidates
        .map((candidate) => candidate.academicPeriodName.trim())
        .filter(Boolean),
    ),
  );

  if (periodNames.length === 0) {
    return { selectedPeriodName: null, reason: "none" };
  }
  if (periodNames.length === 1) {
    return { selectedPeriodName: periodNames[0], reason: "single" };
  }

  const currentPeriodNames = periodNames.filter((name) =>
    candidates.some(
      (candidate) =>
        candidate.academicPeriodName.trim() === name &&
        isAcademicPeriodCurrent(candidate, now),
    ),
  );

  if (currentPeriodNames.length === 1) {
    return { selectedPeriodName: currentPeriodNames[0], reason: "current" };
  }
  if (currentPeriodNames.length > 1) {
    return { selectedPeriodName: null, reason: "overlap" };
  }
  return { selectedPeriodName: null, reason: "ambiguous" };
}
