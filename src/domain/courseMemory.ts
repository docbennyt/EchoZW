import type {
  AdminCourseMemoryEntry,
  AdminTimetableSession,
} from "../api/pilotTypes.js";

export type CourseSuggestion = AdminCourseMemoryEntry;

export type SessionFormLike = {
  courseCode: string;
  courseName: string;
  weekday: string;
  startTime: string;
  endTime: string;
  venue: string;
  lecturer: string;
  sessionType: string;
  notes: string;
};

function compareStrings(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

function uniqueSorted(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])].sort(compareStrings);
}

export function buildCourseMemoryEntries(
  entries: Array<
    | AdminCourseMemoryEntry
    | Pick<
        AdminTimetableSession,
        "courseCode" | "courseName" | "lecturer" | "venue" | "sessionType"
      >
  >,
) {
  const byCode = new Map<string, CourseSuggestion>();

  for (const entry of entries) {
    const courseCode = entry.courseCode.trim();
    if (!courseCode) continue;
    const current = byCode.get(courseCode) ?? {
      courseCode,
      courseName: entry.courseName.trim(),
      lecturerSuggestions: [],
      venueSuggestions: [],
      sessionTypeSuggestions: [],
    };

    current.courseName = current.courseName || entry.courseName.trim();
    current.lecturerSuggestions = uniqueSorted([
      ...current.lecturerSuggestions,
      "lecturerSuggestions" in entry ? entry.lecturerSuggestions[0] : entry.lecturer,
      ...("lecturerSuggestions" in entry ? entry.lecturerSuggestions : []),
    ]);
    current.venueSuggestions = uniqueSorted([
      ...current.venueSuggestions,
      "venueSuggestions" in entry ? entry.venueSuggestions[0] : entry.venue,
      ...("venueSuggestions" in entry ? entry.venueSuggestions : []),
    ]);
    current.sessionTypeSuggestions = uniqueSorted([
      ...current.sessionTypeSuggestions,
      "sessionTypeSuggestions" in entry
        ? entry.sessionTypeSuggestions[0]
        : entry.sessionType,
      ...("sessionTypeSuggestions" in entry ? entry.sessionTypeSuggestions : []),
    ]);

    byCode.set(courseCode, current);
  }

  return [...byCode.values()].sort((left, right) =>
    compareStrings(left.courseCode, right.courseCode),
  );
}

function includesQuery(value: string, query: string) {
  return value.toLowerCase().includes(query.toLowerCase());
}

export function findCourseSuggestions(
  entries: CourseSuggestion[],
  query: string,
  field: "code" | "name",
  limit = 6,
) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];

  const ranked = entries
    .filter((entry) =>
      field === "code"
        ? includesQuery(entry.courseCode, normalizedQuery) ||
          includesQuery(entry.courseName, normalizedQuery)
        : includesQuery(entry.courseName, normalizedQuery) ||
          includesQuery(entry.courseCode, normalizedQuery),
    )
    .sort((left, right) => {
      const leftPrimary =
        field === "code" ? left.courseCode.toLowerCase() : left.courseName.toLowerCase();
      const rightPrimary =
        field === "code"
          ? right.courseCode.toLowerCase()
          : right.courseName.toLowerCase();
      const leftStarts = leftPrimary.startsWith(normalizedQuery) ? 0 : 1;
      const rightStarts = rightPrimary.startsWith(normalizedQuery) ? 0 : 1;
      if (leftStarts !== rightStarts) return leftStarts - rightStarts;
      return compareStrings(left.courseCode, right.courseCode);
    });

  return ranked.slice(0, limit);
}

export function applyCourseSuggestion(
  form: SessionFormLike,
  suggestion: CourseSuggestion,
): SessionFormLike {
  return {
    ...form,
    courseCode: suggestion.courseCode,
    courseName: suggestion.courseName,
    lecturer: form.lecturer.trim() ? form.lecturer : suggestion.lecturerSuggestions[0] ?? "",
    sessionType: form.sessionType.trim()
      ? form.sessionType
      : suggestion.sessionTypeSuggestions[0] ?? "",
  };
}

export function mergeCourseSuggestion(
  entries: CourseSuggestion[],
  session: Pick<
    AdminTimetableSession,
    "courseCode" | "courseName" | "lecturer" | "venue" | "sessionType"
  >,
) {
  return buildCourseMemoryEntries([...entries, session]);
}
