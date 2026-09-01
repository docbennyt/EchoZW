import {
  getBrowserRuntimeConfig,
  type CalenderZwRuntimeConfig,
} from "./runtimeConfig";

export type BrowserAuthConfigErrorCode = "AUTH_CLIENT_CONFIG_MISSING";

export class BrowserAuthConfigError extends Error {
  constructor(public readonly code: BrowserAuthConfigErrorCode) {
    super("Browser Supabase runtime configuration is missing.");
  }
}

type SupabaseEnv = Partial<ImportMetaEnv> & {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
};

export type SupabaseConfig = {
  url: string;
  publishableKey: string;
};

export function getSupabaseConfig(
  env: SupabaseEnv = import.meta.env,
  runtimeConfig:
    CalenderZwRuntimeConfig | undefined = getBrowserRuntimeConfig(),
) {
  const url =
    runtimeConfig?.supabaseUrl ??
    env.VITE_SUPABASE_URL ??
    env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    runtimeConfig?.supabasePublishableKey ??
    env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new BrowserAuthConfigError("AUTH_CLIENT_CONFIG_MISSING");
  }

  return { url, publishableKey } satisfies SupabaseConfig;
}
