import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "./config";

export class BrowserAuthClientInitError extends Error {
  readonly code = "AUTH_CLIENT_INIT_FAILED";

  constructor(cause: unknown) {
    super("Browser Supabase client initialization failed.");
    this.cause = cause;
  }
}

let browserClient: SupabaseClient | null = null;

export const createClient = () => {
  if (browserClient) return browserClient;

  const { url, publishableKey } = getSupabaseConfig();
  try {
    browserClient = createBrowserClient(url, publishableKey);
    return browserClient;
  } catch (error) {
    throw new BrowserAuthClientInitError(error);
  }
};
