import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/0036_static_document_target_draft_jsonb_alias_fix.sql",
  "utf8",
);

describe("static target draft JSONB alias hotfix", () => {
  it("addresses jsonb_array_elements output columns explicitly", () => {
    expect(migration).toContain(
      "from jsonb_array_elements(p_sessions) as session_row(value)",
    );
    expect(migration).toContain("session_row.value->>'candidateKey'");
    expect(migration).toContain(
      "jsonb_array_elements(p_resolutions) as resolution(value)",
    );
    expect(migration).toContain("resolution.value->>'warningId'");
  });

  it("does not reintroduce bare composite JSON operators", () => {
    expect(migration).not.toContain("session_row->>");
    expect(migration).not.toContain("resolution->>");
  });

  it("preserves guarded draft-only materialization", () => {
    expect(migration).toContain("'draft'");
    expect(migration).toContain("current_version_id = v_version_id");
    expect(migration).not.toContain("current_published_version_id =");
  });
});
