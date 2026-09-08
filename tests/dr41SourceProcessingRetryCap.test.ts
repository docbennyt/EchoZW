import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/0025_source_processing_retry_cap.sql",
  ),
  "utf8",
);

describe("DR-41 source processing retry cap", () => {
  it("never reclaims a terminal failed source job", () => {
    expect(migration).toContain("job.status = 'queued'");
    expect(migration).toContain("job.attempt_count < 5");
    expect(migration).not.toContain("status in ('queued', 'failed')");
  });

  it("marks the fifth failed attempt terminal while retaining backoff before it", () => {
    expect(migration).toContain(
      "case when attempt_count >= 5 then 'failed' else 'queued' end",
    );
    expect(migration).toContain("least(attempt_count, 5) * 5");
  });

  it("keeps processing RPCs service-role only", () => {
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("to service_role");
  });
});
