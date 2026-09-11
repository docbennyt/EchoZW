import type {
  PersonalSessionKind,
  PersonalTimetableModel,
} from "./personalTimetableExport.js";

export const PERSONAL_TIMETABLE_SCENE_VERSION = "personal-timetable-scene-v1";
export const PERSONAL_TIMETABLE_SCENE_WIDTH = 1600;
export const PERSONAL_TIMETABLE_SCENE_HEIGHT = 1130;

export type PersonalTimetableSceneBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PersonalTimetableSceneRect = PersonalTimetableSceneBounds & {
  kind: "rect";
  id: string;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
  dash?: number[];
};

export type PersonalTimetableSceneText = {
  kind: "text";
  id: string;
  x: number;
  y: number;
  text: string;
  fontSize: number;
  fontWeight: 400 | 600 | 700 | 800;
  fill: string;
  fontStyle?: "normal" | "italic";
};

export type PersonalTimetableSceneElement =
  PersonalTimetableSceneRect | PersonalTimetableSceneText;

export type PersonalTimetableSceneSession = {
  stableSessionKey: string;
  weekday: number;
  kind: PersonalSessionKind;
  toneIndex: number;
  bounds: PersonalTimetableSceneBounds;
  fill: string;
  timeLabel: string;
  courseCode: string;
  courseName: string;
  courseNameLines: string[];
  venue: string;
  detailLines: string[];
  badgeLabel: string | null;
};

export type PersonalTimetableSceneDay = {
  weekday: number;
  label: string;
  bounds: PersonalTimetableSceneBounds;
  sessions: PersonalTimetableSceneSession[];
  emptyLabel: string | null;
};

export type PersonalTimetableScene = {
  sceneVersion: typeof PERSONAL_TIMETABLE_SCENE_VERSION;
  width: number;
  height: number;
  viewBox: string;
  versionNumber: number;
  sourceSessionCount: number;
  titleLines: string[];
  metadataLines: string[];
  days: PersonalTimetableSceneDay[];
  elements: PersonalTimetableSceneElement[];
};

const PAGE_MARGIN = 60;
const COLUMN_GAP = 14;
const DAY_HEADER_HEIGHT = 40;
const CARD_GAP_DEFAULT = 10;
const CARD_GAP_DENSE = 6;
const FOOTER_Y = PERSONAL_TIMETABLE_SCENE_HEIGHT - 34;

const SESSION_PALETTE = [
  "#dfe9dd",
  "#f7e7b3",
  "#dde7f2",
  "#eadfd8",
  "#e8e0ef",
  "#d9ece8",
  "#f2dfca",
] as const;

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function splitLongWord(word: string, maxChars: number) {
  const chunks: string[] = [];
  for (let index = 0; index < word.length; index += maxChars) {
    chunks.push(word.slice(index, index + maxChars));
  }
  return chunks;
}

export function wrapPersonalTimetableText(value: string, maxChars: number) {
  const clean = normalizeText(value);
  if (!clean) return [];

  const words = clean
    .split(" ")
    .flatMap((word) =>
      word.length > maxChars ? splitLongWord(word, maxChars) : [word],
    );
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines;
}

function fitCourseName(value: string, width: number, height: number) {
  const maxLines = Math.max(2, Math.min(4, Math.floor((height - 44) / 16)));
  for (const fontSize of [20, 19, 18, 17, 16, 15, 14, 13, 12]) {
    const maxChars = Math.max(
      11,
      Math.floor((width - 30) / Math.max(1, fontSize * 0.56)),
    );
    const lines = wrapPersonalTimetableText(value, maxChars);
    if (lines.length <= maxLines) {
      return { fontSize, lineHeight: fontSize + 3, lines };
    }
  }

  const fontSize = 12;
  return {
    fontSize,
    lineHeight: 15,
    lines: wrapPersonalTimetableText(
      value,
      Math.max(11, Math.floor((width - 30) / (fontSize * 0.56))),
    ),
  };
}

function fitDetail(value: string, width: number) {
  const fontSize = 15;
  return {
    fontSize,
    lineHeight: 18,
    lines: wrapPersonalTimetableText(
      value,
      Math.max(12, Math.floor((width - 30) / (fontSize * 0.56))),
    ),
  };
}

function badgeLabelFor(session: {
  sessionType: string | null;
  kind: PersonalSessionKind;
}) {
  const explicit = normalizeText(session.sessionType ?? "");
  if (explicit) return explicit;
  if (session.kind === "lab") return "Lab";
  if (session.kind === "break") return "Break";
  if (session.kind === "free") return "Free";
  return null;
}

