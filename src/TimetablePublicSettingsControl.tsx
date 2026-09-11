import { useCallback, useEffect, useRef, useState } from "react";
import {
  getTimetablePublicSettings,
  updateTimetablePublicSettings,
  type TimetablePublicDisplaySettings,
} from "./api/timetablePublicSettings";

const DEFAULT_SETTINGS: TimetablePublicDisplaySettings = {
  showVisualPreview: false,
  showChangeAlerts: false,
};

export function TimetablePublicSettingsControl({
  accessToken,
  timetableId,
}: {
  accessToken: string;
  timetableId: string;
}) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const savingRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      setSettings(await getTimetablePublicSettings(accessToken, timetableId));
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not load public timetable settings.",
      );
    } finally {
      setLoading(false);
    }
  }, [accessToken, timetableId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  async function save(next: TimetablePublicDisplaySettings) {
    if (savingRef.current) return;
    const previous = settings;
    savingRef.current = true;
    setSaving(true);
    setMessage("");
    setSettings(next);
    try {
      const saved = await updateTimetablePublicSettings(
        accessToken,
        timetableId,
        next,
      );
      setSettings(saved);
      setMessage("Public display settings saved.");
    } catch (error) {
      setSettings(previous);
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not save public timetable settings.",
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <section
      className="pilot-surface"
      aria-labelledby="public-settings-heading"
    >
      <div className="pilot-surface-header">
        <div>
          <h2 id="public-settings-heading">Student display options</h2>
          <p>
            Optional public surfaces stay off unless the founder enables them
            for this timetable.
          </p>
        </div>
      </div>

      {loading ? (
        <p className="pilot-muted">Loading display settings...</p>
      ) : null}
      {!loading ? (
        <div className="timetable-public-settings-list">
          <label className="timetable-public-setting">
            <span>
              <strong>Visual timetable preview</strong>
              <small>
                Allow students to preview or download a static visual timetable.
              </small>
            </span>
            <input
              aria-label="Visual timetable preview"
              type="checkbox"
              checked={settings.showVisualPreview}
              disabled={saving}
              onChange={(event) =>
                void save({
                  ...settings,
                  showVisualPreview: event.target.checked,
                })
              }
            />
          </label>

          <label className="timetable-public-setting">
            <span>
              <strong>Browser change alerts</strong>
              <small>
                Show the optional browser-alert setup on this timetable.
              </small>
            </span>
            <input
              aria-label="Browser change alerts"
              type="checkbox"
              checked={settings.showChangeAlerts}
              disabled={saving}
              onChange={(event) =>
                void save({
                  ...settings,
                  showChangeAlerts: event.target.checked,
                })
              }
            />
          </label>
        </div>
      ) : null}

      {message ? (
        <p className="content-notice" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
