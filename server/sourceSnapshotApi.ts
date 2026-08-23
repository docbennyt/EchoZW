import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import {
  type GoogleDocsSourceSnapshot,
  SOURCE_REQUEST_WINDOW_MS,
  SOURCE_SNAPSHOT_BODY_LIMIT_BYTES,
  computeCanonicalSourceContentHash,
  computeSourceRelaySignature,
  countSnapshotTables,
  countSnapshotTextLength,
  googleDocsSourceSnapshotSchema,
  isSourceTimestampWithinWindow,
  timingSafeEqualBase64Url,
} from "../src/domain/sourceSnapshots.js";
import { getRelaySecretForSourceKey } from "./sourceSnapshotConfig.js";
import {
  acceptRelaySourceSnapshot,
  getRelaySourceByKey,
  markRelaySourceError,
  type RelaySourceRecord,
  type SourceSnapshotRepositoryError,
} from "./sourceSnapshotRepository.js";

type SourceSnapshotDependencies = {
  acceptSnapshot?: typeof acceptRelaySourceSnapshot;
  getNowMs?: () => number;
  getRelaySecret?: typeof getRelaySecretForSourceKey;
  loadSourceByKey?: typeof getRelaySourceByKey;
  markSourceError?: typeof markRelaySourceError;
};

class SourceSnapshotApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function sendSourceSnapshotError(res: ServerResponse, error: unknown) {
  if (error instanceof SourceSnapshotApiError) {
    sendJson(res, error.status, {
      error: {
        code: error.code,
        message: error.message,
      },
    });
    return;
  }

  const repositoryError = error as SourceSnapshotRepositoryError | undefined;
  if (
    repositoryError &&
    typeof repositoryError.code === "string" &&
    typeof repositoryError.status === "number"
  ) {
    sendJson(res, repositoryError.status, {
      error: {
        code: repositoryError.code,
        message: repositoryError.message,
      },
    });
    return;
  }

  sendJson(res, 500, {
    error: {
      code: "INTERNAL_ERROR",
      message: "We could not complete that request. Please try again.",
    },
  });
}

function headerValue(req: IncomingMessage, name: string) {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

async function readRawBody(
  req: IncomingMessage,
  limitBytes = SOURCE_SNAPSHOT_BODY_LIMIT_BYTES,
) {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > limitBytes) {
      throw new SourceSnapshotApiError(
        "SOURCE_SNAPSHOT_TOO_LARGE",
        413,
        "The source snapshot payload is too large.",
      );
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function parseTimestampHeader(timestampHeader: string, nowMs: number) {
  if (!/^\d+$/.test(timestampHeader.trim())) {
    throw new SourceSnapshotApiError(
      "SOURCE_AUTH_INVALID",
      401,
      "Source authentication failed.",
    );
  }

  const timestampMs = Number(timestampHeader);
  if (!Number.isFinite(timestampMs)) {
    throw new SourceSnapshotApiError(
      "SOURCE_AUTH_INVALID",
      401,
      "Source authentication failed.",
    );
  }

  if (
    !isSourceTimestampWithinWindow(timestampMs, nowMs, SOURCE_REQUEST_WINDOW_MS)
  ) {
    throw new SourceSnapshotApiError(
      "SOURCE_REQUEST_EXPIRED",
      401,
      "The source request is outside the allowed time window.",
    );
  }

  return timestampMs;
}

function parsePayload(rawBody: string) {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    throw new SourceSnapshotApiError(
      "SOURCE_PAYLOAD_INVALID",
      422,
      "The source snapshot payload is invalid.",
    );
  }

  const parsed = googleDocsSourceSnapshotSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new SourceSnapshotApiError(
      "SOURCE_PAYLOAD_INVALID",
      422,
      "The source snapshot payload is invalid.",
    );
  }

  return parsed.data;
}

