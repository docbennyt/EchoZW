import { listGoogleCredentials } from "../dist-server/server/googleCalendarRepository.js";
import { decryptGoogleRefreshToken } from "../dist-server/server/googleCalendarSync.js";
import { createSupabaseAdminClient } from "../dist-server/server/supabase/adminClient.js";

try {
  const env = process.env;
  if (
    env.GITHUB_REF !== "refs/heads/Calender" ||
    env.SUPABASE_URL !== "https://jkafqgdymfiiklmozvhi.supabase.co" ||
    !env.SUPABASE_SECRET_KEY?.trim() ||
    !env.TOKEN_ENCRYPTION_KEY?.trim()
  )
    throw new Error();

  const [credentials, active] = await Promise.all([
    listGoogleCredentials(env),
    createSupabaseAdminClient(env)
      .from("calendar_subscriptions")
      .select("id")
      .eq("provider", "google_api")
      .eq("status", "active")
      .is("revoked_at", null),
  ]);
  if (active.error) throw new Error();
  const activeIds = new Set(active.data.map((row) => row.id));
  let activeWithCredentials = 0;
  let activeDecryptable = 0;
  let decryptable = 0;
  for (const row of credentials) {
    const isActive = activeIds.has(row.subscription_id);
    if (isActive) activeWithCredentials++;
    try {
      if (decryptGoogleRefreshToken(String(row.encrypted_refresh_token), env)) {
        decryptable++;
        if (isActive) activeDecryptable++;
      }
    } catch {
      // Report aggregate compatibility only.
    }
  }
  console.log(
    JSON.stringify({
      total: credentials.length,
      active: activeIds.size,
      activeWithCredentials,
      activeDecryptable,
      decryptable,
      incompatible: credentials.length - decryptable,
      recordedMigrations: credentials.filter(
        (row) => row.encryption_migration_id,
      ).length,
    }),
  );
} catch {
  console.error("PRODUCTION_GOOGLE_CREDENTIAL_AUDIT_FAILED");
  process.exitCode = 1;
}
