export type ServerSupabaseEnv = {
  SUPABASE_URL?: string;
  VITE_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
};

export type ServerSupabaseConfig = {
  url: string;
  projectHost: string;
  publishableKey: string;
  serviceRoleKey?: string;
};

function parseSupabaseUrl(rawUrl: string | undefined) {
  if (!rawUrl) return undefined;
  try {
    const url = new URL(rawUrl);
    return {
      url: url.toString().replace(/\/$/, ""),
      projectHost: url.host,
    };
  } catch {
    throw new Error("SUPABASE_URL must be a valid URL.");
  }
}

export function getServerSupabaseConfig(
  env: ServerSupabaseEnv = process.env,
): ServerSupabaseConfig {
  const parsedUrl = parseSupabaseUrl(
    env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL,
  );
  if (!parsedUrl) {
    throw new Error("SUPABASE_URL is required for server Supabase access.");
  }

  const publishableKey =
    env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    env.SUPABASE_ANON_KEY;
  if (!publishableKey) {
    throw new Error(
      "VITE_SUPABASE_PUBLISHABLE_KEY is required for Supabase Auth.",
    );
  }

  return {
    ...parsedUrl,
    publishableKey,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

export function validateSupabaseProductionConfig(
  env: ServerSupabaseEnv = process.env,
) {
  const config = getServerSupabaseConfig(env);
  if (!config.serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is required for server-side admin authorization.",
    );
  }
  return config;
}
