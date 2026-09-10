import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

export function FinderDemandPrompt() {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    setTarget(
      document.querySelector<HTMLElement>(".czw-finder-wrap > .czw-shell"),
    );
  }, []);

  if (!target) return null;

  return createPortal(
    <aside className="czw-finder-demand-prompt" aria-label="Missing timetable">
      <div>
        <strong>Can’t find your class?</strong>
        <span>
          Tell us what is missing. Class Rep or source access helps us publish
          faster.
        </span>
      </div>
      <a className="czw-button czw-button-secondary" href="/request">
        Request timetable
      </a>
    </aside>,
    target,
  );
}
