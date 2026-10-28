export type AcademicEventCategory =
  "lecture" | "lab" | "tutorial" | "revision" | "exam" | "other";

/** Explicit session-type vocabulary. Course titles and notes never grant exemptions. */
export function academicEventCategory(
  sessionType: string | null | undefined,
): AcademicEventCategory {
  const value = sessionType?.trim().toLowerCase();
  if (["exam", "examination", "assessment"].includes(value ?? ""))
    return "exam";
  if (["lab", "laboratory", "practical"].includes(value ?? "")) return "lab";
  if (value === "tutorial") return "tutorial";
  if (["revision", "study"].includes(value ?? "")) return "revision";
  return !value || value === "lecture" ? "lecture" : "other";
}

type Identity = {
  id: string;
  supersedesId?: string | null;
  identityRootId?: string;
};
export function examExceptionRootId(current: Identity, history: Identity[]) {
  if (current.identityRootId) return current.identityRootId;
  const byId = new Map(history.map((item) => [item.id, item]));
  const visited = new Set<string>();
  let row = current;
  while (row.supersedesId) {
    if (visited.has(row.id)) throw new Error("EXAM_IDENTITY_HISTORY_INVALID");
    visited.add(row.id);
    const parent = byId.get(row.supersedesId);
    if (!parent) throw new Error("EXAM_IDENTITY_HISTORY_UNAVAILABLE");
    row = parent;
  }
  return row.id;
}
