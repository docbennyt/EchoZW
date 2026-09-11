import { Button } from "@base-ui/react/button";
import { Input } from "@base-ui/react/input";
import { Select } from "@base-ui/react/select";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  fetchPublishedTimetables,
  type PublishedTimetableSummary,
} from "./api/publicDiscovery";
import { chooseAcademicPeriod } from "./domain/finderPeriodSelection";

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
  const [isDesktop, setIsDesktop] = useState(
    () =>
      typeof window.matchMedia === "function" &&
      window.matchMedia("(min-width: 1024px)").matches,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(min-width: 1024px)");
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
        <p>
          Your class representative can publish a timetable before students use
          this finder.
        </p>
        <a href="/rep/login">Set up a class →</a>
      </div>
    );
  }

  return null;
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
    if (preferredPeriod.reason === "single") {
      return "Only one published academic period is available for this class.";
    }
    if (preferredPeriod.reason === "current") {
      return "The academic period containing today’s institution-local date was selected. You can choose another published period.";
    }
    if (preferredPeriod.reason === "overlap") {
      return "More than one published academic period contains today’s date. Choose the period your class is using.";
    }
    if (preferredPeriod.reason === "ambiguous") {
      return "No published academic period contains today’s date. Choose the period explicitly.";
    }
    return null;
  }, [candidates.length, classGroup, preferredPeriod.reason]);

  function submitFinder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTimetable) return;
    openPath(`/t/${selectedTimetable.publicSlug}`);
  }

  return (
    <section className="czw-finder-card" aria-labelledby="finder-card-title">
      <div className="czw-finder-card-heading">
        <span className="czw-finder-icon" aria-hidden="true">
          <Search size={18} />
        </span>
        <div>
          <h2 id="finder-card-title">Find your exact class</h2>
          <p>
            Institution → Programme → Class → Academic period. Only published
            timetables can appear.
          </p>
        </div>
      </div>

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

function TimetableCard({
  timetable,
}: {
  timetable: PublishedTimetableSummary;
}) {
  return (
    <article
      className="czw-discovery-card"
      data-institution={timetable.institutionName}
    >
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

function ActiveFilterChip({
  label,
  onClear,
}: {
  label: string;
  onClear: () => void;
}) {
  return (
    <Button
      type="button"
      className="czw-active-filter-chip"
      aria-label={`Remove ${label} filter`}
      onClick={onClear}
    >
      <span>{label}</span>
      <X size={13} aria-hidden="true" />
    </Button>
  );
}

function DesktopDirectory({
  timetables,
}: {
  timetables: PublishedTimetableSummary[];
}) {
  const [browseInstitution, setBrowseInstitution] = useState<string | null>(
    null,
  );
  const [browseProgramme, setBrowseProgramme] = useState<string | null>(null);
  const [browseClass, setBrowseClass] = useState<string | null>(null);
  const [browsePeriod, setBrowsePeriod] = useState<string | null>(null);
  const [query, setQuery] = useState("");

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
              (!browseInstitution ||
                item.institutionName === browseInstitution) &&
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
              (!browseInstitution ||
                item.institutionName === browseInstitution) &&
              (!browseProgramme || item.programmeName === browseProgramme) &&
              (!browseClass || item.classGroupLabel === browseClass),
          )
          .map((item) => item.academicPeriodName),
      ),
    [browseClass, browseInstitution, browseProgramme, timetables],
  );

  const filteredTimetables = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return timetables
      .filter((item) => {
        if (browseInstitution && item.institutionName !== browseInstitution) {
          return false;
        }
        if (browseProgramme && item.programmeName !== browseProgramme) {
          return false;
        }
        if (browseClass && item.classGroupLabel !== browseClass) return false;
        if (browsePeriod && item.academicPeriodName !== browsePeriod) {
          return false;
        }
        if (!normalizedQuery) return true;
        return [
          item.institutionName,
          item.programmeName,
          item.classGroupLabel,
          item.academicPeriodName,
        ]
          .join(" ")
          .toLocaleLowerCase()
          .includes(normalizedQuery);
      })
      .sort(
        (left, right) =>
          new Date(right.lastUpdated).getTime() -
          new Date(left.lastUpdated).getTime(),
      );
  }, [
    browseClass,
    browseInstitution,
    browsePeriod,
    browseProgramme,
    query,
    timetables,
  ]);

  const hasFacetFilters = Boolean(
    browseInstitution || browseProgramme || browseClass || browsePeriod,
  );
  const hasBrowseFilters = Boolean(hasFacetFilters || query.trim());

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

  function setDirectoryClass(value: string | null) {
    setBrowseClass(value);
    setBrowsePeriod(null);
  }

  function clearFacetFilters() {
    setBrowseInstitution(null);
    setBrowseProgramme(null);
    setBrowseClass(null);
    setBrowsePeriod(null);
  }

  function clearDirectoryFilters() {
    clearFacetFilters();
    setQuery("");
  }

  return (
    <section
      className="czw-directory-desktop"
      aria-label="Published timetable directory"
    >
      <div className="czw-directory-layout">
        <aside className="czw-directory-sidebar" aria-label="Timetable filters">
          <div className="czw-directory-sidebar-heading">
            <span>
              <SlidersHorizontal size={16} aria-hidden="true" />
              Filter & refine
            </span>
            {hasFacetFilters ? (
              <Button
                type="button"
                className="czw-directory-reset"
                onClick={clearFacetFilters}
              >
                Clear filters
              </Button>
            ) : null}
          </div>

          <div className="czw-directory-filter-stack">
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
              onValueChange={setDirectoryClass}
            />
            <SelectField
              label="Academic period"
              placeholder="All periods"
              value={browsePeriod}
              values={browsePeriods}
              onValueChange={setBrowsePeriod}
            />
          </div>
        </aside>

        <div className="czw-directory-results">
          <div className="czw-directory-search-row">
            <div className="czw-directory-search-box">
              <Search size={18} aria-hidden="true" />
              <Input
                aria-label="Search published timetables"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by university, programme, class or academic period"
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
          </div>

          <div className="czw-directory-toolbar">
            <div className="czw-directory-result-summary">
              <h2>
                {filteredTimetables.length} published{" "}
                {filteredTimetables.length === 1 ? "timetable" : "timetables"}
              </h2>
              <p>
                Showing matching published class timetables from CalenderZW.
              </p>
            </div>

            <div
              className="czw-directory-active-filters"
              aria-label="Active timetable filters"
            >
              {browseInstitution ? (
                <ActiveFilterChip
                  label={browseInstitution}
                  onClear={() => setDirectoryInstitution(null)}
                />
              ) : null}
              {browseProgramme ? (
                <ActiveFilterChip
                  label={browseProgramme}
                  onClear={() => setDirectoryProgramme(null)}
                />
              ) : null}
              {browseClass ? (
                <ActiveFilterChip
                  label={`Class ${browseClass}`}
                  onClear={() => setDirectoryClass(null)}
                />
              ) : null}
              {browsePeriod ? (
                <ActiveFilterChip
                  label={browsePeriod}
                  onClear={() => setBrowsePeriod(null)}
                />
              ) : null}
              {hasBrowseFilters ? (
                <Button
                  type="button"
                  className="czw-directory-clear-all"
                  onClick={clearDirectoryFilters}
                >
                  Clear all
                </Button>
              ) : (
                <span className="czw-directory-all-results">
                  All published timetables
                </span>
              )}
            </div>
          </div>

          {filteredTimetables.length > 0 ? (
            <div className="czw-discovery-grid" aria-live="polite">
              {filteredTimetables.map((timetable) => (
                <TimetableCard
                  key={timetable.publicSlug}
                  timetable={timetable}
                />
              ))}
            </div>
          ) : (
            <div className="czw-directory-no-results" role="status">
              <Search size={22} aria-hidden="true" />
              <strong>No published timetables match those filters.</strong>
              <p>
                Clear one or more filters, or search using a programme, class or
                period name.
              </p>
              <Button
                type="button"
                className="czw-button czw-button-secondary"
                onClick={clearDirectoryFilters}
              >
                Clear filters
              </Button>
            </div>
          )}
        </div>
      </div>
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
      <div className="czw-finder-experience czw-directory-experience">
        <FinderLoadState status={status} timetableCount={timetables.length} />
        {status === "ready" && timetables.length > 0 ? (
          <DesktopDirectory timetables={timetables} />
        ) : null}
      </div>
    );
  }

  return (
    <div className="czw-finder-experience">
      <div className="czw-finder-primary" data-priority="primary">
        <ExactFinder timetables={timetables} status={status} />
      </div>
    </div>
  );
}
