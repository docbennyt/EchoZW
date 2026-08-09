import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabaseConfig } from "./config.js";

export function createSupabaseAdminClient(
  env: NodeJS.ProcessEnv = process.env,
): SupabaseClient {
  const config = getServerSupabaseConfig(env);
  if (!config.privilegedKey) {
    throw new Error(
      "SUPABASE_SECRET_KEY is required for server-side admin authorization.",
    );
  }

  return createClient(config.url, config.privilegedKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
