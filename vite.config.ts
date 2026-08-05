import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { calendarMvpPlugin } from "./server/viteCalendarPlugin";

export default defineConfig({
  plugins: [react(), calendarMvpPlugin()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
  },
});
