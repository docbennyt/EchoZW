import type { CanonicalPublishedCalendarEvent } from "./publishedCalendarProjection.js";
import {
  buildPersonalTimetableScene,
  type PersonalTimetableScene,
  type PersonalTimetableSceneElement,
} from "./personalTimetableScene.js";

export {
  buildPersonalTimetableScene,
  PERSONAL_TIMETABLE_SCENE_HEIGHT,
  PERSONAL_TIMETABLE_SCENE_VERSION,
  PERSONAL_TIMETABLE_SCENE_WIDTH,
  wrapPersonalTimetableText,
} from "./personalTimetableScene.js";
export type {
  PersonalTimetableScene,
  PersonalTimetableSceneBounds,
  PersonalTimetableSceneDay,
  PersonalTimetableSceneElement,
  PersonalTimetableSceneRect,
  PersonalTimetableSceneSession,
  PersonalTimetableSceneText,
} from "./personalTimetableScene.js";

export const PERSONAL_TIMETABLE_WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export type PersonalSessionKind = "class" | "lab" | "free" | "break";

export type PersonalTimetableSession = {
  stableSessionKey: string;
  weekday: number;
  startTime: string;
  endTime: string;
  courseCode: string;
  courseName: string;
  venue: string;
  sessionType: string | null;
  kind: PersonalSessionKind;
  toneIndex: number;
};

export type PersonalTimetableDay = {
  weekday: number;
  label: string;
  sessions: PersonalTimetableSession[];
};

export type PersonalTimetableModel = {
  institution: string;
  programme: string;
  classGroup: string;
  academicPeriod: string;
  versionNumber: number;
  publishedAt: string;
  days: PersonalTimetableDay[];
  sourceSessionCount: number;
};

const TONE_COUNT = 7;

export function personalTimetableToneIndex(courseCode: string) {
  let hash = 0;
  for (const character of courseCode.trim().toUpperCase()) {
    hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  }
  return hash % TONE_COUNT;
}

export function classifyPersonalSession(
  sessionType: string | null,
): PersonalSessionKind {
  const value = sessionType?.trim().toLowerCase() ?? "";
  if (/\b(lab|laboratory|practical|studio|workshop)\b/.test(value)) {
    return "lab";
  }
  if (/\b(free|free period)\b/.test(value)) return "free";
  if (/\b(break|lunch|tea|recess)\b/.test(value)) return "break";
  return "class";
}

export function buildPersonalTimetableModel(input: {
  institution: string;
  programme: string;
  classGroup: string;
  academicPeriod: string;
  versionNumber: number;
  publishedAt: string;
  events: CanonicalPublishedCalendarEvent[];
}): PersonalTimetableModel {
  const days = PERSONAL_TIMETABLE_WEEKDAYS.map((label, index) => ({
    weekday: index + 1,
    label,
    sessions: [] as PersonalTimetableSession[],
  }));

  for (const event of input.events) {
    if (
      !Number.isInteger(event.weekday) ||
      event.weekday < 1 ||
      event.weekday > 7
    ) {
      throw new Error(`Invalid personal timetable weekday: ${event.weekday}`);
    }
    if (!event.stableSessionKey.trim()) {
      throw new Error("Personal timetable session is missing stable identity.");
    }
    if (!event.courseCode.trim() || !event.courseName.trim()) {
      throw new Error("Personal timetable session is missing course identity.");
    }

    days[event.weekday - 1].sessions.push({
      stableSessionKey: event.stableSessionKey,
      weekday: event.weekday,
      startTime: event.startTime,
      endTime: event.endTime,
      courseCode: event.courseCode,
      courseName: event.courseName,
      venue: event.venue,
      sessionType: event.sessionType,
      kind: classifyPersonalSession(event.sessionType),
      toneIndex: personalTimetableToneIndex(event.courseCode),
    });
  }

  for (const day of days) {
    day.sessions.sort(
      (left, right) =>
        left.startTime.localeCompare(right.startTime) ||
        left.endTime.localeCompare(right.endTime) ||
        left.stableSessionKey.localeCompare(right.stableSessionKey),
    );
  }

  return {
    institution: input.institution,
    programme: input.programme,
    classGroup: input.classGroup,
    academicPeriod: input.academicPeriod,
    versionNumber: input.versionNumber,
    publishedAt: input.publishedAt,
    days,
    sourceSessionCount: input.events.length,
  };
}

