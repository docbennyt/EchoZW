import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const GOOGLE_DOCS_APPS_SCRIPT_PROVIDER = "google_docs_apps_script";
export const SOURCE_REQUEST_WINDOW_MS = 5 * 60 * 1000;
export const SOURCE_SNAPSHOT_BODY_LIMIT_BYTES = 2 * 1024 * 1024;

const tableCellSchema = z.string().max(10000);
const tableRowSchema = z.array(tableCellSchema).max(200);
const tableSchema = z.array(tableRowSchema).max(500);

export const googleDocsSourceSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  sourceId: z.string().trim().min(1).max(120),
  provider: z.literal(GOOGLE_DOCS_APPS_SCRIPT_PROVIDER),
  fileId: z.string().trim().min(1).max(255),
  fileName: z.string().trim().min(1).max(512),
  observedAt: z
    .string()
    .trim()
    .refine((value) => !Number.isNaN(Date.parse(value)), {
      message: "observedAt must be a valid ISO timestamp.",
    }),
  contentHash: z.string().trim().min(1).max(128),
  tabs: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(120),
        title: z.string().trim().min(1).max(300),
        text: z.string().max(300000),
        tables: z.array(tableSchema).max(100),
      }),
    )
    .min(1)
    .max(20),
});

export type GoogleDocsSourceSnapshot = z.infer<
  typeof googleDocsSourceSnapshotSchema
>;

type CanonicalHashInput = Pick<
  GoogleDocsSourceSnapshot,
  "schemaVersion" | "fileId" | "tabs"
>;

export function buildCanonicalSourceHashInput(
  snapshot: Pick<GoogleDocsSourceSnapshot, "schemaVersion" | "fileId" | "tabs">,
): CanonicalHashInput {
  return {
    schemaVersion: snapshot.schemaVersion,
    fileId: snapshot.fileId,
    tabs: snapshot.tabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      text: tab.text,
      tables: tab.tables.map((table) =>
        table.map((row) => row.map((cell) => cell)),
      ),
    })),
  };
}

export function stringifyCanonicalSourceHashInput(
  snapshot: Pick<GoogleDocsSourceSnapshot, "schemaVersion" | "fileId" | "tabs">,
) {
  return JSON.stringify(buildCanonicalSourceHashInput(snapshot));
}

export function computeCanonicalSourceContentHash(
  snapshot: Pick<GoogleDocsSourceSnapshot, "schemaVersion" | "fileId" | "tabs">,
) {
  return createHash("sha256")
    .update(stringifyCanonicalSourceHashInput(snapshot))
    .digest("base64url");
}

export function computeSourceRelaySignature(input: {
  rawBody: string;
  secret: string;
  timestamp: string;
}) {
  return createHmac("sha256", input.secret)
    .update(`${input.timestamp}.${input.rawBody}`)
    .digest("base64url");
}

function decodeBase64Url(value: string) {
  const trimmed = value.trim().replace(/=+$/g, "");
  if (!trimmed || !/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    return null;
  }

  const normalized = trimmed.replace(/-/g, "+").replace(/_/g, "/");
  const padding =
    normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));

  try {
    return Buffer.from(normalized + padding, "base64");
  } catch {
    return null;
  }
}

export function timingSafeEqualBase64Url(expected: string, supplied: string) {
  const expectedBytes = decodeBase64Url(expected);
  const suppliedBytes = decodeBase64Url(supplied);

  if (!expectedBytes || !suppliedBytes) return false;
  if (expectedBytes.length !== suppliedBytes.length) return false;

  return timingSafeEqual(expectedBytes, suppliedBytes);
}

export function isSourceTimestampWithinWindow(
  timestampMs: number,
  nowMs = Date.now(),
  windowMs = SOURCE_REQUEST_WINDOW_MS,
) {
  return Math.abs(nowMs - timestampMs) <= windowMs;
}

export function countSnapshotTables(tabs: GoogleDocsSourceSnapshot["tabs"]) {
  return tabs.reduce((total, tab) => total + tab.tables.length, 0);
}

export function countSnapshotTextLength(
  tabs: GoogleDocsSourceSnapshot["tabs"],
) {
  return tabs.reduce((total, tab) => total + tab.text.length, 0);
}
