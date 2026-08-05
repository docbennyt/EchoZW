import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { env } from "node:process";
import { calendarMvpPlugin } from "./server/viteCalendarPlugin.js";

const allowedHosts = [
  "calender.aido.co.zw",
  "calendar.aido.co.zw",
  ...(env.VITE_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean),
];

export default defineConfig({
  plugins: [react(), calendarMvpPlugin()],
  server: {
    allowedHosts,
  },
  preview: {
    allowedHosts,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
  },
});
