import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { getSupabaseConfig } from "./config";

export type SupabaseCookie = {
  name: string;
  value: string;
};

export type SupabaseCookieToSet = SupabaseCookie & {
  options: CookieOptions;
};

export type SupabaseCookieStore = {
  getAll: () => SupabaseCookie[] | Promise<SupabaseCookie[] | null> | null;
  setAll?: (
    cookiesToSet: SupabaseCookieToSet[],
    headers: Record<string, string>,
  ) => void | Promise<void>;
};

export const createClient = (cookieStore: SupabaseCookieStore) => {
  const { url, publishableKey } = getSupabaseConfig();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet, headers) {
        return cookieStore.setAll?.(cookiesToSet, headers);
      },
    },
  });
};