function sceneFill(kind: PersonalSessionKind, toneIndex: number) {
  if (kind === "free" || kind === "break") return "#f6f1e4";
  return SESSION_PALETTE[toneIndex % SESSION_PALETTE.length];
}

function addText(
  elements: PersonalTimetableSceneElement[],
  element: Omit<PersonalTimetableSceneText, "kind">,
) {
  elements.push({ kind: "text", ...element });
}

function addRect(
  elements: PersonalTimetableSceneElement[],
  element: Omit<PersonalTimetableSceneRect, "kind">,
) {
  elements.push({ kind: "rect", ...element });
}

function visibleDays(model: PersonalTimetableModel) {
  return model.days.filter(
    (day) => day.weekday <= 5 || day.sessions.length > 0,
  );
}

export function buildPersonalTimetableScene(
  model: PersonalTimetableModel,
): PersonalTimetableScene {
  const elements: PersonalTimetableSceneElement[] = [];
  const days = visibleDays(model);
  const titleLines = wrapPersonalTimetableText(
    `${model.programme} · ${model.classGroup}`,
    68,
  );
  const metadataLines = wrapPersonalTimetableText(
    `${model.institution} · ${model.academicPeriod} · v${model.versionNumber}`,
    104,
  );

  addRect(elements, {
    id: "page-background",
    x: 0,
    y: 0,
    width: PERSONAL_TIMETABLE_SCENE_WIDTH,
    height: PERSONAL_TIMETABLE_SCENE_HEIGHT,
    fill: "#f7f4ec",
  });
  addText(elements, {
    id: "brand",
    x: PAGE_MARGIN,
    y: 72,
    text: "CalenderZW",
    fontSize: 34,
    fontWeight: 800,
    fill: "#153d32",
  });

  let cursorY = 116;
  titleLines.forEach((line, index) => {
    addText(elements, {
      id: `title-${index}`,
      x: PAGE_MARGIN,
      y: cursorY,
      text: line,
      fontSize: 30,
      fontWeight: 700,
      fill: "#18201d",
    });
    cursorY += 34;
  });

  cursorY += 1;
  metadataLines.forEach((line, index) => {
    addText(elements, {
      id: `metadata-${index}`,
      x: PAGE_MARGIN,
      y: cursorY,
      text: line,
      fontSize: 18,
      fontWeight: 400,
      fill: "#65706a",
    });
    cursorY += 23;
  });

  const dayHeaderY = Math.max(188, cursorY + 14);
  const cardsTop = dayHeaderY + DAY_HEADER_HEIGHT + 12;
  const cardsBottom = FOOTER_Y - 34;
  const columnWidth =
    (PERSONAL_TIMETABLE_SCENE_WIDTH -
      PAGE_MARGIN * 2 -
      COLUMN_GAP * Math.max(0, days.length - 1)) /
    Math.max(1, days.length);
  const maxCards = Math.max(1, ...days.map((day) => day.sessions.length));
  const cardGap = maxCards >= 8 ? CARD_GAP_DENSE : CARD_GAP_DEFAULT;
  const rawCardHeight =
    (cardsBottom - cardsTop - cardGap * Math.max(0, maxCards - 1)) / maxCards;
  const cardHeight = Math.max(72, Math.min(132, rawCardHeight));

  const sceneDays: PersonalTimetableSceneDay[] = days.map((day, dayIndex) => {
    const x = PAGE_MARGIN + dayIndex * (columnWidth + COLUMN_GAP);
    addRect(elements, {
      id: `day-${day.weekday}-header-bg`,
      x,
      y: dayHeaderY,
      width: columnWidth,
      height: DAY_HEADER_HEIGHT,
      radius: 10,
      fill: "#153d32",
    });
    addText(elements, {
      id: `day-${day.weekday}-label`,
      x: x + 14,
      y: dayHeaderY + 27,
      text: day.label,
      fontSize: 19,
      fontWeight: 700,
      fill: "#fffefa",
    });

    if (day.sessions.length === 0) {
      const emptyBounds = {
        x,
        y: cardsTop,
        width: columnWidth,
        height: 68,
      };
      addRect(elements, {
        id: `day-${day.weekday}-empty-bg`,
        ...emptyBounds,
        radius: 12,
        fill: "#fbf9f3",
        stroke: "#cfd8ce",
        strokeWidth: 2,
        dash: [8, 6],
      });
      addText(elements, {
        id: `day-${day.weekday}-empty-text`,
        x: x + 14,
        y: cardsTop + 38,
        text: "No published sessions",
        fontSize: 15,
        fontWeight: 600,
        fill: "#65706a",
      });
      return {
        weekday: day.weekday,
        label: day.label,
        bounds: {
          x,
          y: dayHeaderY,
          width: columnWidth,
          height: DAY_HEADER_HEIGHT,
        },
        sessions: [],
        emptyLabel: "No published sessions",
      };
    }

    const sceneSessions = day.sessions.map((session, sessionIndex) => {
      const y = cardsTop + sessionIndex * (cardHeight + cardGap);
      const bounds = { x, y, width: columnWidth, height: cardHeight };
      const fill = sceneFill(session.kind, session.toneIndex);
      const badgeLabel = badgeLabelFor(session);
      const course = fitCourseName(session.courseName, columnWidth, cardHeight);
      const detail = fitDetail(
        `${session.courseCode}${session.venue ? ` · ${session.venue}` : " · Venue not set"}`,
        columnWidth,
      );
      const timeLabel = `${session.startTime.slice(0, 5)}–${session.endTime.slice(0, 5)}`;

      addRect(elements, {
        id: `session-${session.stableSessionKey}-bg`,
        ...bounds,
        radius: 14,
        fill,
        stroke: "#cfd8ce",
        strokeWidth: 1.5,
        dash:
          session.kind === "free" || session.kind === "break"
            ? [8, 5]
            : undefined,
      });
      addText(elements, {
        id: `session-${session.stableSessionKey}-time`,
        x: x + 16,
        y: y + 27,
        text: timeLabel,
        fontSize: 17,
        fontWeight: 800,
        fill: "#153d32",
      });

      if (badgeLabel) {
        const badgeWidth = Math.min(
          Math.max(46, badgeLabel.length * 7.5 + 20),
          Math.max(46, columnWidth * 0.42),
        );
        const badgeX = x + columnWidth - badgeWidth - 12;
        addRect(elements, {
          id: `session-${session.stableSessionKey}-badge-bg`,
          x: badgeX,
          y: y + 10,
          width: badgeWidth,
          height: 25,
          radius: 12.5,
          fill: "#fffefa",
          stroke: "#bfc9bf",
          strokeWidth: 1,
        });
        addText(elements, {
          id: `session-${session.stableSessionKey}-badge-text`,
          x: badgeX + 10,
          y: y + 28,
          text: badgeLabel,
          fontSize: 12,
          fontWeight: 700,
          fill: "#52605a",
        });
      }

      let textY = y + 53;
      course.lines.forEach((line, lineIndex) => {
        addText(elements, {
          id: `session-${session.stableSessionKey}-course-${lineIndex}`,
          x: x + 16,
          y: textY,
          text: line,
          fontSize: course.fontSize,
          fontWeight: 700,
          fill: "#18201d",
        });
        textY += course.lineHeight;
      });

      textY += 4;
      detail.lines.forEach((line, lineIndex) => {
        addText(elements, {
          id: `session-${session.stableSessionKey}-detail-${lineIndex}`,
          x: x + 16,
          y: Math.min(textY, y + cardHeight - 10 + lineIndex * 2),
          text: line,
          fontSize: detail.fontSize,
          fontWeight: 400,
          fill: "#52605a",
        });
        textY += detail.lineHeight;
      });

      return {
        stableSessionKey: session.stableSessionKey,
        weekday: session.weekday,
        kind: session.kind,
        toneIndex: session.toneIndex,
        bounds,
        fill,
        timeLabel,
        courseCode: session.courseCode,
        courseName: session.courseName,
        courseNameLines: course.lines,
        venue: session.venue,
        detailLines: detail.lines,
        badgeLabel,
      } satisfies PersonalTimetableSceneSession;
    });

    return {
      weekday: day.weekday,
      label: day.label,
      bounds: {
        x,
        y: dayHeaderY,
        width: columnWidth,
        height: DAY_HEADER_HEIGHT,
      },
      sessions: sceneSessions,
      emptyLabel: null,
    } satisfies PersonalTimetableSceneDay;
  });

  addText(elements, {
    id: "footer",
    x: PAGE_MARGIN,
    y: FOOTER_Y,
    text: `Published schedule · ${model.sourceSessionCount} weekly sessions · CalenderZW v${model.versionNumber}`,
    fontSize: 16,
    fontWeight: 400,
    fill: "#65706a",
  });

  return {
    sceneVersion: PERSONAL_TIMETABLE_SCENE_VERSION,
    width: PERSONAL_TIMETABLE_SCENE_WIDTH,
    height: PERSONAL_TIMETABLE_SCENE_HEIGHT,
    viewBox: `0 0 ${PERSONAL_TIMETABLE_SCENE_WIDTH} ${PERSONAL_TIMETABLE_SCENE_HEIGHT}`,
    versionNumber: model.versionNumber,
    sourceSessionCount: model.sourceSessionCount,
    titleLines,
    metadataLines,
    days: sceneDays,
    elements,
  };
}
