export function FinderDemandPrompt() {
  return (
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
    </aside>
  );
}
