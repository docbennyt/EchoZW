import { Unplug } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export function GoogleCalendarDisconnectEntry() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const search = new URLSearchParams(window.location.search);
  const connected = search.get("calendar") === "google-success";
  const subscriptionId = search.get("subscriptionId");

  useEffect(() => {
    if (!connected || !subscriptionId) return;
    const findTarget = () => {
      const nextTarget = document.querySelector<HTMLElement>(
        ".pt-primary-actions",
      );
      if (nextTarget) setTarget(nextTarget);
    };
    findTarget();
    const observer = new MutationObserver(findTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [connected, subscriptionId]);

  if (!connected || !subscriptionId || !target) return null;

  async function disconnect() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/calendar/google/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscriptionId,
          deleteCreatedCalendar: false,
        }),
      });
      const body = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(
          body.error?.message ?? "Google Calendar could not be disconnected.",
        );
      }
      const url = new URL(window.location.href);
      url.searchParams.set("calendar", "google-disconnected");
      url.searchParams.delete("subscriptionId");
      window.location.replace(url.toString());
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Google Calendar could not be disconnected.",
      );
      setBusy(false);
    }
  }

  return createPortal(
    <>
      <button
        type="button"
        className="pt-button pt-button-secondary gcal-disconnect"
        disabled={busy}
        onClick={() => void disconnect()}
      >
        <Unplug size={18} aria-hidden="true" />
        {busy ? "Disconnecting…" : "Disconnect Google Calendar"}
      </button>
      {error ? (
        <p className="gcal-inline-error" role="alert">
          {error}
        </p>
      ) : null}
    </>,
    target,
  );
}