function validateSourceBinding(input: {
  headerSourceKey: string;
  payload: GoogleDocsSourceSnapshot;
  source: RelaySourceRecord;
}) {
  if (input.payload.sourceId !== input.headerSourceKey) {
    throw new SourceSnapshotApiError(
      "SOURCE_PAYLOAD_INVALID",
      422,
      "The source snapshot payload is invalid.",
    );
  }

  if (input.payload.sourceId !== input.source.sourceKey) {
    throw new SourceSnapshotApiError(
      "SOURCE_PAYLOAD_INVALID",
      422,
      "The source snapshot payload is invalid.",
    );
  }

  if (input.payload.provider !== input.source.provider) {
    throw new SourceSnapshotApiError(
      "SOURCE_PAYLOAD_INVALID",
      422,
      "The source snapshot payload is invalid.",
    );
  }

  if (input.payload.fileId !== input.source.externalFileId) {
    throw new SourceSnapshotApiError(
      "SOURCE_PAYLOAD_INVALID",
      422,
      "The source snapshot payload is invalid.",
    );
  }
}

function validateContentHash(input: {
  headerHash: string;
  payload: GoogleDocsSourceSnapshot;
}) {
  const expectedHash = computeCanonicalSourceContentHash(input.payload);

  if (!timingSafeEqualBase64Url(expectedHash, input.headerHash)) {
    throw new SourceSnapshotApiError(
      "SOURCE_HASH_MISMATCH",
      422,
      "The source content hash did not match the payload.",
    );
  }

  if (!timingSafeEqualBase64Url(expectedHash, input.payload.contentHash)) {
    throw new SourceSnapshotApiError(
      "SOURCE_HASH_MISMATCH",
      422,
      "The source content hash did not match the payload.",
    );
  }

  return expectedHash;
}

function logSourceSnapshotEvent(input: {
  code?: string;
  contentHash?: string;
  durationMs: number;
  requestId: string;
  snapshotId?: string;
  sourceKey?: string;
  status: "accepted" | "unchanged" | "rejected";
}) {
  const hashPrefix = input.contentHash?.slice(0, 12);
  const logger = input.status === "rejected" ? console.warn : console.info;
  logger("source snapshot", {
    code: input.code ?? null,
    contentHashPrefix: hashPrefix ?? null,
    durationMs: input.durationMs,
    requestId: input.requestId,
    snapshotId: input.snapshotId ?? null,
    sourceKey: input.sourceKey ?? null,
    status: input.status,
  });
}

function logSourceRelayAuthFailure(input: {
  bodyBytes?: number;
  rawBody?: string;
  reason: "relay_secret_missing" | "signature_mismatch";
  sourceKey: string;
}) {
  console.warn("source relay auth failed", {
    bodyBytes: input.bodyBytes ?? null,
    bodyHashPrefix: input.rawBody
      ? createHash("sha256")
          .update(input.rawBody, "utf8")
          .digest("hex")
          .slice(0, 12)
      : null,
    reason: input.reason,
    secretConfigured: input.reason === "signature_mismatch",
    sourceKey: input.sourceKey,
  });
}

