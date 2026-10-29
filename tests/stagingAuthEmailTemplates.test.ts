// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("staging-only hosted Auth template configuration", () => {
  it.each(["invite", "recovery"])(
    "%s changes only the exact plain staging callback and retains production verification",
    (type) => {
      const template = readFileSync(
        new URL(`../supabase/templates/${type}.html`, import.meta.url),
        "utf8",
      );
      const branches = template.match(
        /{{\s+if eq \.RedirectTo "([^"]+)"\s+}}([\s\S]+){{\s+else\s+}}([\s\S]+){{\s+end\s+}}/,
      );
      expect(branches).not.toBeNull();
      expect(branches?.[1]).toBe(
        "https://next.calender.aido.co.zw/account/update-password",
      );
      expect(branches?.[2]).toContain(
        `href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&amp;type=${type}"`,
      );
      expect(branches?.[3]).toContain('href="{{ .ConfirmationURL }}"');
      expect(branches?.[3]).not.toContain("TokenHash");
      expect(template).not.toContain(".Email");
      expect(template).not.toContain(".SiteURL");
    },
  );
});
