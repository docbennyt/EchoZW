import ExcelJS from "exceljs";
import { z } from "zod";
import {
  CZW_IMPORT_FORMAT_VERSION,
  parseCzwImportFormatV1,
  type CzwImportFormatV1,
  type CzwImportOperatorContext,
} from "../src/domain/czwImportFormat.js";
import {
  parseStaticTimetableDocument,
  type StaticTimetableParseResult,
} from "../src/domain/staticTimetableDocument.js";
import { readStructuredDocx } from "./docxStructuredReader.js";
import { readPdfText } from "./pdfTextReader.js";

export const STATIC_TIMETABLE_CSV_PARSER_VERSION = "czw-csv-v1";
export const STATIC_TIMETABLE_XLSX_PARSER_VERSION = "czw-xlsx-v1";
export const STATIC_TIMETABLE_PDF_TEXT_PARSER_VERSION = "czw-pdf-text-v1";

export type StaticTimetableSourceKind =
  "docx" | "czw-json" | "czw-xlsx" | "csv" | "generic-xlsx" | "pdf-text";

export type StaticTimetableSourceContext = CzwImportOperatorContext;

export type StaticTimetableExtraction = {
  kind: StaticTimetableSourceKind;
  parserVersion: string;
  canonical: CzwImportFormatV1 | null;
  parsed: StaticTimetableParseResult;
};

export type StaticTimetableInputAdapter = {
  kind: StaticTimetableSourceKind;
  canHandle(input: StaticTimetableInput): boolean;
  extract(input: StaticTimetableInput): Promise<StaticTimetableExtraction>;
};

export type StaticTimetableInput = {
  filename: string;
  mimeType: string;
  bytes: Buffer;
  context?: StaticTimetableSourceContext;
};

const WEEKDAYS = new Map([
  ["monday", 1],
  ["mon", 1],
  ["tuesday", 2],
  ["tue", 2],
  ["tues", 2],
  ["wednesday", 3],
  ["wed", 3],
  ["thursday", 4],
  ["thu", 4],
  ["thur", 4],
  ["thurs", 4],
  ["friday", 5],
  ["fri", 5],
  ["saturday", 6],
  ["sat", 6],
  ["sunday", 7],
  ["sun", 7],
]);

const xlsxMimeTypes = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
  "application/zip",
  "application/x-zip-compressed",
]);

const docxMimeTypes = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/octet-stream",
  "application/zip",
  "application/x-zip-compressed",
]);

const csvMimeTypes = new Set([
  "text/csv",
  "text/plain",
  "application/csv",
  "application/vnd.ms-excel",
  "application/octet-stream",
]);

