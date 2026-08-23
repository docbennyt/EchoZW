import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  computeCanonicalSourceContentHash,
  computeSourceRelaySignature,
} from "../src/domain/sourceSnapshots";
import { handleSourceSnapshotRequest } from "../server/sourceSnapshotApi";

function createPayload(overrides: Partial<Record<string, unknown>> = {}) {
  const payload = {
    schemaVersion: 1,
    sourceId: "hit-sist-master-sem1-2026",
    provider: "google_docs_apps_script",
    fileId: "1-a86Lprrc3XoFXMbJM_vVn1rd8lURxFAofGd7zoTP-Q",
    fileName: "SIST_Master_Timetable_Semester1_2026(Final Draft)",
    observedAt: "2026-08-22T08:30:00.000Z",
    contentHash: "placeholder",
    tabs: [
      {
        id: "t.0",
        title: "Tab 1",
        text: "08:00-10:00 CS.1 HIT100 N109",
        tables: [
          [
            ["Time", "Monday"],
            ["08:00-10:00", "CS.1 HIT100 N109"],
          ],
        ],
      },
    ],
    ...overrides,
  };

  payload.contentHash = computeCanonicalSourceContentHash(payload as never);
  return payload;
}

function createRequest(input: {
  body: string;
  headers: Record<string, string>;
}) {
  return Object.assign(Readable.from([input.body]), {
    method: "POST",
    url: "/api/internal/source-snapshots",
    headers: input.headers,
  }) as IncomingMessage;
}

function createResponse() {
  const chunks: string[] = [];
  const res = new EventEmitter() as ServerResponse & {
    headers?: Record<string, string>;
    statusCode?: number;
  };
  res.writeHead = ((statusCode: number, headers: Record<string, string>) => {
    res.statusCode = statusCode;
    res.headers = headers;
    return res;
  }) as ServerResponse["writeHead"];
  res.end = ((chunk?: string) => {
    if (chunk) chunks.push(chunk);
    res.emit("finish");
    return res;
  }) as ServerResponse["end"];
  return {
    res,
    body: () => JSON.parse(chunks.join("")),
  };
}

const sourceRecord = {
  id: "source-1",
  sourceKey: "hit-sist-master-sem1-2026",
  displayName: "HIT SIST Master Timetable - Semester I 2026",
  provider: "google_docs_apps_script",
  externalFileId: "1-a86Lprrc3XoFXMbJM_vVn1rd8lURxFAofGd7zoTP-Q",
  active: true,
  lastObservedAt: null,
  lastSnapshotReceivedAt: null,
  lastSuccessfulSnapshotAt: null,
  lastErrorAt: null,
  lastErrorCode: null,
};