export async function handleSourceSnapshotRequest(
  req: IncomingMessage,
  res: ServerResponse,
  env: NodeJS.ProcessEnv = process.env,
  deps: SourceSnapshotDependencies = {},
) {
  const requestUrl = new URL(req.url ?? "/", "http://localhost");
  if (
    req.method !== "POST" ||
    requestUrl.pathname !== "/api/internal/source-snapshots"
  ) {
    return false;
  }

  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const nowMs = deps.getNowMs?.() ?? Date.now();
  const loadSourceByKey = deps.loadSourceByKey ?? getRelaySourceByKey;
  const getRelaySecret = deps.getRelaySecret ?? getRelaySecretForSourceKey;
  const acceptSnapshot = deps.acceptSnapshot ?? acceptRelaySourceSnapshot;
  const recordSourceError = deps.markSourceError ?? markRelaySourceError;

  let resolvedSource: RelaySourceRecord | null = null;
  let observedAt: string | null = null;

  try {
    const sourceHeader = headerValue(req, "x-czw-source")?.trim();
    const timestampHeader = headerValue(req, "x-czw-timestamp")?.trim();
    const signatureHeader = headerValue(req, "x-czw-signature")?.trim();
    const contentHashHeader = headerValue(req, "x-czw-content-hash")?.trim();

    if (
      !sourceHeader ||
      !timestampHeader ||
      !signatureHeader ||
      !contentHashHeader
    ) {
      throw new SourceSnapshotApiError(
        "SOURCE_AUTH_REQUIRED",
        401,
        "Source authentication headers are required.",
      );
    }

    parseTimestampHeader(timestampHeader, nowMs);

    const rawBody = await readRawBody(req);

    resolvedSource = await loadSourceByKey(sourceHeader, env);
    if (!resolvedSource || !resolvedSource.active) {
      throw new SourceSnapshotApiError(
        "SOURCE_NOT_FOUND",
        404,
        "The requested source is not registered.",
      );
    }

    const relaySecret = getRelaySecret(sourceHeader, env);
    if (!relaySecret) {
      logSourceRelayAuthFailure({
        bodyBytes: Buffer.byteLength(rawBody, "utf8"),
        rawBody,
        reason: "relay_secret_missing",
        sourceKey: resolvedSource.sourceKey,
      });
      throw new SourceSnapshotApiError(
        "SOURCE_AUTH_INVALID",
        401,
        "Source authentication failed.",
      );
    }

    const expectedSignature = computeSourceRelaySignature({
      rawBody,
      secret: relaySecret,
      timestamp: timestampHeader,
    });

    if (!timingSafeEqualBase64Url(expectedSignature, signatureHeader)) {
      logSourceRelayAuthFailure({
        bodyBytes: Buffer.byteLength(rawBody, "utf8"),
        rawBody,
        reason: "signature_mismatch",
        sourceKey: resolvedSource.sourceKey,
      });
      throw new SourceSnapshotApiError(
        "SOURCE_AUTH_INVALID",
        401,
        "Source authentication failed.",
      );
    }

    const payload = parsePayload(rawBody);
    observedAt = payload.observedAt;

    validateSourceBinding({
      headerSourceKey: sourceHeader,
      payload,
      source: resolvedSource,
    });

    const contentHash = validateContentHash({
      headerHash: contentHashHeader,
      payload,
    });

    const result = await acceptSnapshot(
      {
        source: resolvedSource,
        payload: {
          ...payload,
          contentHash,
        },
        contentHash,
        tabCount: payload.tabs.length,
        tableCount: countSnapshotTables(payload.tabs),
        textLength: countSnapshotTextLength(payload.tabs),
      },
      env,
    );

    const durationMs = Date.now() - startedAt;
    logSourceSnapshotEvent({
      contentHash,
      durationMs,
      requestId,
      snapshotId: result.snapshotId,
      sourceKey: resolvedSource.sourceKey,
      status: result.status,
    });

    sendJson(res, 200, {
      status: result.status,
      snapshotId: result.snapshotId,
      contentHash: result.contentHash,
    });
  } catch (error) {
    if (resolvedSource && error instanceof SourceSnapshotApiError) {
      await recordSourceError(
        {
          sourceId: resolvedSource.id,
          errorCode: error.code,
          observedAt,
        },
        env,
      );
    }

    const durationMs = Date.now() - startedAt;
    logSourceSnapshotEvent({
      code:
        error instanceof SourceSnapshotApiError
          ? error.code
          : "SOURCE_DATABASE_UNAVAILABLE",
      durationMs,
      requestId,
      sourceKey: resolvedSource?.sourceKey,
      status: "rejected",
    });
    sendSourceSnapshotError(res, error);
  }

  return true;
}