function compact(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function headerKey(value: unknown) {
  return compact(value)
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function mime(input: StaticTimetableInput) {
  return input.mimeType.split(";")[0]?.trim().toLocaleLowerCase("en") || "";
}

function hasZipSignature(bytes: Buffer) {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function looksLikeJson(bytes: Buffer) {
  return bytes.subarray(0, 64).toString("utf8").trimStart().startsWith("{");
}

function looksLikeText(bytes: Buffer) {
  const sample = bytes.subarray(0, Math.min(bytes.length, 2048));
  return !sample.includes(0);
}

function filenameExt(filename: string) {
  return filename.toLocaleLowerCase("en").split(".").pop() ?? "";
}

function parseWeekday(value: unknown) {
  if (typeof value === "number" && value >= 1 && value <= 7) return value;
  const raw = compact(value).toLocaleLowerCase("en");
  const number = Number(raw);
  if (Number.isInteger(number) && number >= 1 && number <= 7) return number;
  return WEEKDAYS.get(raw) ?? null;
}

function parseTime(value: unknown) {
  const raw = compact(value);
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  const padded = digits.length === 3 ? `0${digits}` : digits;
  if (padded.length !== 4) return raw.match(/^\d{2}:\d{2}$/) ? raw : null;
  const hours = Number(padded.slice(0, 2));
  const minutes = Number(padded.slice(2));
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function csvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted && char === '"' && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function mapRows(rows: unknown[][]) {
  const header = (rows[0] ?? []).map(headerKey);
  return rows
    .slice(1)
    .map((row) =>
      Object.fromEntries(
        header
          .map((key, index) => [key, compact(row[index])])
          .filter(([key]) => key),
      ),
    );
}

function readAlias(
  row: Record<string, string>,
  aliases: string[],
): string | null {
  for (const alias of aliases) {
    const value = row[alias];
    if (value) return value;
  }
  return null;
}

function targetKeyFrom(input: {
  targetKey?: string | null;
  part?: string | null;
  semester?: string | null;
  title?: string | null;
}) {
  if (input.targetKey) return headerKey(input.targetKey) || "document-default";
  const part = compact(input.part).match(/\d+/)?.[0] ?? null;
  const semester = compact(input.semester).match(/\d+/)?.[0] ?? null;
  if (part && semester) return `part-${part}-semester-${semester}`;
  if (input.title) return headerKey(input.title) || "document-default";
  return "document-default";
}

function targetTitleFrom(input: {
  targetKey: string;
  part?: string | null;
  semester?: string | null;
  title?: string | null;
}) {
  if (input.title) return input.title;
  const match = input.targetKey.match(/^part_(\d+)_semester_(\d+)$/);
  if (match) return `Part ${Number(match[1])} Semester ${Number(match[2])}`;
  const hyphenMatch = input.targetKey.match(/^part-(\d+)-semester-(\d+)$/);
  if (hyphenMatch)
    return `Part ${Number(hyphenMatch[1])} Semester ${Number(hyphenMatch[2])}`;
  if (input.part || input.semester) {
    return [
      input.part ? `Part ${input.part}` : null,
      input.semester ? `Semester ${input.semester}` : null,
    ]
      .filter(Boolean)
      .join(" ");
  }
  return "Document timetable";
}

function czwFromFlatRows(input: {
  rows: Record<string, string>[];
  context?: StaticTimetableSourceContext;
  title?: string | null;
}): CzwImportFormatV1 {
  const targets = new Map<string, CzwImportFormatV1["targets"][number]>();
  const courses = new Map<string, CzwImportFormatV1["courses"][number]>();
  const sessions: CzwImportFormatV1["sessions"] = [];
  const issues: CzwImportFormatV1["issues"] = [];

  for (const [index, row] of input.rows.entries()) {
    const code = readAlias(row, ["course_code", "code", "module_code"]);
    const weekday = parseWeekday(readAlias(row, ["weekday", "day"]));
    const startTime = parseTime(
      readAlias(row, ["start_time", "start", "from"]),
    );
    const endTime = parseTime(readAlias(row, ["end_time", "end", "to"]));
    const part = readAlias(row, ["part", "year_level", "level"]);
    const semester = readAlias(row, ["semester", "semester_number", "period"]);
    const explicitTarget = readAlias(row, [
      "target_key",
      "target",
      "class",
      "scope",
    ]);
    const targetKey = targetKeyFrom({
      targetKey: explicitTarget,
      part,
      semester,
      title: explicitTarget,
    });
    const title = targetTitleFrom({
      targetKey,
      part,
      semester,
      title: explicitTarget,
    });
    if (!targets.has(targetKey)) {
      targets.set(targetKey, {
        targetKey,
        title,
        academicUnitName:
          readAlias(row, ["programme", "department", "academic_unit"]) ??
          input.context?.programmeName ??
          null,
        yearLevel: part
          ? Number(compact(part).match(/\d+/)?.[0] ?? NaN) || null
          : null,
        semesterNumber: semester
          ? Number(compact(semester).match(/\d+/)?.[0] ?? NaN) || null
          : (input.context?.semesterNumber ?? null),
        academicYear:
          readAlias(row, ["academic_year", "year"]) ??
          input.context?.academicYear ??
          null,
      });
    }
    if (!code || !weekday || !startTime || !endTime) {
      issues.push({
        code: "MALFORMED_SESSION_CELL",
        severity: "error",
        message: `Row ${index + 2} is missing course code, weekday, start time, or end time.`,
        candidateKey: null,
        fieldName: "row",
      });
      continue;
    }
    const courseName = readAlias(row, [
      "course_name",
      "name",
      "title",
      "module_name",
    ]);
    const lecturer = readAlias(row, ["lecturer", "instructor"]);
    if (courseName && !courses.has(code)) {
      courses.set(code, {
        courseCode: code,
        courseName,
        targetKey,
        hoursPerWeek: null,
        lecturer,
        sourceText: Object.values(row).filter(Boolean).join(" | "),
      });
    }
    sessions.push({
      targetKey,
      courseCode: code,
      courseName,
      weekday,
      weekdayLabel: readAlias(row, ["weekday", "day"]),
      startTime,
      endTime,
      venue: readAlias(row, ["venue", "room", "location"]),
      lecturer,
      deliveryMode: readAlias(row, ["delivery_mode", "mode"]),
      sourceText: Object.values(row).filter(Boolean).join(" | "),
    });
  }

  if (targets.size === 0) {
    targets.set("document-default", {
      targetKey: "document-default",
      title: input.context?.scopeLabel ?? "Document timetable",
      academicUnitName: input.context?.programmeName ?? null,
      yearLevel: null,
      semesterNumber: input.context?.semesterNumber ?? null,
      academicYear: input.context?.academicYear ?? null,
    });
  }

  return {
    version: CZW_IMPORT_FORMAT_VERSION,
    source: {
      title: input.title ?? null,
      institutionName: null,
      academicUnitName: input.context?.programmeName ?? null,
      academicYear: input.context?.academicYear ?? null,
      semesterNumber: input.context?.semesterNumber ?? null,
    },
    targets: [...targets.values()],
    courses: [...courses.values()],
    sessions,
    issues,
  };
}

function parseCsv(text: string, context?: StaticTimetableSourceContext) {
  const rows = mapRows(csvRows(text));
  return czwFromFlatRows({ rows, context });
}

function worksheetRows(worksheet: ExcelJS.Worksheet) {
  const rows: unknown[][] = [];
  worksheet.eachRow((row) => {
    const values = Array.isArray(row.values) ? row.values : [];
    rows.push(
      values
        .slice(1)
        .map((value) =>
          value && typeof value === "object" && "text" in value
            ? String(value.text)
            : value,
        ),
    );
  });
  return rows;
}

function rowsBySheet(workbook: ExcelJS.Workbook) {
  return Object.fromEntries(
    workbook.worksheets.map((sheet) => [
      headerKey(sheet.name),
      mapRows(worksheetRows(sheet)),
    ]),
  );
}

function optionalNumber(value: string | null) {
  if (!value) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function parseWorkbook(
  bytes: Buffer,
  context?: StaticTimetableSourceContext,
) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  const sheets = rowsBySheet(workbook);
  const source = sheets.source?.[0] ?? {};
  const version = readAlias(source, ["version", "format_version"]);
  if (version === CZW_IMPORT_FORMAT_VERSION) {
    const targets = (sheets.targets ?? []).map((row) => ({
      targetKey: readAlias(row, ["target_key"]) ?? "document-default",
      title: readAlias(row, ["title", "target_title"]) ?? "Document timetable",
      academicUnitName: readAlias(row, [
        "academic_unit",
        "programme",
        "department",
      ]),
      yearLevel: optionalNumber(readAlias(row, ["year_level", "part"])),
      semesterNumber: optionalNumber(
        readAlias(row, ["semester_number", "semester"]),
      ),
      academicYear: readAlias(row, ["academic_year"]),
    }));
    const courses = (sheets.courses ?? []).flatMap((row) => {
      const courseCode = readAlias(row, ["course_code"]);
      const courseName = readAlias(row, ["course_name"]);
      if (!courseCode || !courseName) return [];
      return [
        {
          courseCode,
          courseName,
          targetKey: readAlias(row, ["target_key"]),
          hoursPerWeek: optionalNumber(
            readAlias(row, ["hours_per_week", "hours"]),
          ),
          lecturer: readAlias(row, ["lecturer"]),
          sourceText: Object.values(row).filter(Boolean).join(" | "),
        },
      ];
    });
    const sessions = (sheets.sessions ?? []).flatMap((row) => {
      const courseCode = readAlias(row, ["course_code"]);
      const weekday = parseWeekday(readAlias(row, ["weekday", "day"]));
      const startTime = parseTime(readAlias(row, ["start_time", "start"]));
      const endTime = parseTime(readAlias(row, ["end_time", "end"]));
      if (!courseCode || !weekday || !startTime || !endTime) return [];
      return [
        {
          targetKey: readAlias(row, ["target_key"]),
          courseCode,
          courseName: readAlias(row, ["course_name"]),
          weekday,
          weekdayLabel: readAlias(row, ["weekday", "day"]),
          startTime,
          endTime,
          venue: readAlias(row, ["venue"]),
          lecturer: readAlias(row, ["lecturer"]),
          deliveryMode: readAlias(row, ["delivery_mode"]),
          sourceText: Object.values(row).filter(Boolean).join(" | "),
        },
      ];
    });
    return z
      .object({
        version: z.literal(CZW_IMPORT_FORMAT_VERSION),
        source: z.unknown(),
        targets: z.unknown(),
        courses: z.unknown(),
        sessions: z.unknown(),
        issues: z.unknown(),
      })
      .passthrough()
      .parse({
        version: CZW_IMPORT_FORMAT_VERSION,
        source: {
          title: readAlias(source, ["title"]),
          institutionName: readAlias(source, ["institution"]),
          academicUnitName:
            readAlias(source, ["academic_unit", "programme", "department"]) ??
            context?.programmeName ??
            null,
          academicYear:
            readAlias(source, ["academic_year"]) ??
            context?.academicYear ??
            null,
          semesterNumber:
            optionalNumber(
              readAlias(source, ["semester_number", "semester"]),
            ) ??
            context?.semesterNumber ??
            null,
        },
        targets,
        courses,
        sessions,
        issues: [],
      }) as CzwImportFormatV1;
  }

  const firstSheet = workbook.worksheets[0];
  if (!firstSheet) throw new Error("XLSX_WORKBOOK_EMPTY");
  return czwFromFlatRows({
    rows: mapRows(worksheetRows(firstSheet)),
    context,
    title: firstSheet.name,
  });
}

async function workbookBuffer() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CalenderZW";
  workbook.created = new Date("2026-01-01T00:00:00Z");
  const source = workbook.addWorksheet("Source");
  source.addRows([
    [
      "version",
      "title",
      "institution",
      "academic_unit",
      "academic_year",
      "semester_number",
    ],
    [CZW_IMPORT_FORMAT_VERSION, "Example timetable", "", "", "2026-2027", 1],
  ]);
  const targets = workbook.addWorksheet("Targets");
  targets.addRows([
    [
      "target_key",
      "title",
      "academic_unit",
      "year_level",
      "semester_number",
      "academic_year",
    ],
    ["part-1-semester-1", "Part 1 Semester 1", "", 1, 1, "2026-2027"],
  ]);
  const courses = workbook.addWorksheet("Courses");
  courses.addRows([
    ["target_key", "course_code", "course_name", "hours_per_week", "lecturer"],
    ["part-1-semester-1", "HIT 1101", "Technopreneurship I", 2, ""],
  ]);
  const sessions = workbook.addWorksheet("Sessions");
  sessions.addRows([
    [
      "target_key",
      "course_code",
      "course_name",
      "weekday",
      "start_time",
      "end_time",
      "venue",
      "lecturer",
      "delivery_mode",
    ],
    [
      "part-1-semester-1",
      "HIT 1101",
      "Technopreneurship I",
      "Monday",
      "08:00",
      "10:00",
      "Room 1",
      "",
      "",
    ],
  ]);
  for (const sheet of workbook.worksheets) {
    sheet.getRow(1).font = { bold: true };
    sheet.columns.forEach((column) => {
      column.width = 22;
    });
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

const docxAdapter: StaticTimetableInputAdapter = {
  kind: "docx",
  canHandle: (input) =>
    hasZipSignature(input.bytes) &&
    (filenameExt(input.filename) === "docx" || docxMimeTypes.has(mime(input))),
  async extract(input) {
    const parsed = parseStaticTimetableDocument(
      readStructuredDocx(input.bytes),
    );
    return {
      kind: "docx",
      parserVersion: parsed.parserVersion,
      canonical: null,
      parsed,
    };
  },
};

const jsonAdapter: StaticTimetableInputAdapter = {
  kind: "czw-json",
  canHandle: (input) => looksLikeJson(input.bytes),
  async extract(input) {
    const canonical = JSON.parse(
      input.bytes.toString("utf8"),
    ) as CzwImportFormatV1;
    const parsed = parseCzwImportFormatV1(canonical, {
      operatorContext: input.context,
    });
    return {
      kind: "czw-json",
      parserVersion: parsed.parserVersion,
      canonical,
      parsed,
    };
  },
};

const csvAdapter: StaticTimetableInputAdapter = {
  kind: "csv",
  canHandle: (input) =>
    looksLikeText(input.bytes) &&
    (filenameExt(input.filename) === "csv" || csvMimeTypes.has(mime(input))),
  async extract(input) {
    const canonical = parseCsv(input.bytes.toString("utf8"), input.context);
    const parsed = parseCzwImportFormatV1(canonical, {
      parserVersion: STATIC_TIMETABLE_CSV_PARSER_VERSION,
      operatorContext: input.context,
    });
    return {
      kind: "csv",
      parserVersion: parsed.parserVersion,
      canonical,
      parsed,
    };
  },
};

const xlsxAdapter: StaticTimetableInputAdapter = {
  kind: "czw-xlsx",
  canHandle: (input) =>
    hasZipSignature(input.bytes) &&
    (filenameExt(input.filename) === "xlsx" || xlsxMimeTypes.has(mime(input))),
  async extract(input) {
    const canonical = await parseWorkbook(input.bytes, input.context);
    const parsed = parseCzwImportFormatV1(canonical, {
      parserVersion:
        canonical.version === CZW_IMPORT_FORMAT_VERSION
          ? STATIC_TIMETABLE_XLSX_PARSER_VERSION
          : "czw-generic-xlsx-v1",
      operatorContext: input.context,
    });
    return {
      kind:
        canonical.version === CZW_IMPORT_FORMAT_VERSION
          ? "czw-xlsx"
          : "generic-xlsx",
      parserVersion: parsed.parserVersion,
      canonical,
      parsed,
    };
  },
};

const pdfAdapter: StaticTimetableInputAdapter = {
  kind: "pdf-text",
  canHandle: (input) =>
    input.bytes.subarray(0, 4).toString("latin1") === "%PDF" ||
    mime(input) === "application/pdf",
  async extract(input) {
    const pdf = await readPdfText(input.bytes);
    const rows = csvRows(pdf.text).length > 1 ? csvRows(pdf.text) : [];
    if (rows.length < 2) {
      throw new Error("PDF_TEXT_TIMETABLE_UNSUPPORTED");
    }
    const canonical = czwFromFlatRows({
      rows: mapRows(rows),
      context: input.context,
      title: input.filename,
    });
    const parsed = parseCzwImportFormatV1(canonical, {
      parserVersion: STATIC_TIMETABLE_PDF_TEXT_PARSER_VERSION,
      operatorContext: input.context,
    });
    return {
      kind: "pdf-text",
      parserVersion: parsed.parserVersion,
      canonical,
      parsed,
    };
  },
};

export const staticTimetableInputAdapters = [
  jsonAdapter,
  docxAdapter,
  xlsxAdapter,
  csvAdapter,
  pdfAdapter,
] satisfies StaticTimetableInputAdapter[];

export async function extractStaticTimetableSource(
  input: StaticTimetableInput,
) {
  const adapter = staticTimetableInputAdapters.find((candidate) =>
    candidate.canHandle(input),
  );
  if (!adapter) throw new Error("STATIC_IMPORT_UNSUPPORTED_SOURCE");
  return adapter.extract(input);
}

export async function buildCzwImportTemplateXlsx() {
  return workbookBuffer();
}
