from __future__ import annotations

import base64
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text()
    if old not in text:
        raise RuntimeError(f"Expected block not found in {path}: {old[:80]!r}")
    if text.count(old) != 1:
        raise RuntimeError(f"Expected exactly one match in {path}, found {text.count(old)}")
    target.write_text(text.replace(old, new, 1))


finder = r'''import { Button } from "@base-ui/react/button";
import { Input } from "@base-ui/react/input";
import { Select } from "@base-ui/react/select";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Grid2X2,
  List,
  Search,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  fetchPublishedTimetables,
  type PublishedTimetableSummary,
} from "./api/publicDiscovery";
import { chooseAcademicPeriod } from "./domain/finderPeriodSelection";

const SORT_OPTIONS = [
  "Recently updated",
  "Institution A–Z",
  "Programme A–Z",
] as const;

type SortOption = (typeof SORT_OPTIONS)[number];
type ViewMode = "grid" | "list";
type FinderStatus = "loading" | "ready" | "error";

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

function useDesktopDirectory() {
  const query = "(min-width: 1024px)";
  const [isDesktop, setIsDesktop] = useState(
    () =>
      typeof window.matchMedia === "function" && window.matchMedia(query).matches,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(query);
    const update = () => setIsDesktop(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  return isDesktop;
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
  values: readonly string[];
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

function FinderLoadState({
  status,
  timetableCount,
}: {
  status: FinderStatus;
  timetableCount: number;
}) {
  if (status === "loading") {
    return (
      <div className="czw-finder-loading" role="status">
        <span />
        <span />
        <span />
        <p>Loading published timetables…</p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="czw-finder-error" role="alert">
        <strong>We couldn’t load published timetables.</strong>
        <p>Refresh and try again. Draft timetables are never shown here.</p>
      </div>
    );
  }

  if (timetableCount === 0) {
    return (
      <div className="czw-finder-empty">
        <strong>No published timetables are listed yet.</strong>
        <p>Tell us what class you need and we’ll use it to prioritise coverage.</p>
        <a href="/request">Request timetable →</a>
      </div>
    );
  }

  return null;
}

function MissingClassPrompt({ compact = false }: { compact?: boolean }) {
  return (
    <aside
      className={`czw-finder-demand-prompt czw-finder-demand-inline${compact ? " is-compact" : ""}`}
      aria-label="Missing timetable"
    >
      <div>
        <strong>Can’t find your class?</strong>
        <span>Tell us what’s missing and we’ll use it to prioritise coverage.</span>
      </div>
      <a className="czw-button czw-button-secondary" href="/request">
        Request timetable
      </a>
    </aside>
  );
}

function ExactFinder({
  timetables,
  status,
}: {
  timetables: PublishedTimetableSummary[];
  status: FinderStatus;
}) {
  const [institution, setInstitution] = useState<string | null>(null);
  const [programme, setProgramme] = useState<string | null>(null);
  const [classGroup, setClassGroup] = useState<string | null>(null);
  const [period, setPeriod] = useState<string | null>(null);
  const [referenceNow] = useState(() => new Date());

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
  const candidates = useMemo(
    () =>
      timetables.filter(
        (item) =>
          item.institutionName === institution &&
          item.programmeName === programme &&
          item.classGroupLabel === classGroup,
      ),
    [classGroup, institution, programme, timetables],
  );
  const periods = useMemo(
    () => unique(candidates.map((item) => item.academicPeriodName)),
    [candidates],
  );
  const preferredPeriod = useMemo(
    () => chooseAcademicPeriod(candidates, referenceNow),
    [candidates, referenceNow],
  );
  const effectivePeriod = period ?? preferredPeriod.selectedPeriodName;

  const selectedTimetable = useMemo(() => {
    if (effectivePeriod) {
      return (
        candidates.find(
          (item) => item.academicPeriodName === effectivePeriod,
        ) ?? null
      );
    }
    return candidates.length === 1 ? candidates[0] : null;
  }, [candidates, effectivePeriod]);

  const periodNote = useMemo(() => {
    if (!classGroup || candidates.length === 0) return null;
    if (preferredPeriod.reason === "overlap") {
      return "More than one published period includes today. Choose the one your class is using.";
    }
    if (preferredPeriod.reason === "ambiguous") {
      return "No published period includes today. Choose your class period.";
    }
    return null;
  }, [candidates.length, classGroup, preferredPeriod.reason]);

  function submitFinder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTimetable) return;
    openPath(`/t/${selectedTimetable.publicSlug}`);
  }

  return (
    <section className="czw-finder-card" aria-label="Find your exact class">
      <FinderLoadState status={status} timetableCount={timetables.length} />

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
          <div>
            <SelectField
              label="Academic period"
              placeholder="Choose academic period"
              value={effectivePeriod}
              values={periods}
              disabled={!classGroup || periods.length <= 1}
              onValueChange={setPeriod}
            />
            {periodNote ? (
              <p className="czw-period-note" role="status">
                {periodNote}
              </p>
            ) : null}
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
    </section>
  );
}

function thumbnailTone(value: string) {
  return Array.from(value).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 4;
}

function TimetableThumbnail({ timetable }: { timetable: PublishedTimetableSummary }) {
  return (
    <div
      className="czw-timetable-thumbnail"
      data-tone={thumbnailTone(timetable.programmeName)}
      aria-hidden="true"
    >
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

function TimetableCard({
  timetable,
  viewMode = "grid",
}: {
  timetable: PublishedTimetableSummary;
  viewMode?: ViewMode;
}) {
  return (
    <article className="czw-discovery-card" data-view={viewMode}>
      <TimetableThumbnail timetable={timetable} />
      <div className="czw-discovery-card-body">
        <div className="czw-discovery-card-meta czw-discovery-card-meta-simple">
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

function DesktopDirectory({
  timetables,
}: {
  timetables: PublishedTimetableSummary[];
}) {
  const [browseInstitution, setBrowseInstitution] = useState<string | null>(null);
  const [browseProgramme, setBrowseProgramme] = useState<string | null>(null);
  const [browseClass, setBrowseClass] = useState<string | null>(null);
  const [browsePeriod, setBrowsePeriod] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("Recently updated");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");

  const institutions = useMemo(
    () => unique(timetables.map((item) => item.institutionName)),
    [timetables],
  );
  const browseProgrammes = useMemo(
    () =>
      unique(
        timetables
          .filter(
            (item) =>
              !browseInstitution || item.institutionName === browseInstitution,
          )
          .map((item) => item.programmeName),
      ),
    [browseInstitution, timetables],
  );
  const browseClasses = useMemo(
    () =>
      unique(
        timetables
          .filter(
            (item) =>
              (!browseInstitution || item.institutionName === browseInstitution) &&
              (!browseProgramme || item.programmeName === browseProgramme),
          )
          .map((item) => item.classGroupLabel),
      ),
    [browseInstitution, browseProgramme, timetables],
  );
  const browsePeriods = useMemo(
    () =>
      unique(
        timetables
          .filter(
            (item) =>
              (!browseInstitution || item.institutionName === browseInstitution) &&
              (!browseProgramme || item.programmeName === browseProgramme) &&
              (!browseClass || item.classGroupLabel === browseClass),
          )
          .map((item) => item.academicPeriodName),
      ),
    [browseClass, browseInstitution, browseProgramme, timetables],
  );

  const filteredTimetables = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const filtered = timetables.filter((item) => {
      if (browseInstitution && item.institutionName !== browseInstitution) return false;
      if (browseProgramme && item.programmeName !== browseProgramme) return false;
      if (browseClass && item.classGroupLabel !== browseClass) return false;
      if (browsePeriod && item.academicPeriodName !== browsePeriod) return false;
      if (!normalizedQuery) return true;
      return [
        item.institutionName,
        item.programmeName,
        item.classGroupLabel,
        item.academicPeriodName,
      ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
    });

    return [...filtered].sort((left, right) => {
      if (sortBy === "Institution A–Z") {
        return (
          left.institutionName.localeCompare(right.institutionName) ||
          left.programmeName.localeCompare(right.programmeName) ||
          left.classGroupLabel.localeCompare(right.classGroupLabel)
        );
      }
      if (sortBy === "Programme A–Z") {
        return (
          left.programmeName.localeCompare(right.programmeName) ||
          left.institutionName.localeCompare(right.institutionName) ||
          left.classGroupLabel.localeCompare(right.classGroupLabel)
        );
      }
      return new Date(right.lastUpdated).getTime() - new Date(left.lastUpdated).getTime();
    });
  }, [browseClass, browseInstitution, browsePeriod, browseProgramme, query, sortBy, timetables]);

  const hasFilters = Boolean(
    browseInstitution || browseProgramme || browseClass || browsePeriod || query,
  );

  function setDirectoryInstitution(value: string | null) {
    setBrowseInstitution(value);
    setBrowseProgramme(null);
    setBrowseClass(null);
    setBrowsePeriod(null);
  }

  function setDirectoryProgramme(value: string | null) {
    setBrowseProgramme(value);
    setBrowseClass(null);
    setBrowsePeriod(null);
  }

  function clearFilters() {
    setBrowseInstitution(null);
    setBrowseProgramme(null);
    setBrowseClass(null);
    setBrowsePeriod(null);
    setQuery("");
  }

  return (
    <section className="czw-directory-desktop czw-directory-unified" aria-label="Published timetable directory">
      <div className="czw-directory-search-row czw-directory-search-row-unified">
        <div className="czw-directory-search-box">
          <Search size={18} aria-hidden="true" />
          <Input
            aria-label="Search published timetables"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search university, programme, class or academic period"
          />
          {query ? (
            <Button
              type="button"
              className="czw-directory-clear-search"
              aria-label="Clear search"
              onClick={() => setQuery("")}
            >
              <X size={16} aria-hidden="true" />
            </Button>
          ) : null}
        </div>
        {hasFilters ? (
          <Button type="button" className="czw-directory-reset czw-directory-reset-top" onClick={clearFilters}>
            Clear filters
          </Button>
        ) : null}
      </div>

      <div className="czw-directory-filter-bar" aria-label="Timetable filters">
        <SelectField
          label="Institution"
          placeholder="All institutions"
          value={browseInstitution}
          values={institutions}
          onValueChange={setDirectoryInstitution}
        />
        <SelectField
          label="Programme"
          placeholder="All programmes"
          value={browseProgramme}
          values={browseProgrammes}
          onValueChange={setDirectoryProgramme}
        />
        <SelectField
          label="Class"
          placeholder="All classes"
          value={browseClass}
          values={browseClasses}
          onValueChange={(value) => {
            setBrowseClass(value);
            setBrowsePeriod(null);
          }}
        />
        <SelectField
          label="Academic period"
          placeholder="All periods"
          value={browsePeriod}
          values={browsePeriods}
          onValueChange={setBrowsePeriod}
        />
      </div>

      <div className="czw-directory-toolbar czw-directory-toolbar-unified">
        <div className="czw-directory-result-count" aria-live="polite">
          <strong>{filteredTimetables.length}</strong>
          <span>{filteredTimetables.length === 1 ? " timetable" : " timetables"}</span>
        </div>
        <div className="czw-directory-toolbar-actions">
          <div className="czw-directory-sort">
            <SelectField
              label="Sort"
              placeholder="Recently updated"
              value={sortBy}
              values={SORT_OPTIONS}
              onValueChange={(value) =>
                setSortBy((value as SortOption | null) ?? "Recently updated")
              }
            />
          </div>
          <div className="czw-directory-view-toggle" aria-label="Result view">
            <Button
              type="button"
              aria-label="Grid view"
              aria-pressed={viewMode === "grid"}
              onClick={() => setViewMode("grid")}
            >
              <Grid2X2 size={16} aria-hidden="true" />
            </Button>
            <Button
              type="button"
              aria-label="List view"
              aria-pressed={viewMode === "list"}
              onClick={() => setViewMode("list")}
            >
              <List size={17} aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>

      {filteredTimetables.length > 0 ? (
        <div className="czw-discovery-grid" data-view={viewMode} aria-live="polite">
          {filteredTimetables.map((timetable) => (
            <TimetableCard
              key={timetable.publicSlug}
              timetable={timetable}
              viewMode={viewMode}
            />
          ))}
        </div>
      ) : (
        <div className="czw-directory-no-results" role="status">
          <Search size={22} aria-hidden="true" />
          <strong>No timetables match those filters.</strong>
          <p>Clear a filter or try another programme, class or period.</p>
          <Button
            type="button"
            className="czw-button czw-button-secondary"
            onClick={clearFilters}
          >
            Clear filters
          </Button>
        </div>
      )}

      <MissingClassPrompt compact />
    </section>
  );
}

export function FinderDiscovery() {
  const isDesktop = useDesktopDirectory();
  const [timetables, setTimetables] = useState<PublishedTimetableSummary[]>([]);
  const [status, setStatus] = useState<FinderStatus>("loading");

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

  if (isDesktop) {
    return (
      <div className="czw-finder-experience czw-finder-desktop" data-mode="directory">
        <FinderLoadState status={status} timetableCount={timetables.length} />
        {status === "ready" && timetables.length > 0 ? (
          <DesktopDirectory timetables={timetables} />
        ) : null}
      </div>
    );
  }

  return (
    <div className="czw-finder-experience czw-finder-mobile" data-mode="exact">
      <ExactFinder timetables={timetables} status={status} />
      {status === "ready" && timetables.length > 0 ? <MissingClassPrompt /> : null}
    </div>
  );
}
'''
(ROOT / "src/FinderDiscovery.tsx").write_text(finder)

