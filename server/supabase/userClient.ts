import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabaseConfig } from "./config.js";

export function createSupabaseUserClient(
  accessToken?: string,
  env: NodeJS.ProcessEnv = process.env,
): SupabaseClient {
  const config = getServerSupabaseConfig(env);
  return createClient(config.url, config.publishableKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: accessToken
      ? {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      : undefined,
  });
}
