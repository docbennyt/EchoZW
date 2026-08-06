import { createClient, type SupabaseCookieStore } from "./server";

export type SupabaseSessionRefreshResult = {
  responseHeaders: Record<string, string>;
  error: Error | null;
};

export async function refreshSupabaseSession(
  cookieStore: SupabaseCookieStore,
): Promise<SupabaseSessionRefreshResult> {
  const responseHeaders: Record<string, string> = {};
  const supabase = createClient({
    getAll: cookieStore.getAll,
    async setAll(cookiesToSet, headers) {
      Object.assign(responseHeaders, headers);
      await cookieStore.setAll?.(cookiesToSet, headers);
    },
  });

  const { error } = await supabase.auth.getClaims();

  return {
    responseHeaders,
    error,
  };
}
