import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseConfig } from "./config";

export class BrowserAuthClientInitError extends Error {
  readonly code = "AUTH_CLIENT_INIT_FAILED";

  constructor(cause: unknown) {
    super("Browser Supabase client initialization failed.");
    this.cause = cause;
  }
}

export const createClient = () => {
  const { url, publishableKey } = getSupabaseConfig();
  try {
    return createBrowserClient(url, publishableKey);
  } catch (error) {
    throw new BrowserAuthClientInitError(error);
  }
};
