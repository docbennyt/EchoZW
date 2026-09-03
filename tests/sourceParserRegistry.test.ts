import { describe, expect, it } from "vitest";
import {
  hitSistMasterParser,
  resolveSourceParser,
} from "../server/sourceParserRegistry";

describe("source parser registry", () => {
  it("resolves the HIT parser by parser profile", () => {
    expect(resolveSourceParser("hit_sist_master_v1")).toBe(hitSistMasterParser);
  });

  it("fails safely for an unknown parser profile", () => {
    expect(() => resolveSourceParser("future_profile")).toThrow(
      "not registered",
    );
  });
});
