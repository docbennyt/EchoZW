import { Button } from "@base-ui/react/button";
import { Input } from "@base-ui/react/input";
import { Select } from "@base-ui/react/select";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ExternalLink,
  Grid2X2,
  List,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  fetchPublishedTimetables,
  type PublishedTimetableSummary,
} from "./api/publicDiscovery";

const SORT_OPTIONS = [
  "Recently updated",
  "Institution A–Z",
  "Programme A–Z",
] as const;

type SortOption = (typeof SORT_OPTIONS)[number];
type ViewMode = "grid" | "list";

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
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(min-width: 900px)");
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
  viewMode = "grid",
}: {
  timetable: PublishedTimetableSummary;
  viewMode?: ViewMode;
}) {
  return (
    <article
      className="czw-discovery-card"
      data-view={viewMode}
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

function SharedLinkForm({
  sharedLink,
  linkError,
  onSharedLinkChange,
  onSubmit,
  compact = false,
}: {
  sharedLink: string;
  linkError: string;
  onSharedLinkChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  compact?: boolean;
}) {
  return (
    <form
      className="czw-shared-link-form"
      data-compact={compact || undefined}
      onSubmit={onSubmit}
    >
      <label htmlFor={compact ? "czw-shared-link-desktop" : "czw-shared-link"}>
        Timetable link or slug
      </label>
      <div>
        <Input
          id={compact ? "czw-shared-link-desktop" : "czw-shared-link"}
          value={sharedLink}
          onChange={(event) => onSharedLinkChange(event.target.value)}
          placeholder="calender.aido.co.zw/t/…"
          aria-describedby={linkError ? "czw-link-error" : undefined}
        />
        <Button type="submit" className="czw-link-open-button">
          <ExternalLink size={17} aria-hidden="true" />
          <span>Open</span>
        </Button>
      </div>
      {linkError ? (
        <p id="czw-link-error" role="alert">
          {linkError}
        </p>
      ) : null}
    </form>
  );
}

function QuickFilterButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      className="czw-directory-chip"
      aria-pressed={active}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

export function FinderDiscovery() {
  const isDesktop = useDesktopDirectory();
  const [timetables, setTimetables] = useState<PublishedTimetableSummary[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  // Exact-match finder state. This remains the fast mobile path.
  const [institution, setInstitution] = useState<string | null>(null);
  const [programme, setProgramme] = useState<string | null>(null);
  const [classGroup, setClassGroup] = useState<string | null>(null);
  const [period, setPeriod] = useState<string | null>(null);

  // Directory browsing state. It is deliberately independent from the exact finder.
  const [browseInstitution, setBrowseInstitution] = useState<string | null>(null);
  const [browseProgramme, setBrowseProgramme] = useState<string | null>(null);
  const [browseClass, setBrowseClass] = useState<string | null>(null);
  const [browsePeriod, setBrowsePeriod] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("Recently updated");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");

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

  const browseProgrammes = useMemo(
    () =>
      unique(
        timetables
          .filter(
            (item) =>
              !browseInstitution ||
              item.institutionName === browseInstitution,
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
    const filtered = timetables.filter((item) => {
      if (
        browseInstitution &&
        item.institutionName !== browseInstitution
      ) {
        return false;
      }
      if (browseProgramme && item.programmeName !== browseProgramme) return false;
      if (browseClass && item.classGroupLabel !== browseClass) return false;
      if (browsePeriod && item.academicPeriodName !== browsePeriod) return false;
      if (!normalizedQuery) return true;
      const searchable = [
        item.institutionName,
        item.programmeName,
        item.classGroupLabel,
        item.academicPeriodName,
      ]
        .join(" ")
        .toLocaleLowerCase();
      return searchable.includes(normalizedQuery);
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
      return (
        new Date(right.lastUpdated).getTime() -
        new Date(left.lastUpdated).getTime()
      );
    });
  }, [
    browseClass,
    browseInstitution,
    browsePeriod,
    browseProgramme,
    query,
    sortBy,
    timetables,
  ]);

  const hasBrowseFilters = Boolean(
    browseInstitution || browseProgramme || browseClass || browsePeriod || query,
  );

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
        setLinkError(
          "That link does not look like a CalenderZW timetable link.",
        );
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

  function clearDirectoryFilters() {
    setBrowseInstitution(null);
    setBrowseProgramme(null);
    setBrowseClass(null);
    setBrowsePeriod(null);
    setQuery("");
  }

  const commonStatus = (
    <>
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
    </>
  );

  if (isDesktop) {
    return (
      <div className="czw-finder-experience czw-directory-experience">
        <section
          className="czw-directory-desktop"
          aria-labelledby="directory-title"
        >
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
            <div className="czw-directory-search-trust">
              <Check size={14} aria-hidden="true" />
              Published from Admin
            </div>
          </div>

          {status !== "ready" || timetables.length === 0 ? commonStatus : null}

          {status === "ready" && timetables.length > 0 ? (
            <>
              <nav
                className="czw-directory-category-row"
                aria-label="Browse by institution"
              >
                <strong>Institutions</strong>
                <div>
                  <QuickFilterButton
                    label="All institutions"
                    active={!browseInstitution}
                    onClick={() => setDirectoryInstitution(null)}
                  />
                  {institutions.map((item) => (
                    <QuickFilterButton
                      key={item}
                      label={item}
                      active={browseInstitution === item}
                      onClick={() => setDirectoryInstitution(item)}
                    />
                  ))}
                </div>
              </nav>

              <nav
                className="czw-directory-category-row czw-directory-category-secondary"
                aria-label="Browse by programme"
              >
                <strong>Programmes</strong>
                <div>
                  <QuickFilterButton
                    label="All programmes"
                    active={!browseProgramme}
                    onClick={() => setDirectoryProgramme(null)}
                  />
                  {browseProgrammes.map((item) => (
                    <QuickFilterButton
                      key={item}
                      label={item}
                      active={browseProgramme === item}
                      onClick={() => setDirectoryProgramme(item)}
                    />
                  ))}
                </div>
              </nav>

              <div className="czw-directory-layout">
                <aside
                  className="czw-directory-sidebar"
                  aria-label="Timetable filters"
                >
                  <div className="czw-directory-sidebar-heading">
                    <span>
                      <SlidersHorizontal size={16} aria-hidden="true" />
                      Filter & refine
                    </span>
                    {hasBrowseFilters ? (
                      <Button
                        type="button"
                        className="czw-directory-reset"
                        onClick={clearDirectoryFilters}
                      >
                        Clear all
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

                  <div className="czw-directory-published-only">
                    <span className="czw-published-pill">
                      <Check size={13} aria-hidden="true" /> Published only
                    </span>
                    <p>
                      Every result comes from the CalenderZW Admin publication
                      state. Drafts never appear here.
                    </p>
                  </div>

                  <div className="czw-directory-shared-link">
                    <strong>Have a class link?</strong>
                    <p>Open a direct timetable without changing your filters.</p>
                    <SharedLinkForm
                      compact
                      sharedLink={sharedLink}
                      linkError={linkError}
                      onSharedLinkChange={setSharedLink}
                      onSubmit={submitSharedLink}
                    />
                  </div>
                </aside>

                <div className="czw-directory-results">
                  <div className="czw-directory-toolbar">
                    <div>
                      <span className="czw-kicker">Published directory</span>
                      <h2 id="directory-title">Published timetables</h2>
                      <p>
                        Showing {filteredTimetables.length} of {timetables.length}
                        {timetables.length === 1 ? " timetable" : " timetables"}
                      </p>
                    </div>
                    <div className="czw-directory-toolbar-actions">
                      <div className="czw-directory-sort">
                        <SelectField
                          label="Sort"
                          placeholder="Recently updated"
                          value={sortBy}
                          values={SORT_OPTIONS}
                          onValueChange={(value) =>
                            setSortBy(
                              (value as SortOption | null) ??
                                "Recently updated",
                            )
                          }
                        />
                      </div>
                      <div
                        className="czw-directory-view-toggle"
                        aria-label="Result view"
                      >
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
                    <div
                      className="czw-discovery-grid"
                      data-view={viewMode}
                      aria-live="polite"
                    >
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
                      <strong>No published timetables match those filters.</strong>
                      <p>
                        Clear one or more filters, or search using a programme,
                        class or period name.
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
            </>
          ) : null}
        </section>
      </div>
    );
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

        {commonStatus}

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

        <div className="czw-finder-divider">
          <span>or open a shared class link</span>
        </div>
        <SharedLinkForm
          sharedLink={sharedLink}
          linkError={linkError}
          onSharedLinkChange={setSharedLink}
          onSubmit={submitSharedLink}
        />
      </section>

      {status === "ready" && timetables.length > 0 ? (
        <section
          className="czw-available-section"
          aria-labelledby="available-title"
        >
          <div className="czw-available-heading">
            <div>
              <span className="czw-kicker">Available now</span>
              <h2 id="available-title">Published timetables</h2>
            </div>
            <span>{filteredTimetables.length} available</span>
          </div>

          <div className="czw-mobile-browse-rail" aria-label="Browse institutions">
            <QuickFilterButton
              label="All"
              active={!browseInstitution}
              onClick={() => setDirectoryInstitution(null)}
            />
            {institutions.map((item) => (
              <QuickFilterButton
                key={item}
                label={item}
                active={browseInstitution === item}
                onClick={() => setDirectoryInstitution(item)}
              />
            ))}
          </div>

          {browseInstitution && browseProgrammes.length > 1 ? (
            <div
              className="czw-mobile-browse-rail czw-mobile-programme-rail"
              aria-label="Browse programmes"
            >
              <QuickFilterButton
                label="All programmes"
                active={!browseProgramme}
                onClick={() => setDirectoryProgramme(null)}
              />
              {browseProgrammes.map((item) => (
                <QuickFilterButton
                  key={item}
                  label={item}
                  active={browseProgramme === item}
                  onClick={() => setDirectoryProgramme(item)}
                />
              ))}
            </div>
          ) : null}

          {filteredTimetables.length > 0 ? (
            <div className="czw-discovery-grid">
              {filteredTimetables.map((timetable) => (
                <TimetableCard key={timetable.publicSlug} timetable={timetable} />
              ))}
            </div>
          ) : (
            <div className="czw-directory-no-results" role="status">
              <strong>No published timetables in this category yet.</strong>
              <Button
                type="button"
                className="czw-button czw-button-secondary"
                onClick={clearDirectoryFilters}
              >
                Show all
              </Button>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
