import { getAnalyticsIdentity } from "../analytics";

export type GoogleConnectionStatus = {
  subscriptionId: string;
  state:
    | "pending"
    | "syncing"
    | "synced"
    | "reconnect_required"
    | "failed"
    | "disconnected";
  lastSyncedAt: string | null;
  reconnectAllowed: boolean;
};

export async function fetchGoogleConnection(
  timetableId: string,
): Promise<GoogleConnectionStatus | null> {
  const response = await fetch(
    `/api/calendar/google/connection?timetableId=${encodeURIComponent(timetableId)}`,
    {
      headers: {
        Accept: "application/json",
        "X-CalenderZW-Anonymous-Id": getAnalyticsIdentity().anonymousId,
      },
    },
  );
  if (!response.ok)
    throw new Error("Could not check your Google Calendar connection.");
  return (
    (await response.json()) as { connection: GoogleConnectionStatus | null }
  ).connection;
}
