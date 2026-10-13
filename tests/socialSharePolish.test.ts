import { readFileSync, statSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

function decodePngRgb(
  path: string,
  expected: { width: number; height: number },
) {
  const file = readFileSync(path);
  expect(Array.from(file.subarray(0, 8))).toEqual([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat: Buffer[] = [];

  while (offset < file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.subarray(offset + 4, offset + 8).toString("ascii");
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + length;
    expect(chunkEnd + 4).toBeLessThanOrEqual(file.length);

    if (type === "IHDR") {
      width = file.readUInt32BE(chunkStart);
      height = file.readUInt32BE(chunkStart + 4);
      bitDepth = file[chunkStart + 8];
      colorType = file[chunkStart + 9];
    } else if (type === "IDAT") {
      idat.push(file.subarray(chunkStart, chunkEnd));
    }

    offset = chunkEnd + 4;
    if (type === "IEND") break;
  }

  expect({ width, height, bitDepth, colorType }).toEqual({
    width: expected.width,
    height: expected.height,
    bitDepth: 8,
    colorType: 2,
  });

  const channels = 3;
  const stride = width * channels;
  const inflated = inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(height * stride);

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    const filter = inflated[rowStart];
    expect(filter).toBeGreaterThanOrEqual(0);
    expect(filter).toBeLessThanOrEqual(4);
    for (let x = 0; x < stride; x += 1) {
      const raw = inflated[rowStart + 1 + x];
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upLeft =
        y > 0 && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      const paeth = (() => {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        if (pa <= pb && pa <= pc) return left;
        return pb <= pc ? up : upLeft;
      })();
      const predictor =
        filter === 1
          ? left
          : filter === 2
            ? up
            : filter === 3
              ? Math.floor((left + up) / 2)
              : filter === 4
                ? paeth
                : 0;
      pixels[y * stride + x] = (raw + predictor) & 0xff;
    }
  }

  return { width, height, pixels, stride };
}

describe("CalenderZW social sharing polish", () => {
  it("ships a non-empty absolute Open Graph image for WhatsApp/link previews", () => {
    const html = readFileSync("index.html", "utf8");
    expect(html).toContain(
      "https://calender.aido.co.zw/og/calendarzw-own-your-semester-wide.png?v=2",
    );
    expect(html).toContain(
      "https://calender.aido.co.zw/og/calendarzw-own-your-semester-square.png?v=2",
    );
    expect(html).toContain('property="og:image:width"');
    expect(html).toContain("1731");
    expect(html).toContain("1254");
    expect(html).toContain(
      "CalenderZW promotional preview showing a student and the message Own your semester.",
    );
    expect(html).toMatch(
      /name=["']twitter:image["'][^>]+https:\/\/calender\.aido\.co\.zw\//i,
    );
  });

  it("keeps the WhatsApp CTA icon white on green", () => {
    const css = `${readFileSync("src/appV2.css", "utf8")}\n${readFileSync(
      "src/publicTimetableReliability.css",
      "utf8",
    )}`;
    const source = readFileSync("src/PublicTimetableReliability.tsx", "utf8");
    expect(css).toContain("DR-173 WhatsApp CTA contrast");
    expect(css).toContain('a[href*="wa.me"] svg');
    expect(css).toContain(".pt-whatsapp-channel-link svg path");
    expect(css).toContain("color: #fff !important");
    expect(source).toContain('fill="#fff"');
  });

  it("uses intentional class-share copy instead of the old single-line message", () => {
    const candidates = ["src/domain/shareAttribution.ts"];
    const source = candidates
      .filter((path) => /\.(?:ts|tsx|js|jsx)$/.test(path))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    expect(source).not.toContain(
      "timetable is live on CalenderZW — see tomorrow",
    );
    expect(source).toContain("timetable is live! 🎓");
    expect(source).toContain("See tomorrow's lectures");
    expect(source).toContain("add the full timetable to your calendar.");
  });

  it("ships complete non-blank branded wide and square PNG social images", () => {
    const path = "public/og/calendarzw-own-your-semester-wide.png";
    expect(statSync(path).size).toBeGreaterThan(20_000);

    const { width, height, pixels, stride } = decodePngRgb(path, {
      width: 1731,
      height: 909,
    });
    let brightPixels = 0;
    let greenPixels = 0;
    let amberPixels = 0;
    let darkPixels = 0;
    let colorVariance = 0;

    for (let y = 0; y < height; y += 8) {
      for (let x = 0; x < width; x += 8) {
        const index = y * stride + x * 3;
        const r = pixels[index];
        const g = pixels[index + 1];
        const b = pixels[index + 2];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        if (r > 210 && g > 210 && b > 210) brightPixels += 1;
        if (g > 70 && g >= r * 0.7 && g > b * 1.25) greenPixels += 1;
        if (r > 190 && g > 130 && b < 90) amberPixels += 1;
        if (r < 24 && g < 24 && b < 24) darkPixels += 1;
        colorVariance += max - min;
      }
    }

    expect(brightPixels).toBeGreaterThan(100);
    expect(greenPixels).toBeGreaterThan(100);
    expect(amberPixels).toBeGreaterThan(25);
    expect(darkPixels).toBeLessThan(1_000);
    expect(colorVariance).toBeGreaterThan(10_000);

    const squarePath = "public/og/calendarzw-own-your-semester-square.png";
    expect(statSync(squarePath).size).toBeGreaterThan(20_000);
    const square = decodePngRgb(squarePath, { width: 1254, height: 1254 });
    expect(square.width).toBe(square.height);
  });
});
