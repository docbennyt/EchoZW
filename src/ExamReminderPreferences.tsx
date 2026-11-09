import { useEffect, useState } from "react";

type Preference = { id: string; provider: string; offsets: number[] };
const providerName: Record<string, string> = {
  google_api: "Google Calendar",
  apple_subscription: "Apple Calendar",
  webcal_subscription: "WebCal",
  outlook_subscription: "Outlook",
  ics_download: "Calendar download",
};

export function ExamReminderPreferences({
  timetableId,
}: {
  timetableId: string;
}) {
  const [subscriptions, setSubscriptions] = useState<Preference[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(
      "/api/calendar/subscriptions/exam-reminders?timetableId=" +
        encodeURIComponent(timetableId),
      {
        signal: controller.signal,
      },
    )
      .then(async (response) => {
        if (!response.ok) {
          if (response.status >= 500) setLoadError(true);
          return;
        }
        const body = (await response.json()) as { subscriptions: Preference[] };
        setSubscriptions(body.subscriptions);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [timetableId]);

  async function save(subscription: Preference, enable: boolean) {
    setBusy(subscription.id);
    setError("");
    setMessage("");
    try {
      const response = await fetch(
        "/api/calendar/subscriptions/exam-reminders",
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            subscriptionId: subscription.id,
            offsets: enable ? [60, 30] : [],
            consent: enable,
          }),
        },
      );
      const body = (await response.json()) as {
        offsets: number[];
        error?: { message?: string };
      };
      if (!response.ok)
        throw new Error(
          body.error?.message ?? "Examination reminders could not be saved.",
        );
      setSubscriptions((current) =>
        current.map((row) =>
          row.id === subscription.id ? { ...row, offsets: body.offsets } : row,
        ),
      );
      setMessage(
        enable
          ? "Examination reminders saved. Your calendar must sync to receive them."
          : "Examination reminders turned off.",
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Examination reminders could not be saved.",
      );
    } finally {
      setBusy(null);
    }
  }

  if (!subscriptions.length)
    return loadError ? (
      <p className="pt-helper" role="status">
        Examination reminder settings are temporarily unavailable.
      </p>
    ) : null;
  return (
    <section aria-label="Examination reminder settings">
      <h3>Examination reminders</h3>
      <p className="pt-helper">
        Choose reminders one hour and 30 minutes before each future exam. Your
        device controls notification permissions and sound.
      </p>
      {subscriptions.map((subscription) => (
        <div key={subscription.id}>
          <p>
            <strong>
              {providerName[subscription.provider] ?? "Connected calendar"}
            </strong>{" "}
            ·{" "}
            {subscription.offsets.length
              ? subscription.offsets.join(" and ") + " minutes before exams"
              : "Exam reminders off"}
          </p>
          <button
            type="button"
            className="pt-button pt-button-secondary"
            disabled={busy !== null}
            onClick={() =>
              void save(subscription, !subscription.offsets.length)
            }
          >
            {busy === subscription.id
              ? "Saving…"
              : subscription.offsets.length
                ? "Turn off exam reminders"
                : "Enable 60 and 30 minute exam reminders"}
          </button>
        </div>
      ))}
      <p className="pt-helper">
        Apple and WebCal apply changes when the subscribed calendar refreshes.
        Downloaded files need a fresh import.
      </p>
      {message ? <p role="status">{message}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