function resolveScene(
  input: PersonalTimetableModel | PersonalTimetableScene,
): PersonalTimetableScene {
  return "sceneVersion" in input ? input : buildPersonalTimetableScene(input);
}

function xmlEscape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function svgElement(element: PersonalTimetableSceneElement) {
  if (element.kind === "rect") {
    const stroke = element.stroke
      ? ` stroke="${element.stroke}" stroke-width="${element.strokeWidth ?? 1}"`
      : "";
    const dash = element.dash?.length
      ? ` stroke-dasharray="${element.dash.join(" ")}"`
      : "";
    const radius = element.radius ? ` rx="${element.radius}"` : "";
    return `<rect id="${xmlEscape(element.id)}" x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" fill="${element.fill}"${radius}${stroke}${dash}/>`;
  }

  return `<text id="${xmlEscape(element.id)}" x="${element.x}" y="${element.y}" font-family="Arial,Helvetica,sans-serif" font-size="${element.fontSize}" font-weight="${element.fontWeight}"${element.fontStyle && element.fontStyle !== "normal" ? ` font-style="${element.fontStyle}"` : ""} fill="${element.fill}">${xmlEscape(element.text)}</text>`;
}

export function buildPersonalTimetableSvg(
  input: PersonalTimetableModel | PersonalTimetableScene,
) {
  const scene = resolveScene(input);
  const body = scene.elements.map(svgElement).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="${scene.viewBox}" role="img" aria-label="CalenderZW timetable for version ${scene.versionNumber}" data-scene-version="${scene.sceneVersion}">${body}</svg>`;
}

function ascii(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/[·•]/g, " | ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E]/g, "?");
}

function pdfEscape(value: string) {
  return ascii(value).replace(/([\\()])/g, "\\$1");
}

function hexRgb(value: string) {
  const clean = value.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(clean)) return [0, 0, 0] as const;
  return [
    Number.parseInt(clean.slice(0, 2), 16) / 255,
    Number.parseInt(clean.slice(2, 4), 16) / 255,
    Number.parseInt(clean.slice(4, 6), 16) / 255,
  ] as const;
}

function pdfColor(value: string, stroke = false) {
  const [red, green, blue] = hexRgb(value);
  return `${red.toFixed(4)} ${green.toFixed(4)} ${blue.toFixed(4)} ${stroke ? "RG" : "rg"}`;
}

function pdfText(
  text: string,
  x: number,
  y: number,
  size: number,
  bold: boolean,
) {
  return `BT /${bold ? "F2" : "F1"} ${size.toFixed(2)} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${pdfEscape(text)}) Tj ET`;
}

function sceneElementToPdf(
  element: PersonalTimetableSceneElement,
  scale: number,
  pageHeight: number,
) {
  if (element.kind === "rect") {
    const x = element.x * scale;
    const y = pageHeight - (element.y + element.height) * scale;
    const width = element.width * scale;
    const height = element.height * scale;
    const commands = ["q", pdfColor(element.fill)];
    if (element.stroke) {
      commands.push(pdfColor(element.stroke, true));
      commands.push(`${((element.strokeWidth ?? 1) * scale).toFixed(2)} w`);
      if (element.dash?.length) {
        commands.push(
          `[${element.dash.map((value) => (value * scale).toFixed(2)).join(" ")}] 0 d`,
        );
      }
    }
    commands.push(
      `${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re ${element.stroke ? "B" : "f"}`,
    );
    commands.push("Q");
    return commands.join("\n");
  }

  const x = element.x * scale;
  const y = pageHeight - element.y * scale;
  return [
    pdfColor(element.fill),
    pdfText(
      element.text,
      x,
      y,
      element.fontSize * scale,
      element.fontWeight >= 700,
    ),
  ].join("\n");
}

export function buildPersonalTimetablePdf(
  input: PersonalTimetableModel | PersonalTimetableScene,
) {
  const scene = resolveScene(input);
  const pageWidth = 842;
  const scale = pageWidth / scene.width;
  const pageHeight = scene.height * scale;
  const stream = scene.elements
    .map((element) => sceneElementToPdf(element, scale, pageHeight))
    .join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth.toFixed(2)} ${pageHeight.toFixed(2)}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(new TextEncoder().encode(pdf).length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = new TextEncoder().encode(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
