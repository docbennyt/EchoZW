import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseConfig } from "./config";

export const createClient = () => {
  const { url, publishableKey } = getSupabaseConfig();
  return createBrowserClient(url, publishableKey);
};
