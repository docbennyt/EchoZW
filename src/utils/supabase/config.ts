type SupabaseEnv = ImportMetaEnv & {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
};

export type SupabaseConfig = {
  url: string;
  publishableKey: string;
};

export function getSupabaseConfig(env: SupabaseEnv = import.meta.env) {
  const url = env.VITE_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url) {
    throw new Error("VITE_SUPABASE_URL is required.");
  }

  if (!publishableKey) {
    throw new Error("VITE_SUPABASE_PUBLISHABLE_KEY is required.");
  }

  return { url, publishableKey } satisfies SupabaseConfig;
}
