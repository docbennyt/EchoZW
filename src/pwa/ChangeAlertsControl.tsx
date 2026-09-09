import "./changeAlertsControl.css";
import { Bell, BellOff, LoaderCircle, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { track } from "../analytics";
import { getInstallCapability } from "./installCapability";
import {
  disableTimetableChangeAlerts,
  enableTimetableChangeAlerts,
  getTimetableChangeAlertStatus,
  type ChangeAlertStatus,
} from "./pushAlerts";

export function ChangeAlertsControl({ publicSlug }: { publicSlug: string }) {
  const [status, setStatus] = useState<ChangeAlertStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    void getTimetableChangeAlertStatus(publicSlug).then((next) => {
      if (active) setStatus(next);
    });
    return () => {
      active = false;
    };
  }, [publicSlug]);

  async function enable() {
    setBusy(true);
    setMessage("");
    track("push_alert_cta_clicked", { publicSlug, mode: "enable" });
    try {
      const result = await enableTimetableChangeAlerts(publicSlug);
      if (result === "enabled") {
        setStatus({ enabled: true, permission: "granted", supported: true });
        setMessage("Urgent timetable change alerts are on for this class.");
        track("push_alert_enabled", { publicSlug });
      } else if (result === "permission_denied") {
        setStatus({ enabled: false, permission: "denied", supported: true });
        setMessage("Notifications are blocked in your browser settings.");
        track("push_alert_permission_denied", { publicSlug });
      } else if (result === "provider_unavailable") {
        setMessage(
          "Change alerts are temporarily unavailable. Your timetable still works normally.",
        );
      } else {
        setMessage("This browser cannot enable change alerts here.");
      }
    } catch {
      setMessage(
        "We could not enable alerts just now. Your timetable is unchanged.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setMessage("");
    try {
      await disableTimetableChangeAlerts(publicSlug);
      setStatus((current) => ({
        enabled: false,
        permission: current?.permission ?? "default",
        supported: current?.supported ?? true,
      }));
      setMessage("Change alerts are off for this class.");
      track("push_alert_disabled", { publicSlug });
    } catch {
      setMessage(
        "We could not change that setting just now. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!status) {
    return (
      <section
        className="pt-alert-card"
        aria-label="Urgent timetable change alerts"
      >
        <div className="pt-alert-icon" aria-hidden="true">
          <LoaderCircle size={18} />
        </div>
        <div>
          <strong>Urgent change alerts</strong>
          <p>Checking whether this device can receive timetable changes.</p>
        </div>
      </section>
    );
  }

  if (!status.supported) {
    const installCapability = getInstallCapability();
    const iosInstallNeeded = installCapability === "ios_manual";
    return (
      <section
        className="pt-alert-card"
        aria-label="Urgent timetable change alerts"
      >
        <div className="pt-alert-icon" aria-hidden="true">
          <BellOff size={18} />
        </div>
        <div>
          <strong>Urgent change alerts</strong>
          <p>
            {iosInstallNeeded
              ? "On iPhone, add CalenderZW to your Home Screen from Safari first. Then open the installed app to enable notifications."
              : "Push notifications are not available in this browser. Your live timetable and calendar subscription still work normally."}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section
      className="pt-alert-card"
      aria-label="Urgent timetable change alerts"
    >
      <div className="pt-alert-icon" aria-hidden="true">
        {status.enabled ? <ShieldCheck size={18} /> : <Bell size={18} />}
      </div>
      <div className="pt-alert-copy">
        <strong>
          {status.enabled ? "Change alerts are on" : "Get urgent change alerts"}
        </strong>
        <p>
          {status.enabled
            ? "This browser is opted in for urgent changes to this class timetable."
            : "Optional browser notifications for cancellations, moved classes, time or venue changes, and other published updates."}
        </p>
        <small>
          Alerts are timetable-specific. Turning them off here does not disable
          alerts for another class on the same device.
        </small>
        {message ? (
          <span className="pt-status-message" role="status">
            {message}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        className={`pt-button ${status.enabled ? "pt-button-secondary" : "pt-button-primary"}`}
        disabled={busy || status.permission === "denied"}
        onClick={() => void (status.enabled ? disable() : enable())}
      >
        {busy ? "Working…" : status.enabled ? "Turn off" : "Enable alerts"}
      </button>
    </section>
  );
}
