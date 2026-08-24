import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { calendarMvpPlugin } from "./server/viteCalendarPlugin.js";

export default defineConfig(({ mode }) => {
  const loadedEnv = loadEnv(mode, process.cwd(), "");
  const allowedHosts = [
    "calender.aido.co.zw",
    ...(loadedEnv.VITE_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim())
      .filter(Boolean),
  ];

  return {
    plugins: [react(), calendarMvpPlugin({ serverEnv: loadedEnv })],
    server: {
      allowedHosts,
    },
    preview: {
      allowedHosts,
    },
    test: {
      environment: "jsdom",
      globals: true,
      pool: "threads",
      maxWorkers: 4,
      setupFiles: "./src/test/setup.ts",
    },
  };
});