replace_once(
    "src/AppV2.tsx",
    '''            <p>\n              Choose your institution, programme and class. No student account\n              needed.\n            </p>\n            <span className="czw-trust-note">\n              <Check size={14} /> Published class timetables only\n            </span>''',
    '''            <p>\n              <span className="czw-finder-mobile-copy">\n                Choose your institution, programme and class.\n              </span>\n              <span className="czw-finder-desktop-copy">\n                Search or filter published class timetables.\n              </span>{" "}\n              No student account needed.\n            </p>''',
)

replace_once(
    "src/main.tsx",
    'import { FinderDemandPrompt } from "./FinderDemandPrompt";\n',
    "",
)
replace_once(
    "src/main.tsx",
    '      {path === "/find" || path === "/find/" ? <FinderDemandPrompt /> : null}\n',
    "",
)

production = ROOT / "src/ProductionUxEnhancements.tsx"
text = production.read_text()
text = text.replace("  UserRound,\n", "")
start = text.index("function PilotSocialProof()")
end = text.index("\nfunction StepVisual", start)
proof = '''function PilotSocialProof() {\n  return (\n    <div\n      className="czw-pilot-proof"\n      aria-label="Current CalenderZW pilot activity"\n    >\n      <div className="czw-avatar-stack" aria-hidden="true">\n        <span className="czw-proof-avatar czw-proof-photo">\n          <img src="/student-avatar-1.webp" alt="" />\n        </span>\n        <span className="czw-proof-avatar czw-proof-photo">\n          <img src="/student-avatar-2.webp" alt="" />\n        </span>\n        <span className="czw-proof-avatar czw-proof-hit">\n          <img src="/hit-mark.webp" alt="" />\n        </span>\n        <span className="czw-proof-avatar czw-proof-more">+15</span>\n      </div>\n      <div>\n        <strong>18+ active calendar connections</strong>\n        <span>Students across HIT and other institutions, growing through class links.</span>\n      </div>\n    </div>\n  );\n}\n'''
production.write_text(text[:start] + proof + text[end:])

