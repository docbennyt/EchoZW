import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

const outputPath = resolve("public/calenderzw-share-1200x630.png");
const logoUrl = `data:image/png;base64,${readFileSync(
  resolve("public/calenderzw-logo.png"),
).toString("base64")}`;

const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      * {
        box-sizing: border-box;
      }

      body {
        width: 1200px;
        height: 630px;
        margin: 0;
        overflow: hidden;
        background: #f7f0df;
        color: #063f33;
        font-family: Inter, Arial, Helvetica, sans-serif;
      }

      .canvas {
        position: relative;
        width: 1200px;
        height: 630px;
        padding: 54px 68px;
        background:
          radial-gradient(circle at 87% 22%, rgba(246, 177, 45, 0.28) 0 106px, transparent 107px),
          linear-gradient(112deg, rgba(9, 104, 69, 0.12) 0 33%, transparent 34%),
          #f7f0df;
      }

      .stripe {
        position: absolute;
        right: -150px;
        bottom: -188px;
        width: 520px;
        height: 520px;
        border: 64px solid #f2b436;
        border-radius: 118px;
        transform: rotate(45deg);
        opacity: 0.92;
      }

      .brand {
        display: flex;
        align-items: center;
        gap: 18px;
        height: 70px;
      }

      .brand img {
        width: 278px;
        height: auto;
        object-fit: contain;
      }

      .brand-pill {
        display: inline-flex;
        align-items: center;
        height: 38px;
        padding: 0 18px;
        border-radius: 999px;
        background: #0b5d45;
        color: #fff9e8;
        font-size: 17px;
        font-weight: 800;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      .copy {
        position: relative;
        z-index: 1;
        width: 610px;
        padding-top: 70px;
      }

      h1 {
        margin: 0;
        max-width: 570px;
        color: #063f33;
        font-size: 78px;
        line-height: 0.94;
        font-weight: 900;
      }

      .subhead {
        margin-top: 28px;
        color: #135d48;
        font-size: 34px;
        line-height: 1.16;
        font-weight: 820;
      }

      .support {
        display: inline-flex;
        align-items: center;
        gap: 14px;
        margin-top: 30px;
        padding: 14px 20px;
        border-radius: 18px;
        background: #fff9ed;
        border: 2px solid rgba(8, 64, 51, 0.14);
        color: #174e40;
        font-size: 22px;
        font-weight: 790;
        box-shadow: 0 14px 34px rgba(9, 53, 42, 0.1);
      }

      .dot {
        flex: 0 0 auto;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: #f2b436;
      }

      .phone {
        position: absolute;
        right: 68px;
        top: 70px;
        width: 384px;
        height: 508px;
        border-radius: 44px;
        background: #052e26;
        padding: 14px;
        box-shadow: 0 34px 70px rgba(8, 46, 37, 0.29);
      }

      .screen {
        width: 100%;
        height: 100%;
        border-radius: 34px;
        overflow: hidden;
        background: #fffaf0;
        border: 2px solid rgba(255, 255, 255, 0.75);
      }

      .screen-header {
        padding: 30px 28px 24px;
        background: #0b6a4b;
        color: #fff9ed;
      }

      .screen-kicker {
        font-size: 15px;
        font-weight: 800;
        opacity: 0.82;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .screen-title {
        margin-top: 8px;
        font-size: 34px;
        line-height: 1.02;
        font-weight: 900;
      }

      .screen-body {
        padding: 18px 22px;
      }

      .session {
        display: grid;
        grid-template-columns: 76px 1fr;
        gap: 16px;
        padding: 17px 0;
        border-bottom: 1px solid rgba(12, 73, 58, 0.14);
      }

      .session:last-child {
        border-bottom: 0;
      }

      .time {
        color: #0a8b5e;
        font-size: 22px;
        line-height: 1.05;
        font-weight: 900;
      }

      .course {
        color: #062f27;
        font-size: 24px;
        line-height: 1.08;
        font-weight: 900;
      }

      .venue {
        margin-top: 6px;
        color: #4d675e;
        font-size: 17px;
        font-weight: 760;
      }

      .cta {
        margin: 14px 20px 0;
        height: 52px;
        border-radius: 18px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #f2b436;
        color: #063f33;
        font-size: 18px;
        font-weight: 900;
      }
    </style>
  </head>
  <body>
    <main class="canvas">
      <div class="stripe"></div>
      <div class="brand">
        <img src="${logoUrl}" alt="CalenderZW" />
        <div class="brand-pill">Student timetable links</div>
      </div>
      <section class="copy">
        <h1>Find your timetable.</h1>
        <div class="subhead">Your classes. Your calendar.</div>
        <div class="support">
          <span class="dot"></span>
          <span>Free for students · No app required</span>
        </div>
      </section>
      <aside class="phone" aria-hidden="true">
        <div class="screen">
          <div class="screen-header">
            <div class="screen-kicker">HIT · Biotechnology</div>
            <div class="screen-title">Part 1.1<br />August timetable</div>
          </div>
          <div class="screen-body">
            <div class="session">
              <div class="time">Mon<br />08:00</div>
              <div>
                <div class="course">SBT1104</div>
                <div class="venue">Main Lab · Lecture</div>
              </div>
            </div>
            <div class="session">
              <div class="time">Tue<br />10:15</div>
              <div>
                <div class="course">ICS1110</div>
                <div class="venue">N205 · Practical</div>
              </div>
            </div>
            <div class="session">
              <div class="time">Thu<br />12:15</div>
              <div>
                <div class="course">Chemistry</div>
                <div class="venue">B Block · Tutorial</div>
              </div>
            </div>
            <div class="cta">Add to Calendar</div>
          </div>
        </div>
      </aside>
    </main>
  </body>
</html>`;

await mkdir(dirname(outputPath), { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_EXECUTABLE_PATH ||
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: "networkidle" });
await page.screenshot({ path: outputPath, type: "png" });
await browser.close();
console.log(`Rendered ${outputPath}`);
