import { useEffect, useState } from "react";
import {
  fetchGoogleConnection,
  type GoogleConnectionStatus,
} from "./api/googleConnection";
import { GoogleCalendarDisconnectEntry } from "./GoogleCalendarDisconnectEntry";

export function GoogleCalendarConnectionStatus({
  timetableId,
  slug,
}: {
  timetableId: string;
  slug: string;
}) {
  const [connection, setConnection] = useState<GoogleConnectionStatus | null>(
    null,
  );
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    void fetchGoogleConnection(timetableId)
      .then((value) => {
        if (active) {
          setConnection(value);
          setError(false);
        }
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [timetableId, refresh]);
  if (error)
    return (
      <p role="status">
        Google Calendar status is unavailable.{" "}
        <button type="button" onClick={() => setRefresh((value) => value + 1)}>
          Check again
        </button>
      </p>
    );
  if (!connection) return null;
  const reconnect =
    connection.state === "reconnect_required" ||
    connection.state === "disconnected";
  const message = {
    synced: "Your Google calendar is synchronized with the current timetable.",
    syncing:
      "Google authorization is saved. Timetable delivery is still pending.",
    pending: "Google Calendar authorization has not finished.",
    reconnect_required:
      "Google Calendar needs your authorization again to receive timetable updates.",
    failed:
      "Google Calendar delivery needs attention. Your existing connection has been preserved.",
    disconnected:
      "Google Calendar is disconnected. Authorize it again to resume updates.",
  }[connection.state];
  return (
    <div
      className="pt-google-connected-note gcal-owned-connection"
      role="status"
    >
      <div>
        <strong>Google Calendar</strong>
        <small>{message}</small>
      </div>
      {reconnect || connection.state === "pending" ? (
        <a href={`/t/${encodeURIComponent(slug)}/google`}>
          {reconnect
            ? "Reconnect Google Calendar"
            : "Continue Google authorization"}
        </a>
      ) : null}
      {connection.state === "synced" ? (
        <a href="https://calendar.google.com/calendar/u/0/r">
          Open Google Calendar
        </a>
      ) : (
        <button type="button" onClick={() => setRefresh((value) => value + 1)}>
          Check delivery
        </button>
      )}
      <GoogleCalendarDisconnectEntry
        connected={connection.state !== "disconnected"}
        subscriptionId={connection.subscriptionId}
      />
    </div>
  );
}