css = ROOT / "src/productionUxEnhancements.css"
text = css.read_text()
start = text.index("/* Truthful, high-signal social proof")
end = text.index("/* Make How it works", start)
proof_css = r'''/* Truthful, high-signal social proof: activity count plus clearly decorative identities. */
.czw-pilot-proof {
  margin-top: 22px;
  width: min(100%, 520px);
  padding: 13px 16px 13px 13px;
  border: 1px solid rgba(21, 61, 50, 0.13);
  border-radius: 16px;
  display: flex;
  align-items: center;
  gap: 15px;
  background: rgba(255, 254, 250, 0.92);
  box-shadow: 0 12px 34px rgba(21, 61, 50, 0.08);
}

.czw-avatar-stack {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  padding-left: 2px;
}

.czw-proof-avatar {
  width: 38px;
  height: 38px;
  margin-left: -9px;
  border: 2px solid var(--czw-white);
  border-radius: 50%;
  display: grid;
  place-items: center;
  overflow: hidden;
  background: var(--czw-sage-soft);
  color: var(--czw-forest);
  box-shadow: 0 4px 12px rgba(21, 61, 50, 0.12);
}

.czw-proof-avatar:first-child {
  margin-left: 0;
}

.czw-proof-avatar img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.czw-proof-hit {
  background: #fff;
}

.czw-proof-hit img {
  object-fit: contain;
}

.czw-proof-more {
  background: var(--czw-forest);
  color: #fff;
  font-size: 12px;
  font-weight: 850;
  letter-spacing: -0.02em;
}

.czw-pilot-proof > div:last-child {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.czw-pilot-proof strong {
  color: var(--czw-ink);
  font-size: 13px;
  line-height: 1.25;
}

.czw-pilot-proof > div:last-child span {
  color: var(--czw-muted);
  font-size: 10px;
  line-height: 1.45;
}

'''
css.write_text(text[:start] + proof_css + text[end:])

