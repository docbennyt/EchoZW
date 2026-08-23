import { describe, expect, it } from "vitest";
import {
  GOOGLE_DOCS_APPS_SCRIPT_PROVIDER,
  SOURCE_SNAPSHOT_BODY_LIMIT_BYTES,
  computeCanonicalSourceContentHash,
  computeSourceRelaySignature,
  googleDocsSourceSnapshotSchema,
  timingSafeEqualBase64Url,
} from "../src/domain/sourceSnapshots";

function createPayload() {
  return {
    schemaVersion: 1 as const,
    sourceId: "hit-sist-master-sem1-2026",
    provider: GOOGLE_DOCS_APPS_SCRIPT_PROVIDER,
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
          [
            ["Course", "Lecturer"],
            ["HIT100", "Dr Example"],
          ],
        ],
      },
    ],
  };
}

describe("source snapshot hashing", () => {
  it("keeps the canonical content hash stable across request metadata changes", () => {
    const base = createPayload();
    const changed = {
      ...createPayload(),
      observedAt: "2026-08-22T09:45:00.000Z",
      contentHash: "some-other-value",
    };

    expect(computeCanonicalSourceContentHash(base)).toBe(
      computeCanonicalSourceContentHash(changed),
    );
  });

  it("changes the canonical content hash when a table cell changes", () => {
    const base = createPayload();
    const changed = createPayload();
    changed.tabs[0].tables[0][1][1] = "CS.1 HIT100 N205";

    expect(computeCanonicalSourceContentHash(base)).not.toBe(
      computeCanonicalSourceContentHash(changed),
    );
  });
});

describe("source snapshot signatures", () => {
  it("produces a Base64URL HMAC signature that can be verified with timing-safe comparison", () => {
    const rawBody = JSON.stringify(createPayload());
    const signature = computeSourceRelaySignature({
      rawBody,
      secret: "test-secret",
      timestamp: "1724315400000",
    });

    expect(timingSafeEqualBase64Url(signature, signature)).toBe(true);
    expect(
      timingSafeEqualBase64Url(signature, `${signature.slice(0, -1)}A`),
    ).toBe(false);
    expect(timingSafeEqualBase64Url(signature, "not-base64url!!!")).toBe(false);
  });
});

describe("source snapshot schema", () => {
  it("rejects unsupported schema versions and empty tabs", () => {
    const unsupported = {
      ...createPayload(),
      schemaVersion: 2,
    };
    const emptyTabs = {
      ...createPayload(),
      tabs: [],
    };

    expect(googleDocsSourceSnapshotSchema.safeParse(unsupported).success).toBe(
      false,
    );
    expect(googleDocsSourceSnapshotSchema.safeParse(emptyTabs).success).toBe(
      false,
    );
  });

  it("accepts realistic Google Docs table payloads within the body limit", () => {
    const payload = createPayload();
    payload.contentHash = computeCanonicalSourceContentHash(payload);
    const raw = JSON.stringify(payload);

    expect(raw.length).toBeLessThan(SOURCE_SNAPSHOT_BODY_LIMIT_BYTES);
    expect(googleDocsSourceSnapshotSchema.parse(payload).tabs).toHaveLength(1);
  });
});
