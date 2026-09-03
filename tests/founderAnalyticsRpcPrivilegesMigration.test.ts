import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/0016_founder_analytics_rpc_privilege_hardening.sql",
  "utf8",
);

describe("founder analytics RPC privilege hardening", () => {
  it("explicitly revokes browser-role execution from every analytics RPC", () => {
    for (const functionName of [
      "analytics_stage_for_events",
      "analytics_score_for_events",
      "resolve_analytics_person",
      "get_admin_analytics_overview_v1",
      "get_admin_analytics_overview",
    ]) {
      expect(sql).toContain(`function public.${functionName}`);
    }

    const revokeClauses = sql.match(
      /revoke execute on function[\s\S]*?from public, anon, authenticated;/gi,
    );
    expect(revokeClauses).toHaveLength(5);
  });

  it("keeps the server service role explicitly authorized", () => {
    const grants = sql.match(
      /grant execute on function[\s\S]*?to service_role;/gi,
    );
    expect(grants).toHaveLength(5);
  });
});
