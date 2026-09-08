export const CLASS_SHARE_SOURCES = [
  "class_share",
  "class_rep",
  "onboarding_success",
] as const;

export type ClassShareSource = (typeof CLASS_SHARE_SOURCES)[number];

const sourceSet = new Set<string>(CLASS_SHARE_SOURCES);

export function sanitizeClassShareSource(
  value: unknown,
): ClassShareSource | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return sourceSet.has(normalized) ? (normalized as ClassShareSource) : null;
}

export function readClassShareSource(url: string): ClassShareSource | null {
  try {
    return sanitizeClassShareSource(new URL(url).searchParams.get("src"));
  } catch {
    return null;
  }
}

export function buildAttributedClassUrl(
  publicUrl: string,
  source: ClassShareSource,
) {
  const url = new URL(publicUrl);
  if (!/^\/t\/[^/]+$/.test(url.pathname)) {
    throw new Error("Class sharing requires a public timetable URL.");
  }
  url.search = "";
  url.hash = "";
  url.searchParams.set("src", source);
  return url.toString();
}

export function buildClassShareMessage(classLabel: string, url: string) {
  const cleanLabel = classLabel.trim() || "Class";
  return `${cleanLabel} timetable is live on CalenderZW — see tomorrow's classes and add it to your calendar: ${url}`;
}

export function buildClassSharePayload(input: {
  classLabel: string;
  publicUrl: string;
  source: ClassShareSource;
}) {
  const url = buildAttributedClassUrl(input.publicUrl, input.source);
  const text = `${input.classLabel.trim() || "Class"} timetable is live on CalenderZW — see tomorrow's classes and add it to your calendar:`;
  return {
    title: `${input.classLabel.trim() || "Class"} timetable`,
    text,
    url,
    message: `${text} ${url}`,
  };
}