# Append final responsive finder and mobile-hero rules after legacy finder styles.
finder_css = ROOT / "src/finderDiscovery.css"
text = finder_css.read_text()
marker = "/* DR-66 follow-up: device-intent finder split. */"
if marker in text:
    text = text[: text.index(marker)].rstrip() + "\n"
text += r'''

/* DR-66 follow-up: device-intent finder split. */
.czw-finder-mobile-copy {
  display: inline;
}

.czw-finder-desktop-copy {
  display: none;
}

.czw-finder-mobile {
  gap: 14px;
}

.czw-finder-mobile .czw-finder-card {
  max-width: 620px;
  margin-inline: auto;
  padding: clamp(18px, 5vw, 24px);
}

.czw-finder-mobile .czw-finder-form {
  gap: 14px;
}

.czw-finder-demand-inline {
  margin-top: 0;
}

.czw-directory-unified {
  margin-top: 0;
  padding: 0;
  border: 0;
  background: transparent;
}

.czw-directory-search-row-unified {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 0;
  border: 0;
  background: transparent;
}

.czw-directory-search-row-unified .czw-directory-search-box {
  min-height: 54px;
  border-radius: 12px;
  background: var(--czw-white);
  box-shadow: 0 8px 26px rgba(21, 61, 50, 0.06);
}

.czw-directory-reset-top {
  min-height: 44px;
  padding-inline: 13px;
  border: 1px solid var(--czw-line);
  border-radius: 9px;
  background: var(--czw-white);
  color: var(--czw-forest);
  font: inherit;
  font-size: 11px;
  font-weight: 800;
  cursor: pointer;
}

.czw-directory-filter-bar {
  margin-top: 12px;
  padding: 15px;
  border: 1px solid var(--czw-line);
  border-radius: 14px;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  background: rgba(255, 254, 250, 0.74);
}

.czw-directory-filter-bar .czw-select-trigger {
  min-height: 46px;
  background: #fff;
}

.czw-directory-toolbar-unified {
  margin: 18px 0 12px;
  padding: 0;
  border: 0;
  background: transparent;
}

.czw-directory-result-count {
  display: flex;
  align-items: baseline;
  gap: 5px;
  color: var(--czw-muted);
  font-size: 12px;
}

.czw-directory-result-count strong {
  color: var(--czw-ink);
  font-size: 18px;
  letter-spacing: -0.04em;
}

.czw-discovery-card-meta-simple {
  justify-content: flex-end;
  margin-bottom: 10px;
}

.czw-timetable-thumbnail[data-tone="1"] {
  background-color: #eef2e8;
}

.czw-timetable-thumbnail[data-tone="2"] {
  background-color: #f4efe2;
}

.czw-timetable-thumbnail[data-tone="3"] {
  background-color: #e9f0ed;
}

.czw-directory-unified .czw-finder-demand-inline {
  margin-top: 16px;
}

@media (min-width: 1024px) {
  .czw-finder-mobile-copy {
    display: none;
  }

  .czw-finder-desktop-copy {
    display: inline;
  }

  .czw-finder-wrap .czw-product-intro {
    max-width: none;
    margin: 0 0 20px;
  }

  .czw-finder-wrap .czw-product-intro h1 {
    margin-bottom: 9px;
  }

  .czw-finder-desktop {
    display: block;
  }

  .czw-finder-desktop > .czw-finder-loading,
  .czw-finder-desktop > .czw-finder-error,
  .czw-finder-desktop > .czw-finder-empty {
    max-width: 720px;
  }

  .czw-directory-unified .czw-discovery-grid[data-view="grid"] {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 1023px) {
  .czw-finder-wrap .czw-product-page,
  .czw-finder-wrap {
    min-height: auto;
  }

  .czw-finder-wrap .czw-product-intro {
    margin-bottom: 18px;
  }

  .czw-finder-wrap .czw-product-intro .czw-eyebrow {
    display: none;
  }

  .czw-finder-wrap .czw-product-intro h1 {
    margin-top: 0;
  }

  .czw-finder-demand-inline {
    max-width: 620px;
    margin-inline: auto;
  }
}

@media (max-width: 640px) {
  .czw-finder-wrap .czw-product-page,
  .czw-finder-wrap {
    padding-bottom: 34px;
  }

  .czw-finder-mobile .czw-finder-card {
    padding: 18px;
    border-radius: 15px;
  }

  .czw-finder-demand-inline {
    padding: 4px 2px 0;
    border: 0;
    box-shadow: none;
    background: transparent;
    text-align: left;
  }

  .czw-finder-demand-inline > div span {
    display: none;
  }

  .czw-finder-demand-inline .czw-button {
    min-height: 44px;
    padding: 0;
    border: 0;
    background: transparent;
    box-shadow: none;
    color: var(--czw-forest) !important;
    justify-content: flex-start;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
}
'''
finder_css.write_text(text)

