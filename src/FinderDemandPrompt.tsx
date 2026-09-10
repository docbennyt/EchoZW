import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export function FinderDemandPrompt() {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const finderShell = document.querySelector<HTMLElement>(
      ".czw-finder-wrap .czw-shell",
    );
    setTarget(finderShell);
  }, []);

  if (!target) return null;

  return createPortal(
    <aside
      className="czw-finder-demand-prompt"
      aria-label="Missing timetable"
      style={{
        position: "relative",
        inset: "auto",
        zIndex: "auto",
        width: "100%",
        marginTop: "clamp(28px, 5vw, 48px)",
        marginBottom: "max(28px, env(safe-area-inset-bottom))",
        padding: "clamp(18px, 3vw, 24px)",
        border: "1px solid var(--czw-line)",
        borderRadius: "var(--czw-radius-md)",
        background: "var(--czw-white)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: "16px",
        boxShadow: "0 14px 40px rgba(21, 61, 50, 0.08)",
      }}
    >
      <div style={{ minWidth: 0, flex: "1 1 280px" }}>
        <strong style={{ display: "block", marginBottom: "6px" }}>
          Can’t find your class?
        </strong>
        <span
          style={{
            display: "block",
            color: "var(--czw-muted)",
            fontSize: "13px",
            lineHeight: 1.55,
          }}
        >
          Tell us what is missing. Class Rep or source access helps us publish
          faster.
        </span>
      </div>
      <a
        className="czw-button czw-button-secondary"
        href="/request"
        style={{ minHeight: "48px", flex: "0 0 auto" }}
      >
        Request timetable
      </a>
    </aside>,
    target,
  );
}
