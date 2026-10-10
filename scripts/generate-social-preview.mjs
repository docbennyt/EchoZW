import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = join(root, "branding", "social-preview");
const outputPath = join(root, "public", "calenderzw-share-1200x630.jpg");

const parts = (await readdir(sourceDir))
  .filter((name) => /^calenderzw-share\.part-\d+\.b64$/.test(name))
  .sort();

if (parts.length === 0) {
  throw new Error("No CalenderZW social preview source chunks were found.");
}

const encoded = (
  await Promise.all(parts.map((name) => readFile(join(sourceDir, name), "utf8")))
)
  .join("")
  .replace(/\s+/g, "");

const bytes = Buffer.from(encoded, "base64");

if (
  bytes.length < 15_000 ||
  bytes[0] !== 0xff ||
  bytes[1] !== 0xd8 ||
  bytes[2] !== 0xff
) {
  throw new Error("CalenderZW social preview source did not decode to a valid JPEG.");
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, bytes);

console.log(
  JSON.stringify({
    event: "social.preview.generated",
    path: "public/calenderzw-share-1200x630.jpg",
    bytes: bytes.length,
    sourceParts: parts.length,
  }),
);