app_css = ROOT / "src/appV2.css"
text = app_css.read_text()
marker = "/* Homepage conversion proof follow-up. */"
if marker in text:
    text = text[: text.index(marker)].rstrip() + "\n"
text += r'''

/* Homepage conversion proof follow-up. */
@media (max-width: 820px) {
  .czw-marketing .czw-hero {
    padding-top: 38px;
    padding-bottom: 48px;
  }

  .czw-marketing .czw-hero-grid {
    gap: 0;
  }

  .czw-marketing .czw-product-scene {
    display: none;
  }

  .czw-marketing .czw-hero-copy-block > .czw-eyebrow,
  .czw-marketing .czw-microcopy {
    display: none;
  }
}
'''
app_css.write_text(text)

# Update the existing DR-66 render tests to enforce the corrected device split.
test = ROOT / "tests/FinderDiscovery.test.tsx"
text = test.read_text()
text = text.replace(
    'matches: query === "(min-width: 900px)" ? width >= 900 : false,',
    'matches: query === "(min-width: 1024px)" ? width >= 1024 : false,',
)
old = '''  it.each([1366, 1440])(\n    "keeps the exact finder above the subordinate directory at %ipx desktop",\n    async (width) => {\n      setViewport(width);\n      render(<FinderDiscovery />);\n      const exact = await screen.findByRole("heading", {\n        name: "Find your exact class",\n      });\n      const directory = await screen.findByRole("heading", {\n        name: "Directory",\n      });\n      expect(\n        exact.compareDocumentPosition(directory) &\n          Node.DOCUMENT_POSITION_FOLLOWING,\n      ).not.toBe(0);\n      expect(screen.queryByText(/Timetable link or slug/i)).toBeNull();\n    },\n  );'''
new = '''  it.each([1366, 1440])(\n    "uses the unified directory instead of the mobile exact form at %ipx desktop",\n    async (width) => {\n      setViewport(width);\n      render(<FinderDiscovery />);\n      expect(\n        await screen.findByLabelText("Search published timetables"),\n      ).toBeInTheDocument();\n      expect(\n        screen.queryByRole("region", { name: "Find your exact class" }),\n      ).toBeNull();\n      expect(screen.getByText("Institution")).toBeInTheDocument();\n      expect(screen.getByText("Programme")).toBeInTheDocument();\n      expect(screen.getByText("Class")).toBeInTheDocument();\n      expect(screen.getByText("Academic period")).toBeInTheDocument();\n      expect(screen.queryByText(/Published by CalenderZW/i)).toBeNull();\n      expect(screen.queryByText(/All institutions/i)).toBeNull();\n    },\n  );'''
if old not in text:
    raise RuntimeError("Desktop FinderDiscovery test block not found")
test.write_text(text.replace(old, new, 1))

contract = ROOT / "tests/dr66FinderDiscoveryContract.test.ts"
text = contract.read_text()
old = '''  it("keeps the exact finder primary and the desktop directory explicitly secondary", () => {\n    expect(finder).toContain('data-priority="primary"');\n    expect(finder).toContain('data-priority="secondary"');\n    const routeOwner = finder.slice(\n      finder.indexOf("export function FinderDiscovery"),\n    );\n    expect(routeOwner.indexOf("<ExactFinder")).toBeGreaterThan(-1);\n    expect(routeOwner.indexOf("<DesktopDirectory")).toBeGreaterThan(-1);\n    expect(routeOwner.indexOf("<ExactFinder")).toBeLessThan(\n      routeOwner.indexOf("<DesktopDirectory"),\n    );\n    expect(finder).toContain('isDesktop && status === "ready"');\n  });'''
new = '''  it("splits task completion on mobile from unified discovery on desktop", () => {\n    expect(finder).toContain('(min-width: 1024px)');\n    expect(finder).toContain('data-mode="exact"');\n    expect(finder).toContain('data-mode="directory"');\n    expect(finder).not.toContain("QuickFilterButton");\n    expect(finder).not.toContain("czw-directory-sidebar");\n    expect(finder).not.toContain("Published by CalenderZW");\n    expect(finder).not.toContain("czw-published-pill");\n    const routeOwner = finder.slice(\n      finder.indexOf("export function FinderDiscovery"),\n    );\n    expect(routeOwner).toContain("if (isDesktop)");\n    expect(routeOwner).toContain("<DesktopDirectory");\n    expect(routeOwner).toContain("<ExactFinder");\n  });'''
if old not in text:
    raise RuntimeError("DR-66 contract desktop block not found")
