import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/0018_source_gateway_draft_materialization_fix.sql",
  "utf8",
);

describe("source gateway draft materialization fix", () => {
  it("qualifies timetable/version column references that collide with output parameters", () => {
    expect(migration).toContain("where v.timetable_id = v_timetable_id");
    expect(migration).toContain("where t.id = v_timetable_id");
    expect(migration).toContain("#variable_conflict use_column");
  });

  it("keeps automatic materialization private and non-publishing", () => {
    expect(migration).toContain(
      "revoke execute on function public.materialize_source_generated_draft",
    );
    expect(migration).toContain("to service_role");
    expect(migration).not.toContain("current_published_version_id =");
    expect(migration).not.toContain("publish_timetable_version");
  });
});
