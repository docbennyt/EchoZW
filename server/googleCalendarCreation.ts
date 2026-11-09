import { createSupabaseAdminClient } from "./supabase/adminClient.js";

/** Persist a claim before the single allowed provider Calendar insert attempt. */
export async function beginGoogleCalendarCreation(input: {
  subscriptionId: string;
  connectionGeneration: number;
  leaseToken: string;
  env: NodeJS.ProcessEnv;
}) {
  const { data, error } = await createSupabaseAdminClient(input.env).rpc(
    "begin_google_calendar_creation",
    {
      p_subscription_id: input.subscriptionId,
      p_connection_generation: input.connectionGeneration,
      p_lease_token: input.leaseToken,
    },
  );
  if (error) throw new Error("GOOGLE_CALENDAR_CREATION_CLAIM_UNAVAILABLE");
  return data === true;
}
