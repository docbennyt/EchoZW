import type { CanonicalPublishedCalendarEvent } from "./publishedCalendarProjection.js";

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

function ascii(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E]/g, "?");
}

function pdfEscape(value: string) {
  return ascii(value).replace(/([\\()])/g, "\\$1");
}

function truncate(value: string, max: number) {
  const clean = ascii(value).replace(/\s+/g, " ").trim();
  return clean.length <= max
    ? clean
    : `${clean.slice(0, Math.max(1, max - 1))}…`;
}

function pdfText(
  text: string,
  x: number,
  y: number,
  size: number,
  bold = false,
) {
  return `BT /${bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(1)} ${y.toFixed(1)} Td (${pdfEscape(text)}) Tj ET`;
}

export function buildPersonalTimetablePdf(model: PersonalTimetableModel) {
  const pageWidth = 842;
  const pageHeight = 595;
  const margin = 30;
  const contentWidth = pageWidth - margin * 2;
  const activeDays = model.days.filter((day) => day.sessions.length > 0);
  const visibleDays =
    activeDays.length > 0 ? activeDays : model.days.slice(0, 5);
  const columnGap = 7;
  const columnWidth =
    (contentWidth - columnGap * (visibleDays.length - 1)) / visibleDays.length;

  const commands: string[] = [
    "0.09 0.24 0.20 rg",
    `0 ${pageHeight - 92} ${pageWidth} 92 re f`,
    "1 1 1 rg",
    pdfText("CalenderZW", margin, pageHeight - 40, 18, true),
    pdfText(
      `${truncate(model.programme, 70)} · ${truncate(model.classGroup, 28)}`,
      margin,
      pageHeight - 64,
      11,
      true,
    ),
    pdfText(
      `${truncate(model.institution, 55)} · ${truncate(model.academicPeriod, 35)} · v${model.versionNumber}`,
      margin,
      pageHeight - 80,
      8,
    ),
    "0.09 0.12 0.11 rg",
  ];

  const top = pageHeight - 120;
  const bottom = 38;
  const maxCards = Math.max(
    1,
    ...visibleDays.map((day) => day.sessions.length),
  );
  const cardGap = 6;
  const availableHeight = top - bottom - 28;
  const cardHeight = Math.max(
    42,
    Math.min(
      76,
      (availableHeight - cardGap * Math.max(0, maxCards - 1)) / maxCards,
    ),
  );

  visibleDays.forEach((day, dayIndex) => {
    const x = margin + dayIndex * (columnWidth + columnGap);
    commands.push("0.93 0.95 0.92 rg");
    commands.push(
      `${x.toFixed(1)} ${(top - 20).toFixed(1)} ${columnWidth.toFixed(1)} 22 re f`,
    );
    commands.push("0.09 0.24 0.20 rg");
    commands.push(pdfText(day.label, x + 7, top - 13, 9, true));

    day.sessions.forEach((session, sessionIndex) => {
      const y = top - 30 - sessionIndex * (cardHeight + cardGap) - cardHeight;
      if (y < bottom - 1) return;
      commands.push(
        session.kind === "break" || session.kind === "free"
          ? "0.96 0.95 0.90 rg"
          : "0.97 0.98 0.96 rg",
      );
      commands.push(
        `${x.toFixed(1)} ${y.toFixed(1)} ${columnWidth.toFixed(1)} ${cardHeight.toFixed(1)} re f`,
      );
      commands.push("0.09 0.24 0.20 rg");
      commands.push(
        pdfText(
          `${session.startTime.slice(0, 5)}-${session.endTime.slice(0, 5)}`,
          x + 7,
          y + cardHeight - 13,
          7,
          true,
        ),
      );
      commands.push(
        pdfText(
          truncate(session.courseName, 25),
          x + 7,
          y + cardHeight - 27,
          8,
          true,
        ),
      );
      commands.push(
        pdfText(
          `${truncate(session.courseCode, 12)}${session.venue ? ` · ${truncate(session.venue, 14)}` : ""}`,
          x + 7,
          y + cardHeight - 39,
          6.7,
        ),
      );
      if (session.sessionType) {
        commands.push(
          pdfText(truncate(session.sessionType, 20), x + 7, y + 7, 6.2),
        );
      }
    });
  });

  commands.push("0.35 0.40 0.37 rg");
  commands.push(
    pdfText(
      `Published schedule · ${model.sourceSessionCount} weekly sessions · Generated from CalenderZW v${model.versionNumber}`,
      margin,
      18,
      6.8,
    ),
  );

  const stream = commands.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`,
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

function xmlEscape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function buildPersonalTimetableSvg(model: PersonalTimetableModel) {
  const width = 1600;
  const height = 1130;
  const margin = 60;
  const activeDays = model.days.filter((day) => day.sessions.length > 0);
  const visibleDays =
    activeDays.length > 0 ? activeDays : model.days.slice(0, 5);
  const gap = 14;
  const columnWidth =
    (width - margin * 2 - gap * (visibleDays.length - 1)) / visibleDays.length;
  const palette = [
    "#dfe9dd",
    "#f7e7b3",
    "#dde7f2",
    "#eadfd8",
    "#e8e0ef",
    "#d9ece8",
    "#f2dfca",
  ];
  const maxCards = Math.max(
    1,
    ...visibleDays.map((day) => day.sessions.length),
  );
  const cardGap = 12;
  const cardsTop = 238;
  const cardsBottom = height - 82;
  const cardHeight = Math.max(
    68,
    Math.min(
      130,
      (cardsBottom - cardsTop - cardGap * Math.max(0, maxCards - 1)) / maxCards,
    ),
  );

  const dayMarkup = visibleDays
    .map((day, dayIndex) => {
      const x = margin + dayIndex * (columnWidth + gap);
      const sessions = day.sessions
        .map((session, sessionIndex) => {
          const y = cardsTop + sessionIndex * (cardHeight + cardGap);
          const fill =
            session.kind === "free" || session.kind === "break"
              ? "#f6f1e4"
              : palette[session.toneIndex];
          const label = session.sessionType
            ? `<text x="${x + 16}" y="${y + cardHeight - 16}" font-size="15" fill="#52605a">${xmlEscape(session.sessionType)}</text>`
            : "";
          return `<g><rect x="${x}" y="${y}" width="${columnWidth}" height="${cardHeight}" rx="14" fill="${fill}" stroke="#cfd8ce"/><text x="${x + 16}" y="${y + 28}" font-size="17" font-weight="700" fill="#153d32">${xmlEscape(session.startTime.slice(0, 5))}–${xmlEscape(session.endTime.slice(0, 5))}</text><text x="${x + 16}" y="${y + 55}" font-size="20" font-weight="700" fill="#18201d">${xmlEscape(truncate(session.courseName, 26))}</text><text x="${x + 16}" y="${y + 79}" font-size="16" fill="#52605a">${xmlEscape(session.courseCode)}${session.venue ? ` · ${xmlEscape(session.venue)}` : ""}</text>${label}</g>`;
        })
        .join("");
      return `<g><rect x="${x}" y="188" width="${columnWidth}" height="38" rx="10" fill="#153d32"/><text x="${x + 14}" y="214" font-size="19" font-weight="700" fill="#fffefa">${xmlEscape(day.label)}</text>${sessions}</g>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#f7f4ec"/><text x="${margin}" y="72" font-family="Arial,sans-serif" font-size="34" font-weight="700" fill="#153d32">CalenderZW</text><text x="${margin}" y="116" font-family="Arial,sans-serif" font-size="30" font-weight="700" fill="#18201d">${xmlEscape(truncate(model.programme, 76))} · ${xmlEscape(truncate(model.classGroup, 32))}</text><text x="${margin}" y="151" font-family="Arial,sans-serif" font-size="19" fill="#65706a">${xmlEscape(truncate(model.institution, 60))} · ${xmlEscape(truncate(model.academicPeriod, 42))} · v${model.versionNumber}</text><g font-family="Arial,sans-serif">${dayMarkup}</g><text x="${margin}" y="1087" font-family="Arial,sans-serif" font-size="16" fill="#65706a">Published schedule · ${model.sourceSessionCount} weekly sessions · Generated from trusted CalenderZW data</text></svg>`;
}
