import type { Plugin } from "vite";
import { handleAnalyticsRequest } from "./analyticsApi.js";

type RuntimeEnv = NodeJS.ProcessEnv & Record<string, string | undefined>;

type AnalyticsPluginOptions = {
  serverEnv?: RuntimeEnv;
};

export function analyticsMvpPlugin(
  options: AnalyticsPluginOptions = {},
): Plugin {
  const env = { ...process.env, ...(options.serverEnv ?? {}) };
  return {
    name: "calenderzw-analytics-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          if (await handleAnalyticsRequest(req, res, env)) return;
          next();
        } catch (error) {
          next(
            error instanceof Error
              ? error
              : new Error("Analytics middleware failed."),
          );
        }
      });
    },
  };
}
