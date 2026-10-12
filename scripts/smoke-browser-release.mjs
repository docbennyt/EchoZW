import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.CALENDERZW_BROWSER_SMOKE_BASE_URL;
if (!baseUrl) {
  throw new Error(
    "CALENDERZW_BROWSER_SMOKE_BASE_URL is required for the browser release smoke.",
  );
}

const origin = new URL(baseUrl);
const screenshotDir = resolve("artifacts/browser-smoke");
await mkdir(screenshotDir, { recursive: true });

const fatalConsolePatterns = [
  /failed to load module script/i,
  /strict mime type checking/i,
  /uncaught/i,
  /hydration failed/i,
  /minified react error/i,
];

const routes = [
  { path: "/", label: "home", mustContain: [/CalenderZW/i] },
  { path: "/find", label: "find", mustContain: [/find|timetable/i] },
  {
    path: "/t/hit-sbt-1-1-august-semester-2026",
    label: "sbt-class",
    timetable: true,
    mustContain: [/Biotechnology|SBT|Part 1\.1/i, /Add to Calendar/i],
  },
  {
    path: "/t/hit-sbt-1-1-august-semester-2026?sr=class_share",
    label: "sbt-share",
    timetable: true,
    mustContain: [/Biotechnology|SBT|Part 1\.1/i, /Add to Calendar/i],
  },
  {
    path: "/t/ise-part-4-1-august-semester-2026",
    label: "se41-class",
    timetable: true,
    mustContain: [/Software Engineering|ISE|Part 4\.1/i, /Add to Calendar/i],
  },
  {
    path: "/t/hit-sbt-1-1-august-semester-2026/google",
    label: "google-connect",
    mustContain: [/Google|calendar|CalenderZW/i],
  },
  {
    path: "/admin/login",
    label: "admin-login",
    mustContain: [/sign in|login|admin/i],
  },
  {
    path: "/privacy",
    label: "privacy",
    staticHtml: true,
    mustContain: [/Privacy Policy|privacy/i],
  },
];

function absolute(path) {
  return new URL(path, origin).toString();
}

function contentType(response) {
  return response.headers()["content-type"] ?? "";
}

async function verifyMissingAssetDoesNotServeHtml() {
  const missing = await fetch(
    absolute(`/assets/missing-release-gate-${Date.now()}.js`),
    { headers: { Accept: "text/javascript,*/*" } },
  );
  const type = missing.headers.get("content-type") ?? "";
  if (missing.status === 200 && /text\/html/i.test(type)) {
    throw new Error(
      `Missing JS asset returned SPA HTML 200 from ${missing.url} (${type}).`,
    );
  }
}

await verifyMissingAssetDoesNotServeHtml();

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_EXECUTABLE_PATH
    ? { executablePath: process.env.CHROME_EXECUTABLE_PATH }
    : {}),
});

const failures = [];
for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 375, height: 667 },
]) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.name === "mobile",
    userAgent:
      viewport.name === "mobile"
        ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1"
        : undefined,
  });

  for (const route of routes) {
    const page = await context.newPage();
    const consoleErrors = [];
    const assetProblems = [];
    const failedRequests = [];

    page.on("console", (message) => {
      const text = message.text();
      if (
        message.type() === "error" &&
        fatalConsolePatterns.some((pattern) => pattern.test(text))
      ) {
        consoleErrors.push(text);
      }
    });
    page.on("requestfailed", (request) => {
      const url = request.url();
      if (/\.(?:js|css)(?:\?|$)/i.test(url)) {
        failedRequests.push(`${url} ${request.failure()?.errorText ?? ""}`);
      }
    });
    page.on("response", (response) => {
      const url = response.url();
      if (!/\/assets\/.+\.(?:js|css)(?:\?|$)/i.test(url)) return;
      const type = contentType(response);
      if (
        /\.js(?:\?|$)/i.test(url) &&
        !/(javascript|ecmascript|text\/plain)/i.test(type)
      ) {
        assetProblems.push(`${url} served ${type || "no content-type"}`);
      }
      if (/\.css(?:\?|$)/i.test(url) && !/text\/css/i.test(type)) {
        assetProblems.push(`${url} served ${type || "no content-type"}`);
      }
      if (/text\/html/i.test(type)) {
        assetProblems.push(`${url} served HTML instead of a static asset`);
      }
    });

    try {
      const response = await page.goto(absolute(route.path), {
        waitUntil: "networkidle",
        timeout: 45_000,
      });
      if (!response || !response.ok()) {
        throw new Error(
          `Main response was ${response?.status() ?? "missing"} for ${route.path}`,
        );
      }

      if (route.staticHtml) {
        await page.waitForFunction(
          () => document.body.innerText.trim().length > 40,
          null,
          { timeout: 15_000 },
        );
      } else {
        await page.waitForFunction(
          () => {
            const root = document.querySelector("#root");
            return Boolean(root && root.children.length > 0);
          },
          null,
          { timeout: 15_000 },
        );
      }

      const bodyText = (await page.locator("body").innerText()).trim();
      if (bodyText.length < 40) {
        throw new Error(
          `Rendered body is too small (${bodyText.length} chars).`,
        );
      }
      for (const pattern of route.mustContain) {
        if (!pattern.test(bodyText)) {
          throw new Error(`Rendered body did not match ${pattern}.`);
        }
      }
      if (route.timetable) {
        if (
          !/\b(?:Mon|Tue|Wed|Thu|Fri|Monday|Tuesday|Wednesday|Thursday|Friday)\b/i.test(
            bodyText,
          )
        ) {
          throw new Error("Timetable route did not show weekday labels.");
        }
        if (!/\b\d{1,2}:\d{2}\b/.test(bodyText)) {
          throw new Error("Timetable route did not show class times.");
        }
        const addButton = page.getByRole("button", {
          name: /Add to Calendar/i,
        });
        await addButton.waitFor({ state: "visible", timeout: 10_000 });
        await addButton.click();
        await page
          .getByText(
            /Choose your reminders|Apple Calendar|Google Calendar|Download/i,
          )
          .first()
          .waitFor({ state: "visible", timeout: 10_000 });
      }

      if (
        consoleErrors.length ||
        assetProblems.length ||
        failedRequests.length
      ) {
        throw new Error(
          [
            ...consoleErrors.map((item) => `console: ${item}`),
            ...assetProblems.map((item) => `asset: ${item}`),
            ...failedRequests.map((item) => `request: ${item}`),
          ].join("\n"),
        );
      }

      await page.screenshot({
        path: resolve(screenshotDir, `${viewport.name}-${route.label}.png`),
        fullPage: false,
      });
      console.log(`PASS ${viewport.name} ${route.path}`);
    } catch (error) {
      await page
        .screenshot({
          path: resolve(
            screenshotDir,
            `${viewport.name}-${route.label}-failed.png`,
          ),
          fullPage: false,
        })
        .catch(() => undefined);
      failures.push(`${viewport.name} ${route.path}: ${error.message}`);
    } finally {
      await page.close();
    }
  }

  await context.close();
}

await browser.close();

if (failures.length) {
  console.error(failures.join("\n\n"));
  throw new Error(`${failures.length} browser release smoke check(s) failed.`);
}

console.log(`PASS: browser release smoke passed for ${origin.origin}`);
