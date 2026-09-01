import {
  getServerSupabaseConfig,
  type ServerSupabaseEnv,
} from "./supabase/config.js";

export type RuntimePublicConfig = {
  supabaseUrl: string;
  supabasePublishableKey: string;
  publicAppUrl: string;
  releaseSha: string | null;
};

function publicOrigin(env: NodeJS.ProcessEnv) {
  return (env.PUBLIC_APP_URL ?? env.APP_ORIGIN ?? "").replace(/\/$/, "");
}

export function buildRuntimePublicConfig(
  env: ServerSupabaseEnv & NodeJS.ProcessEnv = process.env,
): RuntimePublicConfig {
  const supabase = getServerSupabaseConfig(env);
  return {
    supabaseUrl: supabase.url,
    supabasePublishableKey: supabase.publishableKey,
    publicAppUrl: publicOrigin(env),
    releaseSha:
      env.RENDER_GIT_COMMIT ??
      env.SOURCE_VERSION ??
      env.VERCEL_GIT_COMMIT_SHA ??
      env.GITHUB_SHA ??
      null,
  };
}

export function serializeRuntimeConfigScript(config: RuntimePublicConfig) {
  const json = JSON.stringify(config).replace(/</g, "\\u003c");
  return `window.__CALENDERZW_RUNTIME_CONFIG__ = ${json};\n`;
}

export function runtimeConfigResponseHeaders(contentLength: number) {
  return {
    "Content-Type": "text/javascript; charset=utf-8",
    "Content-Length": contentLength,
    "Cache-Control": "no-store",
  };
}

export function runtimeConfigHasOnlyPublicValues(script: string) {
  return !/SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|service[_-]?role|GOOGLE_CLIENT_SECRET|refresh[_-]?token|access[_-]?token|calendar[_-]?token|password|phone/i.test(
    script,
  );
}