describe("source snapshot API", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts a valid signed snapshot request", async () => {
    const payload = createPayload();
    const body = JSON.stringify(payload);
    const timestamp = "1724315400000";
    const signature = computeSourceRelaySignature({
      rawBody: body,
      secret: "test-secret",
      timestamp,
    });
    const { res, body: responseBody } = createResponse();

    await handleSourceSnapshotRequest(
      createRequest({
        body,
        headers: {
          "x-czw-source": "hit-sist-master-sem1-2026",
          "x-czw-timestamp": timestamp,
          "x-czw-signature": signature,
          "x-czw-content-hash": payload.contentHash,
        },
      }),
      res,
      process.env,
      {
        acceptSnapshot: vi.fn(async () => ({
          status: "accepted" as const,
          snapshotId: "snapshot-1",
          contentHash: payload.contentHash,
        })),
        getNowMs: () => Number(timestamp),
        getRelaySecret: () => "test-secret",
        loadSourceByKey: vi.fn(async () => sourceRecord),
        markSourceError: vi.fn(async () => undefined),
      },
    );

    expect(res.statusCode).toBe(200);
    expect(responseBody()).toEqual({
      status: "accepted",
      snapshotId: "snapshot-1",
      contentHash: payload.contentHash,
    });
  });

  it("rejects missing signature headers", async () => {
    const payload = createPayload();
    const { res, body } = createResponse();

    await handleSourceSnapshotRequest(
      createRequest({
        body: JSON.stringify(payload),
        headers: {
          "x-czw-source": "hit-sist-master-sem1-2026",
        },
      }),
      res,
      process.env,
      {
        markSourceError: vi.fn(async () => undefined),
      },
    );

    expect(res.statusCode).toBe(401);
    expect(body().error.code).toBe("SOURCE_AUTH_REQUIRED");
  });

  it("rejects invalid signatures", async () => {
    const payload = createPayload();
    const timestamp = "1724315400000";
    const { res, body } = createResponse();

    await handleSourceSnapshotRequest(
      createRequest({
        body: JSON.stringify(payload),
        headers: {
          "x-czw-source": "hit-sist-master-sem1-2026",
          "x-czw-timestamp": timestamp,
          "x-czw-signature": "invalid-signature",
          "x-czw-content-hash": payload.contentHash,
        },
      }),
      res,
      process.env,
      {
        getNowMs: () => Number(timestamp),
        getRelaySecret: () => "test-secret",
        loadSourceByKey: vi.fn(async () => sourceRecord),
        markSourceError: vi.fn(async () => undefined),
      },
    );

    expect(res.statusCode).toBe(401);
    expect(body().error.code).toBe("SOURCE_AUTH_INVALID");
  });

  it("rejects requests when the runtime relay secret resolves to empty", async () => {
    const payload = createPayload();
    const timestamp = "1724315400000";
    const { res, body } = createResponse();
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await handleSourceSnapshotRequest(
      createRequest({
        body: JSON.stringify(payload),
        headers: {
          "x-czw-source": "hit-sist-master-sem1-2026",
          "x-czw-timestamp": timestamp,
          "x-czw-signature": "abc",
          "x-czw-content-hash": payload.contentHash,
        },
      }),
      res,
      {
        HIT_TIMETABLE_RELAY_SECRET: "   ",
      } as NodeJS.ProcessEnv,
      {
        getNowMs: () => Number(timestamp),
        loadSourceByKey: vi.fn(async () => sourceRecord),
        markSourceError: vi.fn(async () => undefined),
      },
    );

    expect(res.statusCode).toBe(401);
    expect(body().error.code).toBe("SOURCE_AUTH_INVALID");
    expect(warnSpy).toHaveBeenCalledWith(
      "source relay auth failed",
      expect.objectContaining({
        reason: "relay_secret_missing",
        secretConfigured: false,
        sourceKey: "hit-sist-master-sem1-2026",
      }),
    );
  });

  it("accepts requests signed with the trimmed secret contract", async () => {
    const payload = createPayload();
    const bodyString = JSON.stringify(payload);
    const timestamp = "1724315400000";
    const signature = computeSourceRelaySignature({
      rawBody: bodyString,
      secret: "test-secret",
      timestamp,
    });
    const { res, body } = createResponse();

    await handleSourceSnapshotRequest(
      createRequest({
        body: bodyString,
        headers: {
          "x-czw-source": "hit-sist-master-sem1-2026",
          "x-czw-timestamp": timestamp,
          "x-czw-signature": signature,
          "x-czw-content-hash": payload.contentHash,
        },
      }),
      res,
      {
        HIT_TIMETABLE_RELAY_SECRET: "  test-secret  ",
      } as NodeJS.ProcessEnv,
      {
        acceptSnapshot: vi.fn(async () => ({
          status: "accepted" as const,
          snapshotId: "snapshot-1",
          contentHash: payload.contentHash,
        })),
        getNowMs: () => Number(timestamp),
        loadSourceByKey: vi.fn(async () => sourceRecord),
        markSourceError: vi.fn(async () => undefined),
      },
    );

    expect(res.statusCode).toBe(200);
    expect(body()).toEqual({
      status: "accepted",
      snapshotId: "snapshot-1",
      contentHash: payload.contentHash,
    });
  });

  it("rejects requests signed with untrimmed secret bytes when the runtime trims configuration", async () => {
    const payload = createPayload();
    const bodyString = JSON.stringify(payload);
    const timestamp = "1724315400000";
    const signature = computeSourceRelaySignature({
      rawBody: bodyString,
      secret: "  test-secret  ",
      timestamp,
    });
    const { res, body } = createResponse();
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await handleSourceSnapshotRequest(
      createRequest({
        body: bodyString,
        headers: {
          "x-czw-source": "hit-sist-master-sem1-2026",
          "x-czw-timestamp": timestamp,
          "x-czw-signature": signature,
          "x-czw-content-hash": payload.contentHash,
        },
      }),
      res,
      {
        HIT_TIMETABLE_RELAY_SECRET: "  test-secret  ",
      } as NodeJS.ProcessEnv,
      {
        getNowMs: () => Number(timestamp),
        loadSourceByKey: vi.fn(async () => sourceRecord),
        markSourceError: vi.fn(async () => undefined),
      },
    );

    expect(res.statusCode).toBe(401);
    expect(body().error.code).toBe("SOURCE_AUTH_INVALID");
    expect(warnSpy).toHaveBeenCalledWith(
      "source relay auth failed",
      expect.objectContaining({
        reason: "signature_mismatch",
        secretConfigured: true,
        sourceKey: "hit-sist-master-sem1-2026",
      }),
    );
  });

  it("rejects requests when the raw body changes after signing", async () => {
    const payload = createPayload();
    const timestamp = "1724315400000";
    const originalBody = JSON.stringify(payload);
    const signature = computeSourceRelaySignature({
      rawBody: originalBody,
      secret: "test-secret",
      timestamp,
    });
    const mutatedBody = `${originalBody} `;
    const { res, body } = createResponse();
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await handleSourceSnapshotRequest(
      createRequest({
        body: mutatedBody,
        headers: {
          "x-czw-source": "hit-sist-master-sem1-2026",
          "x-czw-timestamp": timestamp,
          "x-czw-signature": signature,
          "x-czw-content-hash": payload.contentHash,
        },
      }),
      res,
      process.env,
      {
        getNowMs: () => Number(timestamp),
        getRelaySecret: () => "test-secret",
        loadSourceByKey: vi.fn(async () => sourceRecord),
        markSourceError: vi.fn(async () => undefined),
      },
    );

    expect(res.statusCode).toBe(401);
    expect(body().error.code).toBe("SOURCE_AUTH_INVALID");
    expect(warnSpy).toHaveBeenCalledWith(
      "source relay auth failed",
      expect.objectContaining({
        reason: "signature_mismatch",
        secretConfigured: true,
        sourceKey: "hit-sist-master-sem1-2026",
      }),
    );
  });

  it("rejects stale timestamps", async () => {
    const payload = createPayload();
    const bodyString = JSON.stringify(payload);
    const timestamp = "1724315400000";
    const signature = computeSourceRelaySignature({
      rawBody: bodyString,
      secret: "test-secret",
      timestamp,
    });
    const { res, body } = createResponse();

    await handleSourceSnapshotRequest(
      createRequest({
        body: bodyString,
        headers: {
          "x-czw-source": "hit-sist-master-sem1-2026",
          "x-czw-timestamp": timestamp,
          "x-czw-signature": signature,
          "x-czw-content-hash": payload.contentHash,
        },
      }),
      res,
      process.env,
      {
        getNowMs: () => Number(timestamp) + 301000,
        getRelaySecret: () => "test-secret",
        loadSourceByKey: vi.fn(async () => sourceRecord),
        markSourceError: vi.fn(async () => undefined),
      },
    );

    expect(res.statusCode).toBe(401);
    expect(body().error.code).toBe("SOURCE_REQUEST_EXPIRED");
  });

  it("rejects unknown sources", async () => {
    const payload = createPayload();
    const bodyString = JSON.stringify(payload);
    const timestamp = "1724315400000";
    const signature = computeSourceRelaySignature({
      rawBody: bodyString,
      secret: "test-secret",
      timestamp,
    });
    const { res, body } = createResponse();

    await handleSourceSnapshotRequest(
      createRequest({
        body: bodyString,
        headers: {
          "x-czw-source": "hit-sist-master-sem1-2026",
          "x-czw-timestamp": timestamp,
          "x-czw-signature": signature,
          "x-czw-content-hash": payload.contentHash,
        },
      }),
      res,
      process.env,
      {
        getNowMs: () => Number(timestamp),
        getRelaySecret: () => "test-secret",
        loadSourceByKey: vi.fn(async () => null),
        markSourceError: vi.fn(async () => undefined),
      },
    );

    expect(res.statusCode).toBe(404);
    expect(body().error.code).toBe("SOURCE_NOT_FOUND");
  });

  it("rejects mismatched file bindings and content hashes", async () => {
    const payload = createPayload({ fileId: "wrong-file-id" });
    const bodyString = JSON.stringify(payload);
    const timestamp = "1724315400000";
    const signature = computeSourceRelaySignature({
      rawBody: bodyString,
      secret: "test-secret",
      timestamp,
    });
    const { res, body } = createResponse();

    await handleSourceSnapshotRequest(
      createRequest({
        body: bodyString,
        headers: {
          "x-czw-source": "hit-sist-master-sem1-2026",
          "x-czw-timestamp": timestamp,
          "x-czw-signature": signature,
          "x-czw-content-hash": payload.contentHash,
        },
      }),
      res,
      process.env,
      {
        getNowMs: () => Number(timestamp),
        getRelaySecret: () => "test-secret",
        loadSourceByKey: vi.fn(async () => sourceRecord),
        markSourceError: vi.fn(async () => undefined),
      },
    );

    expect(res.statusCode).toBe(422);
    expect(body().error.code).toBe("SOURCE_PAYLOAD_INVALID");
  });

  it("rejects oversized payloads", async () => {
    const hugeBody = "x".repeat(2 * 1024 * 1024 + 1);
    const { res, body } = createResponse();

    await handleSourceSnapshotRequest(
      createRequest({
        body: hugeBody,
        headers: {
          "x-czw-source": "hit-sist-master-sem1-2026",
          "x-czw-timestamp": "1724315400000",
          "x-czw-signature": "abc",
          "x-czw-content-hash": "abc",
        },
      }),
      res,
      process.env,
      {
        getNowMs: () => 1724315400000,
        markSourceError: vi.fn(async () => undefined),
      },
    );

    expect(res.statusCode).toBe(413);
    expect(body().error.code).toBe("SOURCE_SNAPSHOT_TOO_LARGE");
  });
});