contract.write_text(text.replace(old, new, 1))

layout = ROOT / "tests/dr55FinderPromptLayout.test.ts"
layout.write_text(r'''import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("DR-55 Finder missing-class prompt layout", () => {
  it("keeps the prompt in normal React flow inside FinderDiscovery", () => {
    const finder = readFileSync("src/FinderDiscovery.tsx", "utf8");
    const main = readFileSync("src/main.tsx", "utf8");

    expect(finder).toContain("function MissingClassPrompt");
    expect(finder).toContain("czw-finder-demand-inline");
    expect(finder).not.toContain("createPortal(");
    expect(main).not.toContain("FinderDemandPrompt");
  });

  it("keeps the mobile prompt compact and non-sticky", () => {
    const css = readFileSync("src/finderDiscovery.css", "utf8");
    expect(css).toContain(".czw-finder-demand-inline");
    expect(css).not.toMatch(/\.czw-finder-demand-inline[\s\S]{0,500}position:\s*(?:fixed|sticky)/);
    expect(css).toContain("@media (max-width: 640px)");
    expect(css).toContain("background: transparent");
  });
});
''')

followup = ROOT / "tests/dr66ResponsiveFinderFollowup.test.ts"
followup.write_text(r'''import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

const finder = readFileSync("src/FinderDiscovery.tsx", "utf8");
const marketing = readFileSync("src/ProductionUxEnhancements.tsx", "utf8");
const main = readFileSync("src/main.tsx", "utf8");

describe("DR-66 post-merge conversion UX clarification", () => {
  it("keeps one finder interaction model per device class", () => {
    expect(finder).toContain('(min-width: 1024px)');
    expect(finder).toContain('data-mode="exact"');
    expect(finder).toContain('data-mode="directory"');
    expect(finder).not.toContain("czw-directory-category-row");
    expect(finder).not.toContain("czw-directory-sidebar");
    expect(finder).not.toContain("QuickFilterButton");
    expect(finder).not.toContain("Published by CalenderZW");
    expect(finder).not.toContain("Published only");
  });

  it("owns the missing-class action directly instead of a DOM portal enhancement", () => {
    expect(finder).toContain("function MissingClassPrompt");
    expect(main).not.toContain("FinderDemandPrompt");
  });

  it("uses the HIT mark and decorative proof imagery without named endorsements", () => {
    expect(marketing).toContain('/hit-mark.webp');
    expect(marketing).toContain('/student-avatar-1.webp');
    expect(marketing).toContain('/student-avatar-2.webp');
    expect(marketing).toContain("18+ active calendar connections");
    expect(marketing).toContain("+15");
    expect(marketing).not.toContain("UserRound");
    for (const asset of [
      "public/hit-mark.webp",
      "public/student-avatar-1.webp",
      "public/student-avatar-2.webp",
    ]) {
      expect(existsSync(asset)).toBe(true);
      expect(statSync(asset).size).toBeLessThan(10_000);
    }
  });
});
''')

