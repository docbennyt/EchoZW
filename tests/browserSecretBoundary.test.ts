import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function filesUnder(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

describe("browser secret boundary", () => {
  it("keeps server-only Supabase variables out of browser source", () => {
    const browserSource = filesUnder("src").filter((file) =>
      /\.(ts|tsx)$/.test(file),
    );
    const joined = browserSource
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");

    expect(joined).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(joined).not.toContain("service_role");
  });

  it(".env.example contains placeholders and no live project secrets", () => {
    const example = readFileSync(".env.example", "utf8");
    expect(example).toContain("SUPABASE_SERVICE_ROLE_KEY=");
    expect(example).not.toContain("eyJ");
    expect(example).not.toContain("sb_secret_");
  });
});
