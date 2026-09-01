import type { IncomingMessage, ServerResponse } from "node:http";
import { checkSupabaseConnectivity } from "./supabase/connectivity.js";
import { buildRuntimePublicConfig } from "./runtimePublicConfig.js";
import { checkSchemaCompatibility } from "./schemaCompatibility.js";
import { validateSupabaseProductionConfig } from "./supabase/config.js";

export type ReadinessResult = {
  status: "ready" | "not_ready";
  release: string | null;
  dependencies: {
    serverConfig: "ok" | "missing";
    supabase: "ok" | "unavailable";
    schema: "ok" | "incompatible" | "unavailable";
    browserAuthConfig: "ok" | "missing";
  };
};

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(JSON.stringify(body));
}

export async function checkReadiness(
  env: NodeJS.ProcessEnv = process.env,
  deps: {
    checkConnectivity?: typeof checkSupabaseConnectivity;
    checkSchema?: typeof checkSchemaCompatibility;
  } = {},
): Promise<ReadinessResult> {
  let serverConfig: "ok" | "missing" = "ok";
  let browserAuthConfig: "ok" | "missing" = "ok";
  let release: string | null = null;

  try {
    validateSupabaseProductionConfig(env);
    const publicConfig = buildRuntimePublicConfig(env);
    release = publicConfig.releaseSha;
    if (!publicConfig.supabaseUrl || !publicConfig.supabasePublishableKey) {
      browserAuthConfig = "missing";
    }
  } catch {
    serverConfig = "missing";
    browserAuthConfig = "missing";
  }

  const connectivity = await (
    deps.checkConnectivity ?? checkSupabaseConnectivity
  )(env);
  const schema = await (deps.checkSchema ?? checkSchemaCompatibility)(env);
  const dependencies: ReadinessResult["dependencies"] = {
    serverConfig,
    supabase:
      connectivity.reachable && connectivity.authConfigured
        ? "ok"
        : "unavailable",
    schema: schema.status,
    browserAuthConfig,
  };
  const ready = Object.values(dependencies).every((value) => value === "ok");
  return {
    status: ready ? "ready" : "not_ready",
    release,
    dependencies,
  };
}

export async function handleHealthRequest(
  req: IncomingMessage,
  res: ServerResponse,
  env: NodeJS.ProcessEnv = process.env,
  deps: Parameters<typeof checkReadiness>[1] = {},
) {
  const requestUrl = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "GET" && requestUrl.pathname === "/api/health/live") {
    sendJson(res, 200, { status: "ok" });
    return true;
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/health/ready") {
    const readiness = await checkReadiness(env, deps);
    sendJson(res, readiness.status === "ready" ? 200 : 503, readiness);
    return true;
  }

  return false;
}