assets = {
    "public/student-avatar-1.webp": "UklGRiQFAABXRUJQVlA4IBgFAABwFgCdASpQAFAAPk0ejEQioaEZmq5kKATEsoBgLi9roiu9yjq7g9bjubv3jJVbptRHtXxb8HZokVLNF8t/5p/p01MmaaocwnYvZphTjriId5OjcZc0I2CZvljk+kw+DpdcOEqAnLkOybEa2X5jboCZ2u+OZJlqGKYtnZFcMzVwRJgWsnt2GOfTPwQBzoUmZXDPmdNocSbymrM2URSiy53XlcfNfYmxI8pjpzCZb7SjRdDaEMap/Pmrnwcc+AD+/jAkVQDFGGGQmQJqqgBJu9nQqOh5qdg+OLV8buKPbbdlIMpM6Z2RiejDQXj5Ub0Z0/foe65SQr83auR9oOAmuVEysA4Vq4ZOiEvJl6yVCbLz4EB8AMo45mK3j08YHj27H2oICvd3TVbOR7rH5FshWa2uR9FN6z4ISap3ogPSN4mrPyp6K5ZdUKmsLCernIrftdkuySjDWPfuPanMcszWIaDEm7DhyvfJmGx0bNpYJH0Am98nQB1EujBMgFQJJIVCGIpicbnBoVzXjktA7NB8vIUoeIZ1sFuKo6sNp2nl5qTLn6GP5xkCCqagoisz/xWrs0In7z23U2fmj/25QzRHg6QW2F/bx5nMWdO7tYZGp9Yn45VmWrbYLWNoHd4/WvMATRyCfXx/cMBoe9s92MVB14D7p/DySHKbcQlwBGewEWFPo9owyQheusToUYTlQxSPdj5OiZBihaSRcuFAV6g35AVR9qx4AZFw9g14n0Z6oPHI36QwhEptBA5eJfiQ8b61U9Ypjh132a75mBHI42ex9Jop3Zh3uJ2RbykWZyj0mcxc9B9fsGfUpEStF929kdep9eHqKuHLOMRIgr1/AOS5vx9KfQYX98vmJjKt5A+c2MK7wMaFICUV47jYWPy662VwWNEj/ZA3Zb0rkISkFOr5v6h8U/X7ZW2BQD6Wl3MiLl4j04p38Alv/SXq6DlMH3Xsk8HjJkkJvHPEjbMf9J3SBj47z4pKQ8LO2b9r1yqHXLWRnI8ISjxy+B+ZCHbvON/4jXC+R4uKtB64+ehVEwhNkDIhfWL9pQdojy+jAYhiOmZBIWuRS9/V0Gbkx+gprkrAzzLeG+lkv5JQYgg5AwJdaOKuewzgmhlQ2Qiv3mOqC2T8SnmgBLRBY+I85Gl+ns4f2CdsIBa1k101jw+F4Arh7Heo/w6Q8k+hCKKdMxps+NkgKxngeWu0+X6anOyLB3EJVJSLvgxtsNF2jEo753JU4V4sSVUdWa/udceBvFZAIoBnpPEPXCnrvLJEEh/eomD3krO2Zndajbd8HWreJN9CxCf06+qNcfp3Yy9l7w/NiWeh1WeuL1b9TYQmdVFQl5QQDM9yyb8TrbG4a1ppT6thkRxOnKu78b2Zw8wm7lEdNjIoH2YyJcM7fPMI58WYBf8BxWdnkc1RRSZUNd+n634JSm4en0YJwGqp390U707fQ3Phr2Sy3BIHsecC2kwFPhy0ntbY3ONn+Aox3q6462H81NCAz4fZvwfdINyA9zt2uQixfyWmGGmrT/lZf6MS1j0UJySJwxbseESr7lg+QfSxywVbNVMYlKsdm15YQDfdH5Q7yC65p5n3xZqQ90n9P/6v3l6parKsGwj0Qe1tQufl3nLpLGoeu3bwNmlHGUPwwhvZvlN1+TcgfC8MQYy9Q/iU2m3G0WJwI2f0t/kakbbefaKRngXlHvXIWj+MLfDHuR/lc784sgQKNb98xlvsFewIA04AkjDVk8aAAA==",
    "public/student-avatar-2.webp": "UklGRtoEAABXRUJQVlA4IM4EAABQFgCdASpQAFAAPkkci0QioaEZnM5kKASEsoBihjsA0vl24l3K7zdPpufH37JtuL+tWODmDPeHZC1Gap5cNRzfdoRGRUeFc8WAVs7bH1Vz/093zqATJ8TMWknu+IGWUpaU2cKNgloU1rrCGw51IeKsXfH7Ff4oWAgaRlSeCnLi3UDLTPjck/pWC6WzwyQEaFi6+tzTJwnHVKn4EH3fSdgY41bXZ7TQxPDuULQbm8OSMC1rnlDz8FsgxPmAAP7+bDuuVoVriTNG0a9klKPRmNdtbYMOj2LRUnUKAKMn0zFN7u40me2uTre79WB4N7K1rb4P7B5TK4+YCVSIKOErlBUeynWyZPJPuGivq7dV003NCthzI0gnZQT9bAftZrWiVxMBs4wBhj50Xf/0CTX5o2IP7Fpnb7bDSzJENVIbM/VpCSIN9oYAzVaC6QK3k2aNzO2OhEvEM4eAIU4xjmIm1KfrP4ZoevJM4yArn5y4cdB+l0VBf4NlxWPlkQMz1g7S7U1fKGginD9LVLt4MCSmE+84ApvWjLqTrIVrzsPRrO4sIXGLE3I1uDIiiR977HEy9/dXrBo12XHbhnPv0R6w6m3WI/oAV32lwBlbbychhPR2cmyFiTuu7pInaB9co3fEvdch0jFVIs5Ky80BkVP6pO2yHUw1G3TvMK/j+7F3yHURE5qE6j3Dr1rK2ZElKOJDw55T9t+o1cRiDxP10OLIi5/Vcp3+NzXrenqZf2StrkQpiBwztS823AaRSw19WejdAHuLBbY8MW3zQRD0vno16Rsowt2ic3NvVg9x/lyIhJiQlPEEtqP3fiiqdw6ZIunbw2Pt9BUPqilCdDN2eSdFZVj7ZKIOfrGSqSJgMc9e2dlUj+ediD0GXduhCcQoiqadPqboVG8vwEAihMf29vB/h12L4qqJfbL2JCUOCsmbFMmjijKW+NQbfe+LcEFa3LTStojMBlt42Xy+28ja42NJ+vSnJEdVZfxEqkrbVy3i5H2ZjwyQFBU9JX8z92kMEh1njzbXrbZb+f1s4OV8VabZk57AR9j5W4T3juVzpCdo6SaJZJEbuIcLoZFon++7mwdboLubh4qOgNyDi4z0fxPN0+dracw4J/H82m70ESo/ISUNT0hYlNbnYduPZV1WWEhdbY/fTBNspe6wFNWFfcJZK5ON+YKr9Ce4wLE/Uajffr0m0fAv77xWK6H/9SRUpm6qZwwFTY8noVM2Dak6ubplIbLMNCZK69xS1ZdMR4N+PE9qoZJbOIIru+sHv3SX/IoqbvPzy4AMVYsDorjuXfvs3LA08O3eEXufDm7qA4F7FoTr+FcnF+XSdDwNx9H5S+PYa3Zt+zBlmctUbuGgLR0MUoSE3Q9MxNLTgVcVWddaPkLGJ1CSdAtyw6qy9qaapigB+2T+edJMN0lLjZ70rJ9sdU/KdcIuFwJ66nePshk1FVvL8XVMg+vBNJfwb0qxpc8/MAZD4Ho/NDs5zK/86JRPeYjaYOGHFZN/mjvpaPIYfNDqPmSdacEX12q56tIHdGz/eMcoyAS6x340zPrXHkfQQ/9kTbAUuza0D9LxyVLf3znXSWS49fZlaz4JLvdRnTFv0FeW73T4rCRHws9dxs5TUjUVH0NGMLAaKfmS/O2UgAA=",
    "public/hit-mark.webp": "UklGRiQFAABXRUJQVlA4IBgFAADQFwCdASpQAFAAPlEijUSjoiEXCjW0OAUEsgBg4jtHE8t+G8nrq7+qvxHekb5gP1z/xntAeh7/e+oB/2+pg58/2Uv3E/aP2hKZ79e/KH9sMxJ+l/J7kn2tN82Hix2+gfoJejvYP/W9AeQRxYVj5DE90pzwJrZU6lcU9AxyyRfriHx0m+Wwn1zgTIdGANUyWvBhG1XvrnYgz95M1m81z7ZhbbF1n9u/JGhwYPxo0FPrD6OQsDv2Q+ANu0ZfrxAVE8m4fc4gNLmgAP795O1eIB7Myp9W0oREFHsOB58dyPfYf7R0qXJzVM7SVr13zwOxE/kPLqIS2pKBLpmB94O9BsnsgMzIatoTUuHggdN7Vjm+5PVdRCKqtnegZbZgdy67JmV912e21nrKrjoaFhozT0DGKlLp5it+aTdBlP/OS7Jd7HpAcezzEU/4efiaCzQ8zvl2Mt8s/iFYQKEk2o2isHXLk+wkSPS5h2X/kVqC6W2K/NokVac42mC/5vHwe2gNFuk7KQNGTLdsOog5rpjqSXYuF6rj8jETrhPZH7vIW2wL1vfvY7/yOyKsg+nOjGr0hyNlHfsU2X9wAXGUbjb1wm2J6x3KgxfsIYMOcDXG+no+c9iuhEkMyTlPbxQ2ssHz/gyeA7xx3czJ0rU3qBqggpoEM8Z0o2gZHG8+hSCveiTeR9/2gAooJvuLGdsLMSKluBFpBj77hSSJmSj/YLH8iSt/XWEDskzarSXPEp6IZd3oGV4p6y1F3B/vtid407JUBi9AzOkk/SktvmTTP8ClMw1Ia8+GmX/rbO3jhJILbcU+c1GiML5hIiGByu+dBiDhX/u18YpXUIVaBiDiwHkStbAGVl2lbNaAAVOpnht1nQ/ZxtN2E938R5g+qmkbPIv6ChP5E/mID02Fgzmj6mc5rLSjSbetO0TgpHl7IloD9TUfgjfhlSrsuwJjioyUDDcn8YtEkr0psUaGS73rNEFXlDP2bjAjt+YLvT/MMI+risxtH5O+LdhYqyy1H5+hu5EJ3PpPadSGZ3pOsQwZ7J6SxqM6zt1/JVOtJ7lfbe7gjvG0djpSL67/3xfmcJ/F+KoBNLTlffkl1d9xX6W28o09jqsGmG/rP/lygPT+SiPTSwitO7w82LmC/FA1KDJ0XfOlVbaSZ5PdYra56WVd2LKxnoX0xpb36lf3p+aaPZR7sJm5lLz+gfzWdA/FfNHoQvbsefR5A2dyV+WUYcG7/8tNgIAmVCTgnBnKyU8wPpuMO3ouGHnmXr5OBUFBk/eIX/mK05YfNNtmQ1sWZPymP6NbvmaZwC6lcUhiJ+jJU/yPgTqZv0zUUyJ13/wC590KfS3bQO6RulwB4si2UnrSHp1IIMTyTfbNRKXadNHEcFOJbzxZcD7VOcjC4nbG2V0MNr+ovt55/EZDO0h3z8m5cB6ardwex48xrnboA4OyEp74klnkDqyHktNA4xOnHDVtW5IFdEvbH6p7q8cxidiAaSKBGA/3l63GR3MmMdIsDp6T7jlRjdcaT2d//q/+Ar2TdkT8cLd3mG+Xvwb3rHmnSGRYc0/mKWbUtuLyoweSc9wIh00UrFhL0mRbsGPh/2uIfz1EuzLH7U7otqSZfJzpnexBp4QhBwcedo6wOnjfc6ig97GPxR/dWUH1MUUut+2ebiz0rsCRI+LhBI7Yu/7vnf/N1brvCTsLHVDKmkatrAWEAiLYiK4A1NmSyqm1NfDxnVsmkKrlKYTzdsoAAA==",
}
for path, encoded in assets.items():
    (ROOT / path).write_bytes(base64.b64decode(encoded))
