// @vitest-environment node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const python = process.platform === "win32" ? "python" : "python3";
const extractor = resolve("scripts/extract-staging-artifact.py");
function extract(extra: string, corruptDigest = false) {
  const directory = mkdtempSync(join(tmpdir(), "czw-reviewed-artifact-"));
  try {
    const archive = join(directory, "bundle.zip");
    execFileSync(python, [
      "-c",
      "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1],'w'); z.writestr('bundle/index.js','export default {}'); z.writestr('dist/index.html','<html></html>'); info=zipfile.ZipInfo('extra'); info.filename=sys.argv[2]; z.writestr(info,'fixture'); z.close()",
      archive,
      extra,
    ]);
    const digest = createHash("sha256")
      .update(readFileSync(archive))
      .digest("hex");
    return execFileSync(python, [extractor, archive], {
      cwd: directory,
      env: {
        ...process.env,
        ARTIFACT_DIGEST: corruptDigest ? "0".repeat(64) : digest,
      },
      stdio: "pipe",
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("reviewed staging artifact", () => {
  it("accepts the bound Worker and static asset archive", () => {
    expect(() => extract("dist/assets/app.js")).not.toThrow();
  });
  it("fails closed on digest mismatch", () => {
    expect(() => extract("dist/assets/app.js", true)).toThrow(
      "ARTIFACT_DIGEST_MISMATCH",
    );
  });
  it.each([
    "../outside",
    "dist/../../outside",
    "package.json",
    "scripts/steal.mjs",
    "dist\\escape",
  ])("rejects unsafe archive member %s", (path) => {
    expect(() => extract(path)).toThrow("ARTIFACT_PATH_INVALID");
  });
});
