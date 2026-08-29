import { Button } from "@base-ui/react/button";
import { Input } from "@base-ui/react/input";
import { Select } from "@base-ui/react/select";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ExternalLink,
  Search,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  fetchPublishedTimetables,
  type PublishedTimetableSummary,
} from "./api/publicDiscovery";

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) =>
    a.localeCompare(b),
  );
}

function formatUpdated(value: string) {
  try {
    return new Intl.DateTimeFormat("en-ZW", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(value));
  } catch {
    return "Recently updated";
  }
}

function openPath(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function SelectField({
  label,
  placeholder,
  value,
  values,
  disabled = false,
  onValueChange,
}: {
  label: string;
  placeholder: string;
  value: string | null;
  values: string[];
  disabled?: boolean;
  onValueChange: (value: string | null) => void;
}) {
  const items = useMemo(
    () => values.map((item) => ({ value: item, label: item })),
    [values],
  );

  return (
    <Select.Root
      items={items}
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
    >
      <Select.Label className="czw-select-label">{label}</Select.Label>
      <Select.Trigger className="czw-select-trigger">
        <Select.Value className="czw-select-value" placeholder={placeholder} />
        <Select.Icon className="czw-select-icon">
          <ChevronDown size={17} aria-hidden="true" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner className="czw-select-positioner" sideOffset={6}>
          <Select.Popup className="czw-select-popup">
            <Select.List className="czw-select-list">
              {items.map((item) => (
                <Select.Item
                  className="czw-select-item"
                  key={item.value}
                  value={item.value}
                >
                  <Select.ItemIndicator className="czw-select-indicator">
                    <Check size={15} aria-hidden="true" />
                  </Select.ItemIndicator>
                  <Select.ItemText>{item.label}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

function TimetableThumbnail() {
  return (
    <div className="czw-timetable-thumbnail" aria-hidden="true">
      <div className="czw-thumb-topline">
        <span />
        <span />
      </div>
      <div className="czw-thumb-week">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index}>
            <i />
            <i />
            <i />
          </div>
        ))}
      </div>
    </div>
  );
}

function TimetableCard({ timetable }: { timetable: PublishedTimetableSummary }) {
  return (
    <article className="czw-discovery-card">
      <TimetableThumbnail />
      <div className="czw-discovery-card-body">
        <div className="czw-discovery-card-meta">
          <span className="czw-published-pill">
            <Check size={13} aria-hidden="true" /> Published
          </span>
          <small>Updated {formatUpdated(timetable.lastUpdated)}</small>
        </div>
        <p>{timetable.institutionName}</p>
        <h3>{timetable.programmeName}</h3>
        <div className="czw-discovery-details">
          <span>Class {timetable.classGroupLabel}</span>
          <span>{timetable.academicPeriodName}</span>
        </div>
        <a
          className="czw-card-link"
          href={`/t/${timetable.publicSlug}`}
          onClick={(event) => {
            event.preventDefault();
            openPath(`/t/${timetable.publicSlug}`);
          }}
        >
          View timetable <ArrowRight size={15} aria-hidden="true" />
        </a>
      </div>
    </article>
  );
}

export function FinderDiscovery() {
  const [timetables, setTimetables] = useState<PublishedTimetableSummary[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [institution, setInstitution] = useState<string | null>(null);
  const [programme, setProgramme] = useState<string | null>(null);
  const [classGroup, setClassGroup] = useState<string | null>(null);
  const [period, setPeriod] = useState<string | null>(null);
  const [sharedLink, setSharedLink] = useState("");
  const [linkError, setLinkError] = useState("");

  useEffect(() => {
    let active = true;
    fetchPublishedTimetables()
      .then((result) => {
        if (!active) return;
        setTimetables(result.timetables);
        setStatus("ready");
      })
      .catch(() => {
        if (!active) return;
        setStatus("error");
      });
    return () => {
      active = false;
    };
  }, []);

  const institutions = useMemo(
    () => unique(timetables.map((item) => item.institutionName)),
    [timetables],
  );

  const programmes = useMemo(
    () =>
      unique(
        timetables
          .filter((item) => item.institutionName === institution)
          .map((item) => item.programmeName),
      ),
    [institution, timetables],
  );

  const classes = useMemo(
    () =>
      unique(
        timetables
          .filter(
            (item) =>
              item.institutionName === institution &&
              item.programmeName === programme,
          )
          .map((item) => item.classGroupLabel),
      ),
    [institution, programme, timetables],
  );

  const periods = useMemo(
    () =>
      unique(
        timetables
          .filter(
            (item) =>
              item.institutionName === institution &&
              item.programmeName === programme &&
              item.classGroupLabel === classGroup,
          )
          .map((item) => item.academicPeriodName),
      ),
    [classGroup, institution, programme, timetables],
  );

  const selectedTimetable = useMemo(() => {
    if (!institution || !programme || !classGroup) return null;
    const candidates = timetables.filter(
      (item) =>
        item.institutionName === institution &&
        item.programmeName === programme &&
        item.classGroupLabel === classGroup,
    );
    if (period) {
      return (
        candidates.find((item) => item.academicPeriodName === period) ?? null
      );
    }
    return candidates.length === 1 ? candidates[0] : null;
  }, [classGroup, institution, period, programme, timetables]);

  function submitFinder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTimetable) return;
    openPath(`/t/${selectedTimetable.publicSlug}`);
  }

  function submitSharedLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLinkError("");
    const trimmed = sharedLink.trim();
    if (!trimmed) {
      setLinkError("Paste a CalenderZW timetable link or slug.");
      return;
    }

    let slug = trimmed.replace(/^\/?t\//, "");
    try {
      const parsed = new URL(trimmed);
      const match = parsed.pathname.match(/^\/t\/([^/]+)$/);
      if (!match) {
        setLinkError("That link does not look like a CalenderZW timetable link.");
        return;
      }
      slug = decodeURIComponent(match[1]);
    } catch {
      // A plain public slug is supported as a compact fallback.
    }

    if (!slug || slug.includes("/") || slug.includes(" ")) {
      setLinkError("Enter the final timetable slug or a full /t/ link.");
      return;
    }
    openPath(`/t/${encodeURIComponent(slug)}`);
  }

  return (
    <div className="czw-finder-experience">
      <section className="czw-finder-card" aria-labelledby="finder-card-title">
        <div className="czw-finder-card-heading">
          <span className="czw-finder-icon" aria-hidden="true">
            <Search size={18} />
          </span>
          <div>
            <h2 id="finder-card-title">Choose your class</h2>
            <p>We only show timetables that are already published.</p>
          </div>
        </div>

        {status === "loading" ? (
          <div className="czw-finder-loading" role="status">
            <span />
            <span />
            <span />
            <p>Loading published timetables…</p>
          </div>
        ) : null}

        {status === "error" ? (
          <div className="czw-finder-error" role="alert">
            <strong>We couldn’t load the timetable directory.</strong>
            <p>You can still open a shared class link below.</p>
          </div>
        ) : null}

        {status === "ready" && timetables.length === 0 ? (
          <div className="czw-finder-empty">
            <strong>No published timetables are listed yet.</strong>
            <p>
              If your class already has a direct CalenderZW link, open it below.
              Otherwise your class representative can help set one up.
            </p>
            <a href="/admin/login">Set up a class →</a>
          </div>
        ) : null}

        {status === "ready" && timetables.length > 0 ? (
          <form className="czw-finder-form" onSubmit={submitFinder}>
            <SelectField
              label="Institution"
              placeholder="Choose your university"
              value={institution}
              values={institutions}
              onValueChange={(value) => {
                setInstitution(value);
                setProgramme(null);
                setClassGroup(null);
                setPeriod(null);
              }}
            />
            <SelectField
              label="Programme"
              placeholder="Choose your programme"
              value={programme}
              values={programmes}
              disabled={!institution}
              onValueChange={(value) => {
                setProgramme(value);
                setClassGroup(null);
                setPeriod(null);
              }}
            />
            <div className="czw-finder-two-col">
              <SelectField
                label="Class"
                placeholder="Choose your class"
                value={classGroup}
                values={classes}
                disabled={!programme}
                onValueChange={(value) => {
                  setClassGroup(value);
                  setPeriod(null);
                }}
              />
              <SelectField
                label="Academic period"
                placeholder={
                  periods.length <= 1 ? "Current period" : "Choose period"
                }
                value={period}
                values={periods}
                disabled={!classGroup || periods.length <= 1}
                onValueChange={setPeriod}
              />
            </div>
            <Button
              className="czw-button czw-button-primary czw-finder-submit"
              type="submit"
              disabled={!selectedTimetable}
              focusableWhenDisabled
            >
              View timetable <ArrowRight size={17} aria-hidden="true" />
            </Button>
          </form>
        ) : null}

        <div className="czw-finder-divider"><span>or open a shared class link</span></div>
        <form className="czw-shared-link-form" onSubmit={submitSharedLink}>
          <label htmlFor="czw-shared-timetable-link">Timetable link or slug</label>
          <div>
            <Input
              id="czw-shared-timetable-link"
              value={sharedLink}
              onChange={(event) => setSharedLink(event.target.value)}
              placeholder="calender.aido.co.zw/t/…"
              aria-describedby={linkError ? "czw-link-error" : undefined}
            />
            <Button type="submit" className="czw-link-open-button">
              <ExternalLink size={17} aria-hidden="true" />
              <span>Open</span>
            </Button>
          </div>
          {linkError ? <p id="czw-link-error" role="alert">{linkError}</p> : null}
        </form>
      </section>

      {status === "ready" && timetables.length > 0 ? (
        <section className="czw-available-section" aria-labelledby="available-title">
          <div className="czw-available-heading">
            <div>
              <span className="czw-kicker">Available now</span>
              <h2 id="available-title">Published timetables</h2>
            </div>
            <span>{timetables.length} available</span>
          </div>
          <div className="czw-discovery-grid">
            {timetables.map((timetable) => (
              <TimetableCard key={timetable.publicSlug} timetable={timetable} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
