import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarCheck,
  Copy,
  Download,
  ExternalLink,
  GraduationCap,
  Link2,
  Lock,
  LogOut,
  Plus,
  Save,
  Share2,
  ShieldCheck,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { track } from "./analytics";
import {
  fetchAdminSession,
  type AdminSessionResponse,
  type AdminSessionUser,
} from "./api/adminSession";
import { fetchAnalyticsOverview } from "./api/adminAnalytics";
import type { AnalyticsOverview } from "./domain/adminAnalytics";
import {
  fetchSourceGatewayState,
  mapSourceGatewayCohort,
  mapSourceGatewayProgramme,
  processLatestSourceSnapshot,
  type SourceGatewayState,
} from "./api/sourceGatewayAdmin";
import {
  assignClassRep,
  createRecurringCorrection,
  createTimetableException,
  createAcademicPeriod,
  createClassGroup,
  createInstitution,
  createProgramme,
  createTimetable,
  createTimetableSession,
  deleteTimetableSession,
  getTimetable,
  inviteClassRep,
  listAcademicPeriods,
  listClassGroups,
  listInstitutions,
  listStaff,
  listProgrammes,
  listTimetables,
  resendClassRepInvite,
  revokeClassRepAssignment,
  setStaffActive,
  publishTimetable,
  updateAcademicPeriod,
  updateClassGroup,
  updateInstitution,
  updateProgramme,
  updateTimetableSession,
} from "./api/pilotAdmin";
import type {
  AdminAcademicPeriod,
  AdminClassGroup,
  AdminInstitution,
  AdminProgramme,
  AdminTimetableEditor,
  AdminTimetableSession,
  AdminTimetableSummary,
  StaffMember,
} from "./api/pilotTypes";
import { createCalendarSubscription } from "./api/calendarSubscriptions";
import { fetchPublicTimetable } from "./api/publicTimetable";
import type { PublicTimetable } from "./api/pilotTypes";
import { createClient as createSupabaseBrowserClient } from "./utils/supabase/client";
import { detectDevice, type DeviceKind } from "./domain/device";
import {
  applyCourseSuggestion,
  buildCourseMemoryEntries,
  findCourseSuggestions,
  mergeCourseSuggestion,
  type CourseSuggestion,
} from "./domain/courseMemory";
import {
  buildPublicTimetableMetadata,
  formatClassGroupLabel,
  formatOccurrenceTime,
  formatPublishedTimestamp,
  getInstitutionIdentity,
  getUpcomingOccurrences,
} from "./domain/publicTimetable";
import { getTomorrowSchedule } from "./domain/tomorrowSchedule";

const weekdayLabels = [
  "",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

function navigate(path: string, replace = false) {
  if (replace) {
    window.history.replaceState({}, "", path);
  } else {
    window.history.pushState({}, "", path);
  }
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function formatDate(value: string | null) {
  if (!value) return "Date not set";
  return new Intl.DateTimeFormat("en-ZW", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-ZW", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatPeriod(period: AdminAcademicPeriod) {
  return `${period.name} · ${formatDate(period.startsOn)} - ${formatDate(period.endsOn)}`;
}

function copyText(value: string) {
  return navigator.clipboard.writeText(value);
}

function useDocumentMetadata(title: string, description: string) {
  useEffect(() => {
    document.title = title;
    let meta = document.head.querySelector<HTMLMetaElement>(
      'meta[name="description"]',
    );
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "description";
      document.head.append(meta);
    }
    meta.content = description;
  }, [title, description]);
}

function useAdminAccess() {
  const [status, setStatus] = useState<
    "checking" | "authorized" | "forbidden" | "login" | "error"
  >("checking");
  const [user, setUser] = useState<AdminSessionUser | null>(null);
  const [session, setSession] = useState<AdminSessionResponse | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function verify() {
      let supabase;
      try {
        supabase = createSupabaseBrowserClient();
      } catch {
        if (active) setStatus("login");
        return;
      }

      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token ?? null;
      if (!token) {
        if (active) setStatus("login");
        return;
      }

      try {
        const session = await fetchAdminSession(token);
        if (!active) return;
        setAccessToken(token);
        setUser(session.user);
        setSession(session);
        setStatus("authorized");
      } catch (error) {
        if (!active) return;
        if (error instanceof Error && error.name === "FORBIDDEN") {
          setStatus("forbidden");
          return;
        }
        setStatus("login");
      }
    }

    void verify();
    return () => {
      active = false;
    };
  }, []);

  async function signOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    navigate("/admin/login", true);
  }

  return { status, user, session, accessToken, signOut };
}

function useAdminData(accessToken: string | null, enabled = true) {
  const [institutions, setInstitutions] = useState<AdminInstitution[]>([]);
  const [programmes, setProgrammes] = useState<AdminProgramme[]>([]);
  const [classGroups, setClassGroups] = useState<AdminClassGroup[]>([]);
  const [academicPeriods, setAcademicPeriods] = useState<AdminAcademicPeriod[]>(
    [],
  );
  const [timetables, setTimetables] = useState<AdminTimetableSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refreshAll = useCallback(async () => {
    if (!accessToken || !enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [
        institutionResult,
        programmeResult,
        classGroupResult,
        academicPeriodResult,
        timetableResult,
      ] = await Promise.all([
        listInstitutions(accessToken),
        listProgrammes(accessToken),
        listClassGroups(accessToken),
        listAcademicPeriods(accessToken),
        listTimetables(accessToken),
      ]);
      setInstitutions(institutionResult.institutions ?? []);
      setProgrammes(programmeResult.programmes ?? []);
      setClassGroups(classGroupResult.classGroups ?? []);
      setAcademicPeriods(academicPeriodResult.academicPeriods ?? []);
      setTimetables(timetableResult.timetables ?? []);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not load admin data.",
      );
    } finally {
      setLoading(false);
    }
  }, [accessToken, enabled]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void refreshAll();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [refreshAll]);

  return {
    institutions,
    programmes,
    classGroups,
    academicPeriods,
    timetables,
    loading,
    error,
    refreshAll,
  };
}

function Surface({
  title,
  subtitle,
  children,
  actions,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="pilot-surface">
      <div className="pilot-surface-header">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {actions ? (
          <div className="pilot-surface-actions">{actions}</div>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="pilot-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function EmptyPanel({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty-state">
      <GraduationCap size={28} />
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}

function AdminNav({ path }: { path: string }) {
  const items = [
    { href: "/admin", label: "Overview" },
    { href: "/admin/analytics", label: "Analytics" },
    { href: "/admin/team", label: "Team" },
    { href: "/admin/institutions", label: "Institutions" },
    { href: "/admin/programmes", label: "Programmes" },
    { href: "/admin/class-groups", label: "Class groups" },
    { href: "/admin/academic-periods", label: "Academic periods" },
    { href: "/admin/timetables", label: "Timetables" },
    { href: "/admin/source-gateway", label: "Source Gateway" },
  ];

  return (
    <nav className="pilot-nav" aria-label="Admin">
      {items.map((item) => (
        <a
          key={item.href}
          href={item.href}
          aria-current={
            path === item.href || path.startsWith(`${item.href}/`)
              ? "page"
              : undefined
          }
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}

function SourceGatewayPage({
  accessToken,
  academicPeriods,
  classGroups,
  programmes,
}: {
  accessToken: string;
  academicPeriods: AdminAcademicPeriod[];
  classGroups: AdminClassGroup[];
  programmes: AdminProgramme[];
}) {
  const [state, setState] = useState<SourceGatewayState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setState(await fetchSourceGatewayState(accessToken));
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not load Source Gateway.",
      );
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [refresh]);

  const saveProgramme = async (discoveredId: string, programmeId: string) => {
    if (!programmeId) return;
    setSaving(discoveredId);
    try {
      await mapSourceGatewayProgramme(accessToken, discoveredId, programmeId);
      await refresh();
    } finally {
      setSaving("");
    }
  };

  const saveCohort = async (
    discoveredId: string,
    programmeId: string,
    cohortId: string,
    academicPeriodId: string,
  ) => {
    if (!programmeId || !cohortId || !academicPeriodId) return;
    setSaving(discoveredId);
    try {
      await mapSourceGatewayCohort(accessToken, discoveredId, {
        targetAcademicPeriodId: academicPeriodId,
        targetCohortId: cohortId,
        targetProgrammeId: programmeId,
      });
      await refresh();
    } finally {
      setSaving("");
    }
  };

  if (loading && !state) return <p>Loading Source Gateway...</p>;

  return (
    <div className="stack">
      {error ? <p className="content-notice">{error}</p> : null}
      <Surface
        title="Source Gateway"
        subtitle="Connected sources produce private review drafts only."
        actions={
          <button
            className="secondary"
            type="button"
            onClick={() => void refresh()}
          >
            <RefreshCw size={18} />
          </button>
        }
      >
        {state?.sources.length ? (
          <div className="source-gateway-grid">
            {state.sources.map((source) => {
              const sourceCohorts = state.cohorts.filter(
                (cohort) => cohort.source_id === source.id,
              );
              const mappedCount = sourceCohorts.filter(
                (cohort) => cohort.mapping_status === "mapped",
              ).length;
              const pendingReviews = state.reviews.filter(
                (review) =>
                  review.source_id === source.id && review.status === "pending",
              ).length;
              return (
                <article className="source-gateway-card" key={source.id}>
                  <div>
                    <strong>{source.display_name}</strong>
                    <span>
                      {source.parser_profile ?? "Parser not configured"}
                    </span>
                  </div>
                  <dl>
                    <div>
                      <dt>Cohorts</dt>
                      <dd>
                        {mappedCount}/{sourceCohorts.length} mapped
                      </dd>
                    </div>
                    <div>
                      <dt>Reviews</dt>
                      <dd>{pendingReviews} pending</dd>
                    </div>
                    <div>
                      <dt>Processing</dt>
                      <dd>
                        {source.last_processing_error_code ??
                          source.last_processing_completed_at ??
                          "Waiting"}
                      </dd>
                    </div>
                  </dl>
                  <button
                    className="secondary"
                    type="button"
                    onClick={async () => {
                      setSaving(source.id);
                      try {
                        await processLatestSourceSnapshot(
                          accessToken,
                          source.id,
                        );
                        await refresh();
                      } finally {
                        setSaving("");
                      }
                    }}
                    disabled={saving === source.id}
                  >
                    <RefreshCw size={18} />
                  </button>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyPanel
            title="No sources connected"
            text="Accepted snapshots will appear here once a source is configured."
          />
        )}
      </Surface>

      <Surface title="Programme Mapping">
        <div className="source-gateway-list">
          {(state?.programmes ?? []).map((programme) => (
            <article className="source-gateway-row" key={programme.id}>
              <div>
                <strong>{programme.source_programme_code}</strong>
                <span>{programme.session_count} sessions detected</span>
              </div>
              <select
                defaultValue={programme.target_programme_id ?? ""}
                onChange={(event) =>
                  void saveProgramme(programme.id, event.currentTarget.value)
                }
                disabled={saving === programme.id}
              >
                <option value="">Map programme</option>
                {programmes.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.name}
                  </option>
                ))}
              </select>
            </article>
          ))}
        </div>
      </Surface>

      <Surface title="Cohort Mapping">
        <div className="source-gateway-list">
          {(state?.cohorts ?? []).map((cohort) => {
            const targetProgrammeId = cohort.target_programme_id ?? "";
            const targetCohortId = cohort.target_cohort_id ?? "";
            const targetAcademicPeriodId =
              cohort.target_academic_period_id ?? "";
            return (
              <article className="source-gateway-row" key={cohort.id}>
                <div>
                  <strong>{cohort.source_cohort_code}</strong>
                  <span>
                    {cohort.session_count} sessions · {cohort.mapping_status}
                  </span>
                </div>
                <select
                  defaultValue={targetProgrammeId}
                  id={`${cohort.id}-programme`}
                >
                  <option value="">Programme</option>
                  {programmes.map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.name}
                    </option>
                  ))}
                </select>
                <select
                  defaultValue={targetCohortId}
                  id={`${cohort.id}-cohort`}
                >
                  <option value="">Class</option>
                  {classGroups.map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.label}
                    </option>
                  ))}
                </select>
                <select
                  defaultValue={targetAcademicPeriodId}
                  id={`${cohort.id}-period`}
                >
                  <option value="">Period</option>
                  {academicPeriods.map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.name}
                    </option>
                  ))}
                </select>
                <button
                  className="secondary"
                  type="button"
                  disabled={saving === cohort.id}
                  onClick={() => {
                    const programme = document.getElementById(
                      `${cohort.id}-programme`,
                    ) as HTMLSelectElement | null;
                    const classGroup = document.getElementById(
                      `${cohort.id}-cohort`,
                    ) as HTMLSelectElement | null;
                    const period = document.getElementById(
                      `${cohort.id}-period`,
                    ) as HTMLSelectElement | null;
                    void saveCohort(
                      cohort.id,
                      programme?.value ?? "",
                      classGroup?.value ?? "",
                      period?.value ?? "",
                    );
                  }}
                >
                  <Save size={18} />
                </button>
              </article>
            );
          })}
        </div>
      </Surface>

      <Surface title="Review Queue">
        <div className="source-gateway-list">
          {(state?.reviews ?? []).map((review) => (
            <article className="source-gateway-row" key={review.id}>
              <div>
                <strong>{review.source_cohort_code}</strong>
                <span>
                  {String(review.summary.sessionCount ?? 0)} source sessions ·{" "}
                  {review.status}
                </span>
              </div>
              <a
                className="secondary"
                href={`/admin/timetables/${review.timetable_id}`}
              >
                Review timetable
              </a>
            </article>
          ))}
        </div>
      </Surface>
    </div>
  );
}

function AnalyticsOverviewPage({ accessToken }: { accessToken: string }) {
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const params = useMemo(() => {
    const search = new URLSearchParams(window.location.search);
    if (!search.has("from") || !search.has("to")) {
      const today = new Date().toISOString().slice(0, 10);
      const from = new Date();
      from.setUTCDate(from.getUTCDate() - 6);
      search.set("from", search.get("from") ?? from.toISOString().slice(0, 10));
      search.set("to", search.get("to") ?? today);
    }
    return search;
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setOverview(await fetchAnalyticsOverview(accessToken, params));
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not load founder analytics.",
      );
    } finally {
      setLoading(false);
    }
  }, [accessToken, params]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [refresh]);

  const activeConnections = overview?.kpis.find(
    (metric) => metric.id === "activeCalendarConnections",
  );

  return (
    <div className="pilot-stack analytics-workspace">
      <Surface
        title="Analytics"
        subtitle="Founder-only product adoption and calendar health."
        actions={
          <button
            className="secondary"
            type="button"
            onClick={() => void refresh()}
          >
            Refresh
          </button>
        }
      >
        <div className="analytics-filter-bar" aria-label="Analytics filters">
          <span>{overview?.filters.from ?? params.get("from")}</span>
          <span>{overview?.filters.to ?? params.get("to")}</span>
          <span>{overview?.filters.timezone ?? "Africa/Harare"}</span>
          <a href="/admin/analytics">Reset filters</a>
        </div>
        {overview ? (
          <p className="pilot-muted">
            Last refreshed {formatTimestamp(overview.refreshedAt)}
          </p>
        ) : null}
      </Surface>

      {error ? (
        <Surface title="Analytics unavailable">
          <p className="content-notice">{error}</p>
        </Surface>
      ) : null}

      <section className="analytics-grid" aria-busy={loading}>
        <article className="analytics-primary">
          <span>Active calendar connections</span>
          <strong>{loading ? "..." : (activeConnections?.value ?? 0)}</strong>
          <p>Google, Apple/webcal, and subscription links. ICS is separate.</p>
        </article>
        {(overview?.kpis ?? []).slice(1).map((metric) => (
          <article key={metric.id} className="analytics-kpi">
            <span>{metric.label}</span>
            <strong>{loading ? "..." : metric.value}</strong>
          </article>
        ))}
      </section>

      <Surface
        title="Adoption trend"
        subtitle="Daily unique people and calendar connection movement."
      >
        {overview?.adoptionTimeseries.length ? (
          <div className="analytics-trend" role="list">
            {overview.adoptionTimeseries.map((point) => {
              const maxValue = Math.max(
                ...overview.adoptionTimeseries.map((item) =>
                  Math.max(item.uniquePeople, item.calendarConnections, 1),
                ),
              );
              return (
                <div key={point.date} role="listitem">
                  <span>{point.date.slice(5)}</span>
                  <div>
                    <i
                      style={{
                        blockSize: `${Math.max(
                          8,
                          (point.uniquePeople / maxValue) * 96,
                        )}px`,
                      }}
                      aria-label={`${point.uniquePeople} unique people`}
                    />
                    <b
                      style={{
                        blockSize: `${Math.max(
                          8,
                          (point.calendarConnections / maxValue) * 96,
                        )}px`,
                      }}
                      aria-label={`${point.calendarConnections} calendar connections`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyPanel
            title="Insufficient historical instrumentation"
            text="No adoption trend can be computed for the current date range."
          />
        )}
      </Surface>

      <Surface
        title="Conversion funnel"
        subtitle="Unique analytics people at each adoption step."
      >
        {loading ? <p>Loading funnel...</p> : null}
        {!loading && overview?.funnel.length === 0 ? (
          <EmptyPanel
            title="No funnel activity"
            text="No matching student journey events exist in this date range."
          />
        ) : (
          <div className="analytics-funnel">
            {overview?.funnel.map((stage) => (
              <button
                key={stage.stage}
                type="button"
                style={{
                  inlineSize: `${Math.max(
                    18,
                    Math.round((stage.conversionFromFirst ?? 1) * 100),
                  )}%`,
                }}
                aria-label={`${stage.stage}: ${stage.people} people`}
              >
                <span>{stage.stage}</span>
                <strong>{stage.people}</strong>
              </button>
            ))}
          </div>
        )}
      </Surface>

      <Surface
        title="Provider mix"
        subtitle="Setup choices vs active connections."
      >
        {overview?.providerMix.length ? (
          <div className="analytics-bars">
            {overview.providerMix.map((provider) => (
              <div key={provider.provider}>
                <span>{provider.provider}</span>
                <meter
                  min={0}
                  max={Math.max(
                    provider.setupChoices,
                    provider.activeConnections,
                    1,
                  )}
                  value={provider.activeConnections}
                />
                <strong>{provider.activeConnections}</strong>
              </div>
            ))}
          </div>
        ) : (
          <EmptyPanel
            title="No provider data"
            text="No calendar provider events match the current filters."
          />
        )}
      </Surface>

      <Surface title="Data quality">
        {overview ? (
          <div className="analytics-quality-grid">
            <span>Events received: {overview.dataQuality.eventsReceived}</span>
            <span>
              Anonymous identities:{" "}
              {overview.dataQuality.uniqueAnonymousIdentities}
            </span>
            <span>
              Subscription-linked:{" "}
              {overview.dataQuality.identitiesStitchedToSubscriptions}
            </span>
            <span>
              Consented contact rate:{" "}
              {Math.round(
                overview.dataQuality.consentedContactLinkageRate * 100,
              )}
              %
            </span>
            <span>
              Missing timetable: {overview.dataQuality.missingTimetableContext}
            </span>
            <span>
              Missing subscription:{" "}
              {overview.dataQuality.missingSubscriptionLinkage}
            </span>
            <span>
              Last ingestion:{" "}
              {overview.dataQuality.lastIngestionAt
                ? formatTimestamp(overview.dataQuality.lastIngestionAt)
                : "No events yet"}
            </span>
            <span>
              Persistence failures:{" "}
              {overview.dataQuality.persistenceFailures ?? "Not measured yet"}
            </span>
            {overview.dataQuality.knownHistoricalInstrumentationGaps.length ? (
              <div>
                <strong>Known gaps</strong>
                {overview.dataQuality.knownHistoricalInstrumentationGaps.map(
                  (gap) => (
                    <p key={gap}>{gap}</p>
                  ),
                )}
              </div>
            ) : null}
          </div>
        ) : (
          <p>Loading data quality...</p>
        )}
      </Surface>
    </div>
  );
}

function AdminOverview({
  accessToken,
  timetables,
}: {
  accessToken: string;
  timetables: AdminTimetableSummary[];
}) {
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [loadingPulse, setLoadingPulse] = useState(true);
  const [pulseError, setPulseError] = useState("");

  const params = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const from = new Date();
    from.setUTCDate(from.getUTCDate() - 6);
    const search = new URLSearchParams();
    search.set("from", from.toISOString().slice(0, 10));
    search.set("to", today);
    return search;
  }, []);

  const refreshPulse = useCallback(async () => {
    setLoadingPulse(true);
    setPulseError("");
    try {
      setOverview(await fetchAnalyticsOverview(accessToken, params));
    } catch (error) {
      setPulseError(
        error instanceof Error
          ? error.message
          : "Could not load operations overview.",
      );
    } finally {
      setLoadingPulse(false);
    }
  }, [accessToken, params]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void refreshPulse();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [refreshPulse]);

  const operations = overview?.operations;
  const pulse = operations?.pilotPulse;
  const activationLabel =
    pulse?.activationConversion === null ||
    pulse?.activationConversion === undefined
      ? "Not enough data"
      : `${Math.round(pulse.activationConversion * 100)}%`;

  return (
    <div className="pilot-stack">
      <Surface
        title="Pilot pulse"
        subtitle="Founder-only operations view for adoption, calendar health, and timetable trust."
        actions={
          <button
            className="secondary"
            type="button"
            onClick={() => void refreshPulse()}
          >
            <RefreshCw size={18} />
            Refresh
          </button>
        }
      >
        {pulseError ? <p className="content-notice">{pulseError}</p> : null}
        <div className="operations-pulse-grid" aria-busy={loadingPulse}>
          <article>
            <span>Timetable viewers</span>
            <strong>
              {loadingPulse ? "..." : (pulse?.uniqueTimetableViewers ?? 0)}
            </strong>
            <small>Unique analytics people in the selected 7-day window.</small>
          </article>
          <article>
            <span>Onboarding starts</span>
            <strong>
              {loadingPulse ? "..." : (pulse?.onboardingStarts ?? 0)}
            </strong>
            <small>Students opening or starting the calendar flow.</small>
          </article>
          <article>
            <span>Onboarding done</span>
            <strong>
              {loadingPulse ? "..." : (pulse?.onboardingCompletions ?? 0)}
            </strong>
            <small>
              Success-state completions, including direct Google success.
            </small>
          </article>
          <article>
            <span>Activation conversion</span>
            <strong>{loadingPulse ? "..." : activationLabel}</strong>
            <small>
              Created update-capable calendar connections / viewers.
            </small>
          </article>
          <article>
            <span>Update-enabled</span>
            <strong>
              {loadingPulse ? "..." : (pulse?.updateEnabledSubscriptions ?? 0)}
            </strong>
            <small>
              Active Google, Apple, webcal, or Outlook subscriptions.
            </small>
          </article>
          <article>
            <span>One-time ICS</span>
            <strong>
              {loadingPulse ? "..." : (pulse?.oneTimeIcsDownloads ?? 0)}
            </strong>
            <small>Prepared file downloads; not update-addressable.</small>
          </article>
          <article>
            <span>Feed observed</span>
            <strong>
              {loadingPulse ? "..." : (pulse?.feedObservedSubscriptions ?? 0)}
            </strong>
            <small>
              Feed requested by a client; not proof of a human active user.
            </small>
          </article>
          <article>
            <span>Shares</span>
            <strong>{loadingPulse ? "..." : (pulse?.shares ?? 0)}</strong>
            <small>
              Class link share events captured by first-party analytics.
            </small>
          </article>
        </div>
      </Surface>

      <Surface
        title="Subscriber health"
        subtitle="Prepared subscriptions and observed feed activity by class."
      >
        {loadingPulse ? <p>Loading subscriber health...</p> : null}
        {!loadingPulse && !operations?.subscriberHealth.length ? (
          <EmptyPanel
            title="No subscriber sample yet"
            text="The cockpit will show class-level subscription health once students create calendar connections."
          />
        ) : (
          <div className="operations-table" role="table">
            {(operations?.subscriberHealth ?? []).slice(0, 6).map((row) => (
              <article key={row.timetableId} role="row">
                <div>
                  <strong>{row.label}</strong>
                  <span>{row.publicSlug}</span>
                </div>
                <span>{row.activeSubscriptions} active</span>
                <span>{row.updateEnabledSubscriptions} update-enabled</span>
                <span>{row.oneTimeIcsDownloads} ICS</span>
                <span>{row.feedObservedSubscriptions} feed observed</span>
              </article>
            ))}
          </div>
        )}
      </Surface>

      <Surface
        title="Timetable trust"
        subtitle="Warnings first: source review, pinned corrections, exceptions, and Class Rep coverage."
      >
        {loadingPulse ? <p>Loading timetable trust...</p> : null}
        {!loadingPulse && !operations?.timetableTrust.length ? (
          <EmptyPanel
            title="No published timetable trust rows"
            text="Publish a timetable to see source and correction health here."
          />
        ) : (
          <div className="operations-trust-list">
            {(operations?.timetableTrust ?? []).slice(0, 6).map((row) => (
              <article key={row.timetableId}>
                <div>
                  <strong>{row.label}</strong>
                  <span>
                    Published{" "}
                    {row.currentPublishedAt
                      ? formatTimestamp(row.currentPublishedAt)
                      : "date unknown"}
                  </span>
                </div>
                {row.warnings.length ? (
                  <ul>
                    {row.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                ) : (
                  <span className="status confirmed">No warnings</span>
                )}
              </article>
            ))}
          </div>
        )}
      </Surface>

      <Surface
        title="Class Rep operations"
        subtitle="Coverage shortcuts for people who can keep class truth current."
      >
        <div className="operations-shortcut-grid">
          <a href="/admin/team">
            <strong>
              {loadingPulse
                ? "..."
                : (operations?.classRepOperations.activeClassReps ?? 0)}
            </strong>
            <span>Active Class Reps</span>
          </a>
          <a href="/admin/team">
            <strong>
              {loadingPulse
                ? "..."
                : (operations?.classRepOperations.assignedTimetables ?? 0)}
            </strong>
            <span>Assigned timetables</span>
          </a>
          <a href="/admin/timetables">
            <strong>
              {loadingPulse
                ? "..."
                : (operations?.classRepOperations
                    .unassignedPublishedTimetables ?? 0)}
            </strong>
            <span>Published without Class Rep</span>
          </a>
          <a href="/admin/team">
            <strong>
              {loadingPulse
                ? "..."
                : (operations?.classRepOperations.recentCorrections ?? 0)}
            </strong>
            <span>Recent corrections</span>
          </a>
        </div>
      </Surface>

      <Surface
        title="Get a class timetable live"
        subtitle="Create the class setup, enter weekly sessions, then publish one shareable link."
        actions={
          <a className="primary" href="/admin/timetables">
            <Plus size={18} />
            New timetable
          </a>
        }
      >
        {timetables.length === 0 ? (
          <EmptyPanel
            title="No timetables yet"
            text="Start with one institution, one programme, one class group, and one academic period."
          />
        ) : (
          <div className="pilot-card-list">
            {timetables.slice(0, 6).map((timetable) => (
              <article key={timetable.id} className="pilot-card">
                <div className="pilot-card-meta">
                  <span>{timetable.institutionName}</span>
                  <strong>{timetable.classGroupLabel}</strong>
                  <span>{timetable.programmeName}</span>
                  <span>{timetable.academicPeriodName}</span>
                </div>
                <div className="pilot-card-row">
                  <span
                    className={`status ${timetable.status === "Published" ? "confirmed" : ""}`}
                  >
                    {timetable.status}
                  </span>
                  <small>
                    Updated {formatTimestamp(timetable.lastUpdated)}
                  </small>
                </div>
                <div className="pilot-card-actions">
                  <a href={`/admin/timetables/${timetable.id}`}>Open</a>
                  {timetable.currentPublishedVersionId ? (
                    <a
                      href={`/t/${timetable.publicSlug}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Preview
                    </a>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </Surface>

      <Surface
        title="Manage setup"
        subtitle="These records power every timetable you publish."
      >
        <div className="pilot-manage-grid">
          <a href="/admin/institutions">Institutions</a>
          <a href="/admin/programmes">Programmes</a>
          <a href="/admin/class-groups">Class groups</a>
          <a href="/admin/academic-periods">Academic periods</a>
        </div>
      </Surface>
    </div>
  );
}

function TeamPage({
  accessToken,
  timetables,
}: {
  accessToken: string;
  timetables: AdminTimetableSummary[];
}) {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({
    email: "",
    displayName: "",
    timetableId: timetables[0]?.id ?? "",
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listStaff(accessToken);
      setStaff(result.staff);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not load staff.",
      );
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [refresh]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    try {
      await inviteClassRep(accessToken, {
        ...form,
        timetableId: form.timetableId || timetables[0]?.id || "",
      });
      setForm({
        email: "",
        displayName: "",
        timetableId: timetables[0]?.id ?? "",
      });
      await refresh();
      setMessage(
        "Class rep invitation sent. Existing users can sign in normally.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not invite class rep.",
      );
    }
  }

  async function updateAssignment(staffUserId: string, timetableId: string) {
    setMessage("");
    try {
      await assignClassRep(accessToken, staffUserId, timetableId);
      await refresh();
      setMessage("Class rep assignment updated.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not update assignment.",
      );
    }
  }

  async function action(task: () => Promise<unknown>, success: string) {
    setMessage("");
    try {
      await task();
      await refresh();
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request failed.");
    }
  }

  return (
    <div className="pilot-stack">
      <Surface
        title="Class Representatives"
        subtitle="Invite trusted class reps and scope each one to a single timetable."
      >
        <form className="pilot-form" onSubmit={submit}>
          <Field label="Class rep email">
            <input
              required
              type="email"
              value={form.email}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  email: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="Class rep name">
            <input
              required
              value={form.displayName}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  displayName: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="Assigned class timetable">
            <select
              required
              value={form.timetableId || timetables[0]?.id || ""}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  timetableId: event.target.value,
                }))
              }
            >
              {timetables.map((timetable) => (
                <option key={timetable.id} value={timetable.id}>
                  {timetable.classGroupLabel} - {timetable.programmeName}
                </option>
              ))}
            </select>
          </Field>
          <button
            className="primary"
            type="submit"
            disabled={timetables.length === 0}
          >
            <Plus size={18} />
            Invite Class Rep
          </button>
        </form>
        {message ? <p className="content-notice">{message}</p> : null}
      </Surface>

      <Surface
        title="Current team"
        subtitle="Resend, reassign, revoke, disable, or reactivate access."
      >
        {loading ? <p>Loading team...</p> : null}
        <div className="pilot-card-list">
          {staff.map((member) => (
            <article key={member.id} className="pilot-card">
              <div className="pilot-card-meta">
                <strong>
                  {member.displayName || member.email || member.userId}
                </strong>
                <span>
                  {member.role === "superadmin" ? "Superadmin" : "Class Rep"}
                </span>
                <span>{member.active ? "Active" : "Disabled"}</span>
                {member.assignments.find((assignment) => assignment.active) ? (
                  <span>
                    Assigned to{" "}
                    {
                      member.assignments.find((assignment) => assignment.active)
                        ?.classGroupLabel
                    }
                  </span>
                ) : null}
              </div>
              {member.role === "class_rep" ? (
                <div className="pilot-inline-actions">
                  <select
                    aria-label={`Assignment for ${member.displayName || member.email}`}
                    defaultValue={
                      member.assignments.find((assignment) => assignment.active)
                        ?.timetableId ?? ""
                    }
                    onChange={(event) =>
                      void updateAssignment(member.id, event.target.value)
                    }
                  >
                    <option value="">Choose timetable</option>
                    {timetables.map((timetable) => (
                      <option key={timetable.id} value={timetable.id}>
                        {timetable.classGroupLabel} - {timetable.programmeName}
                      </option>
                    ))}
                  </select>
                  {member.assignments
                    .filter((assignment) => assignment.active)
                    .map((assignment) => (
                      <button
                        key={assignment.id}
                        className="secondary"
                        type="button"
                        onClick={() =>
                          void action(
                            () =>
                              revokeClassRepAssignment(
                                accessToken,
                                assignment.id,
                              ),
                            "Assignment revoked.",
                          )
                        }
                      >
                        Revoke assignment
                      </button>
                    ))}
                  <button
                    className="secondary"
                    type="button"
                    onClick={() =>
                      void action(
                        () => resendClassRepInvite(accessToken, member.id),
                        "Invitation resent.",
                      )
                    }
                  >
                    Resend invitation
                  </button>
                </div>
              ) : null}
              <div className="pilot-card-actions">
                <button
                  className="secondary"
                  type="button"
                  onClick={() =>
                    void action(
                      () =>
                        setStaffActive(accessToken, member.id, !member.active),
                      member.active
                        ? "Staff member disabled."
                        : "Staff member reactivated.",
                    )
                  }
                >
                  {member.active ? "Disable" : "Reactivate"}
                </button>
              </div>
            </article>
          ))}
        </div>
      </Surface>
    </div>
  );
}

function InstitutionsPage({
  accessToken,
  institutions,
  refreshAll,
}: {
  accessToken: string;
  institutions: AdminInstitution[];
  refreshAll: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    name: "",
    shortName: "",
    slug: "",
    timezone: "Africa/Harare",
    active: true,
  });
  const [editing, setEditing] = useState<AdminInstitution | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      if (editing) {
        await updateInstitution(accessToken, editing.id, form);
      } else {
        await createInstitution(accessToken, form);
      }
      setForm({
        name: "",
        shortName: "",
        slug: "",
        timezone: "Africa/Harare",
        active: true,
      });
      setEditing(null);
      await refreshAll();
      setMessage(editing ? "Institution updated." : "Institution created.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not save institution.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pilot-stack">
      <Surface
        title="Institutions"
        subtitle="Use one clear record per university or college."
      >
        <div className="pilot-card-list">
          {institutions.map((institution) => (
            <article key={institution.id} className="pilot-card">
              <div className="pilot-card-meta">
                <strong>{institution.name}</strong>
                <span>{institution.shortName || "No short name"}</span>
                <span>{institution.timezone}</span>
              </div>
              <div className="pilot-card-actions">
                <button
                  className="secondary"
                  type="button"
                  onClick={() => {
                    setEditing(institution);
                    setForm({
                      name: institution.name,
                      shortName: institution.shortName ?? "",
                      slug: institution.slug,
                      timezone: institution.timezone,
                      active: institution.active,
                    });
                  }}
                >
                  Edit
                </button>
              </div>
            </article>
          ))}
        </div>
      </Surface>

      <Surface title={editing ? "Edit institution" : "Add institution"}>
        <form className="pilot-form" onSubmit={submit}>
          <Field label="Institution name">
            <input
              required
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
            />
          </Field>
          <Field label="Short name">
            <input
              value={form.shortName}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  shortName: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="Slug">
            <input
              value={form.slug}
              onChange={(event) =>
                setForm((current) => ({ ...current, slug: event.target.value }))
              }
            />
          </Field>
          <Field label="Timezone">
            <input
              value={form.timezone}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  timezone: event.target.value,
                }))
              }
            />
          </Field>
          <label className="pilot-checkbox">
            <input
              checked={form.active}
              type="checkbox"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  active: event.target.checked,
                }))
              }
            />
            Active
          </label>
          {message ? <p className="content-notice">{message}</p> : null}
          <div className="pilot-inline-actions">
            <button className="primary" disabled={saving} type="submit">
              <Save size={18} />
              {saving
                ? "Saving"
                : editing
                  ? "Save changes"
                  : "Create institution"}
            </button>
            {editing ? (
              <button
                className="secondary"
                type="button"
                onClick={() => {
                  setEditing(null);
                  setForm({
                    name: "",
                    shortName: "",
                    slug: "",
                    timezone: "Africa/Harare",
                    active: true,
                  });
                }}
              >
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      </Surface>
    </div>
  );
}

function ProgrammesPage({
  accessToken,
  institutions,
  programmes,
  refreshAll,
}: {
  accessToken: string;
  institutions: AdminInstitution[];
  programmes: AdminProgramme[];
  refreshAll: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    institutionId: institutions[0]?.id ?? "",
    name: "",
    code: "",
    slug: "",
    active: true,
  });
  const [editing, setEditing] = useState<AdminProgramme | null>(null);
  const [message, setMessage] = useState("");

  const selectedInstitutionId = form.institutionId || institutions[0]?.id || "";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    try {
      if (editing) {
        await updateProgramme(accessToken, editing.id, {
          ...form,
          institutionId: selectedInstitutionId,
        });
      } else {
        await createProgramme(accessToken, {
          ...form,
          institutionId: selectedInstitutionId,
        });
      }
      await refreshAll();
      setEditing(null);
      setForm({
        institutionId: institutions[0]?.id ?? "",
        name: "",
        code: "",
        slug: "",
        active: true,
      });
      setMessage(editing ? "Programme updated." : "Programme created.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not save programme.",
      );
    }
  }

  return (
    <div className="pilot-stack">
      <Surface
        title="Programmes"
        subtitle="Every programme belongs to one institution."
      >
        <div className="pilot-card-list">
          {programmes.map((programme) => (
            <article key={programme.id} className="pilot-card">
              <div className="pilot-card-meta">
                <strong>{programme.name}</strong>
                <span>{programme.institutionName}</span>
                <span>{programme.code || "No code"}</span>
              </div>
              <div className="pilot-card-actions">
                <button
                  className="secondary"
                  type="button"
                  onClick={() => {
                    setEditing(programme);
                    setForm({
                      institutionId: programme.institutionId,
                      name: programme.name,
                      code: programme.code ?? "",
                      slug: programme.slug,
                      active: programme.active,
                    });
                  }}
                >
                  Edit
                </button>
              </div>
            </article>
          ))}
        </div>
      </Surface>

      <Surface title={editing ? "Edit programme" : "Add programme"}>
        <form className="pilot-form" onSubmit={submit}>
          <Field label="Institution">
            <select
              required
              value={selectedInstitutionId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  institutionId: event.target.value,
                }))
              }
            >
              <option value="">Select institution</option>
              {institutions.map((institution) => (
                <option key={institution.id} value={institution.id}>
                  {institution.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Programme name">
            <input
              required
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
            />
          </Field>
          <Field label="Code">
            <input
              value={form.code}
              onChange={(event) =>
                setForm((current) => ({ ...current, code: event.target.value }))
              }
            />
          </Field>
          <Field label="Slug">
            <input
              value={form.slug}
              onChange={(event) =>
                setForm((current) => ({ ...current, slug: event.target.value }))
              }
            />
          </Field>
          <label className="pilot-checkbox">
            <input
              checked={form.active}
              type="checkbox"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  active: event.target.checked,
                }))
              }
            />
            Active
          </label>
          {message ? <p className="content-notice">{message}</p> : null}
          <button className="primary" type="submit">
            <Save size={18} />
            {editing ? "Save changes" : "Create programme"}
          </button>
        </form>
      </Surface>
    </div>
  );
}

function ClassGroupsPage({
  accessToken,
  programmes,
  classGroups,
  refreshAll,
}: {
  accessToken: string;
  programmes: AdminProgramme[];
  classGroups: AdminClassGroup[];
  refreshAll: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    programmeId: programmes[0]?.id ?? "",
    label: "",
    slug: "",
    yearLevel: "",
    semesterNumber: "",
    groupName: "",
    active: true,
  });
  const [editing, setEditing] = useState<AdminClassGroup | null>(null);
  const [message, setMessage] = useState("");

  const selectedProgrammeId = form.programmeId || programmes[0]?.id || "";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const payload = {
      programmeId: selectedProgrammeId,
      label: form.label,
      slug: form.slug || null,
      yearLevel: form.yearLevel ? Number(form.yearLevel) : null,
      semesterNumber: form.semesterNumber ? Number(form.semesterNumber) : null,
      groupName: form.groupName || null,
      active: form.active,
    };
    try {
      if (editing) {
        await updateClassGroup(accessToken, editing.id, payload);
      } else {
        await createClassGroup(accessToken, payload);
      }
      await refreshAll();
      setEditing(null);
      setForm({
        programmeId: programmes[0]?.id ?? "",
        label: "",
        slug: "",
        yearLevel: "",
        semesterNumber: "",
        groupName: "",
        active: true,
      });
      setMessage(editing ? "Class group updated." : "Class group created.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not save class group.",
      );
    }
  }

  return (
    <div className="pilot-stack">
      <Surface
        title="Class groups"
        subtitle="Database cohorts are presented as class groups in the pilot UI."
      >
        <div className="pilot-card-list">
          {classGroups.map((classGroup) => (
            <article key={classGroup.id} className="pilot-card">
              <div className="pilot-card-meta">
                <strong>{classGroup.label}</strong>
                <span>{classGroup.programmeName}</span>
                <span>
                  {classGroup.yearLevel
                    ? `Year ${classGroup.yearLevel}`
                    : "Year optional"}{" "}
                  ·{" "}
                  {classGroup.semesterNumber
                    ? `Semester ${classGroup.semesterNumber}`
                    : "Semester optional"}
                </span>
              </div>
              <div className="pilot-card-actions">
                <button
                  className="secondary"
                  type="button"
                  onClick={() => {
                    setEditing(classGroup);
                    setForm({
                      programmeId: classGroup.programmeId,
                      label: classGroup.label,
                      slug: classGroup.slug,
                      yearLevel: classGroup.yearLevel?.toString() ?? "",
                      semesterNumber:
                        classGroup.semesterNumber?.toString() ?? "",
                      groupName: classGroup.groupName ?? "",
                      active: classGroup.active,
                    });
                  }}
                >
                  Edit
                </button>
              </div>
            </article>
          ))}
        </div>
      </Surface>

      <Surface title={editing ? "Edit class group" : "Add class group"}>
        <form className="pilot-form" onSubmit={submit}>
          <Field label="Programme">
            <select
              required
              value={selectedProgrammeId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  programmeId: event.target.value,
                }))
              }
            >
              <option value="">Select programme</option>
              {programmes.map((programme) => (
                <option key={programme.id} value={programme.id}>
                  {programme.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Label">
            <input
              required
              value={form.label}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  label: event.target.value,
                }))
              }
              placeholder="Part 2.1"
            />
          </Field>
          <Field label="Slug">
            <input
              value={form.slug}
              onChange={(event) =>
                setForm((current) => ({ ...current, slug: event.target.value }))
              }
            />
          </Field>
          <Field label="Year level">
            <input
              inputMode="numeric"
              value={form.yearLevel}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  yearLevel: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="Semester number">
            <input
              inputMode="numeric"
              value={form.semesterNumber}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  semesterNumber: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="Group name">
            <input
              value={form.groupName}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  groupName: event.target.value,
                }))
              }
            />
          </Field>
          <label className="pilot-checkbox">
            <input
              checked={form.active}
              type="checkbox"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  active: event.target.checked,
                }))
              }
            />
            Active
          </label>
          {message ? <p className="content-notice">{message}</p> : null}
          <button className="primary" type="submit">
            <Save size={18} />
            {editing ? "Save changes" : "Create class group"}
          </button>
        </form>
      </Surface>
    </div>
  );
}

function AcademicPeriodsPage({
  accessToken,
  institutions,
  academicPeriods,
  refreshAll,
}: {
  accessToken: string;
  institutions: AdminInstitution[];
  academicPeriods: AdminAcademicPeriod[];
  refreshAll: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    institutionId: institutions[0]?.id ?? "",
    name: "",
    startsOn: "",
    endsOn: "",
    active: true,
  });
  const [editing, setEditing] = useState<AdminAcademicPeriod | null>(null);
  const [message, setMessage] = useState("");

  const selectedInstitutionId = form.institutionId || institutions[0]?.id || "";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    try {
      if (editing) {
        await updateAcademicPeriod(accessToken, editing.id, {
          ...form,
          institutionId: selectedInstitutionId,
        });
      } else {
        await createAcademicPeriod(accessToken, {
          ...form,
          institutionId: selectedInstitutionId,
        });
      }
      await refreshAll();
      setEditing(null);
      setForm({
        institutionId: institutions[0]?.id ?? "",
        name: "",
        startsOn: "",
        endsOn: "",
        active: true,
      });
      setMessage(
        editing ? "Academic period updated." : "Academic period created.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not save academic period.",
      );
    }
  }

  return (
    <div className="pilot-stack">
      <Surface
        title="Academic periods"
        subtitle="Use confirmed start and end dates."
      >
        <div className="pilot-card-list">
          {academicPeriods.map((period) => (
            <article key={period.id} className="pilot-card">
              <div className="pilot-card-meta">
                <strong>{period.name}</strong>
                <span>{period.institutionName}</span>
                <span>{formatPeriod(period)}</span>
              </div>
              <div className="pilot-card-actions">
                <button
                  className="secondary"
                  type="button"
                  onClick={() => {
                    setEditing(period);
                    setForm({
                      institutionId: period.institutionId,
                      name: period.name,
                      startsOn: period.startsOn ?? "",
                      endsOn: period.endsOn ?? "",
                      active: period.active,
                    });
                  }}
                >
                  Edit
                </button>
              </div>
            </article>
          ))}
        </div>
      </Surface>

      <Surface title={editing ? "Edit academic period" : "Add academic period"}>
        <form className="pilot-form" onSubmit={submit}>
          <Field label="Institution">
            <select
              required
              value={selectedInstitutionId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  institutionId: event.target.value,
                }))
              }
            >
              <option value="">Select institution</option>
              {institutions.map((institution) => (
                <option key={institution.id} value={institution.id}>
                  {institution.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Name">
            <input
              required
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="Semester 1, 2026"
            />
          </Field>
          <Field label="Starts on">
            <input
              required
              type="date"
              value={form.startsOn}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  startsOn: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="Ends on">
            <input
              required
              type="date"
              value={form.endsOn}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  endsOn: event.target.value,
                }))
              }
            />
          </Field>
          <label className="pilot-checkbox">
            <input
              checked={form.active}
              type="checkbox"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  active: event.target.checked,
                }))
              }
            />
            Active
          </label>
          {message ? <p className="content-notice">{message}</p> : null}
          <button className="primary" type="submit">
            <Save size={18} />
            {editing ? "Save changes" : "Create academic period"}
          </button>
        </form>
      </Surface>
    </div>
  );
}

function TimetableSetupForm({
  accessToken,
  institutions,
  programmes,
  classGroups,
  academicPeriods,
  refreshAll,
}: {
  accessToken: string;
  institutions: AdminInstitution[];
  programmes: AdminProgramme[];
  classGroups: AdminClassGroup[];
  academicPeriods: AdminAcademicPeriod[];
  refreshAll: () => Promise<void>;
}) {
  const [institutionId, setInstitutionId] = useState("");
  const [programmeId, setProgrammeId] = useState("");
  const [classGroupId, setClassGroupId] = useState("");
  const [academicPeriodId, setAcademicPeriodId] = useState("");
  const [message, setMessage] = useState("");

  const selectedInstitutionId = institutionId || institutions[0]?.id || "";
  const filteredProgrammes = programmes.filter(
    (programme) => programme.institutionId === selectedInstitutionId,
  );
  const selectedProgrammeId = filteredProgrammes.some(
    (item) => item.id === programmeId,
  )
    ? programmeId
    : filteredProgrammes[0]?.id || "";
  const filteredClassGroups = classGroups.filter(
    (classGroup) => classGroup.programmeId === selectedProgrammeId,
  );
  const selectedClassGroupId = filteredClassGroups.some(
    (item) => item.id === classGroupId,
  )
    ? classGroupId
    : filteredClassGroups[0]?.id || "";
  const filteredAcademicPeriods = academicPeriods.filter(
    (period) => period.institutionId === selectedInstitutionId,
  );
  const selectedAcademicPeriodId = filteredAcademicPeriods.some(
    (item) => item.id === academicPeriodId,
  )
    ? academicPeriodId
    : filteredAcademicPeriods[0]?.id || "";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    try {
      const result = await createTimetable(accessToken, {
        institutionId: selectedInstitutionId,
        programmeId: selectedProgrammeId,
        classGroupId: selectedClassGroupId,
        academicPeriodId: selectedAcademicPeriodId,
      });
      await refreshAll();
      navigate(`/admin/timetables/${result.timetable.timetable.id}`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not create timetable.",
      );
    }
  }

  return (
    <Surface
      title="New timetable"
      subtitle="Choose the academic setup, then enter weekly classes."
    >
      <form className="pilot-form" onSubmit={submit}>
        <Field label="Institution">
          <select
            value={selectedInstitutionId}
            onChange={(event) => setInstitutionId(event.target.value)}
          >
            <option value="">Select institution</option>
            {institutions.map((institution) => (
              <option key={institution.id} value={institution.id}>
                {institution.name}
              </option>
            ))}
          </select>
        </Field>
        <InlineCreateHint
          href="/admin/institutions"
          show={institutions.length === 0}
        >
          Add an institution first.
        </InlineCreateHint>

        <Field label="Programme">
          <select
            value={selectedProgrammeId}
            onChange={(event) => setProgrammeId(event.target.value)}
          >
            <option value="">Select programme</option>
            {filteredProgrammes.map((programme) => (
              <option key={programme.id} value={programme.id}>
                {programme.name}
              </option>
            ))}
          </select>
        </Field>
        <InlineCreateHint
          href="/admin/programmes"
          show={filteredProgrammes.length === 0}
        >
          Add a programme for this institution.
        </InlineCreateHint>

        <Field label="Class group">
          <select
            value={selectedClassGroupId}
            onChange={(event) => setClassGroupId(event.target.value)}
          >
            <option value="">Select class group</option>
            {filteredClassGroups.map((classGroup) => (
              <option key={classGroup.id} value={classGroup.id}>
                {classGroup.label}
              </option>
            ))}
          </select>
        </Field>
        <InlineCreateHint
          href="/admin/class-groups"
          show={filteredClassGroups.length === 0}
        >
          Add a class group for this programme.
        </InlineCreateHint>

        <Field label="Academic period">
          <select
            value={selectedAcademicPeriodId}
            onChange={(event) => setAcademicPeriodId(event.target.value)}
          >
            <option value="">Select academic period</option>
            {filteredAcademicPeriods.map((period) => (
              <option key={period.id} value={period.id}>
                {period.name}
              </option>
            ))}
          </select>
        </Field>
        <InlineCreateHint
          href="/admin/academic-periods"
          show={filteredAcademicPeriods.length === 0}
        >
          Add an academic period for this institution.
        </InlineCreateHint>

        {message ? <p className="content-notice">{message}</p> : null}
        <button
          className="primary"
          type="submit"
          disabled={
            !selectedInstitutionId ||
            !selectedProgrammeId ||
            !selectedClassGroupId ||
            !selectedAcademicPeriodId
          }
        >
          <Plus size={18} />
          Create timetable
        </button>
      </form>
    </Surface>
  );
}

function InlineCreateHint({
  show,
  href,
  children,
}: {
  show: boolean;
  href: string;
  children: React.ReactNode;
}) {
  if (!show) return null;
  return (
    <div className="pilot-inline-note">
      <span>{children}</span>
      <a href={href}>Open setup</a>
    </div>
  );
}

type SessionFormState = {
  id?: string;
  courseCode: string;
  courseName: string;
  weekday: string;
  startTime: string;
  endTime: string;
  venue: string;
  lecturer: string;
  sessionType: string;
  notes: string;
};

const emptySessionForm: SessionFormState = {
  courseCode: "",
  courseName: "",
  weekday: "1",
  startTime: "",
  endTime: "",
  venue: "",
  lecturer: "",
  sessionType: "",
  notes: "",
};

function sortAdminSessions(sessions: AdminTimetableSession[]) {
  return [...sessions].sort((left, right) => {
    if (left.weekday !== right.weekday) return left.weekday - right.weekday;
    if (left.startTime !== right.startTime) {
      return left.startTime.localeCompare(right.startTime);
    }
    if (left.endTime !== right.endTime) {
      return left.endTime.localeCompare(right.endTime);
    }
    return left.courseCode.localeCompare(right.courseCode);
  });
}

function duplicateSignature(session: AdminTimetableSession) {
  return [
    session.courseCode.trim().toLowerCase(),
    session.courseName.trim().toLowerCase(),
    session.weekday,
    session.startTime,
    session.endTime,
    session.venue?.trim().toLowerCase() || "",
    session.lecturer?.trim().toLowerCase() || "",
    session.sessionType?.trim().toLowerCase() || "",
  ].join("__");
}

function TimetableEditorSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading timetable"
      className="pilot-stack pilot-skeleton-shell"
    >
      <section className="pilot-surface">
        <div className="pilot-surface-header">
          <div className="pilot-skeleton-copy">
            <span className="pilot-skeleton-block pilot-skeleton-title" />
            <span className="pilot-skeleton-block pilot-skeleton-subtitle" />
          </div>
          <span className="pilot-skeleton-block pilot-skeleton-button" />
        </div>
        <div className="pilot-summary-grid">
          <span className="pilot-skeleton-block pilot-skeleton-card" />
          <span className="pilot-skeleton-block pilot-skeleton-card" />
          <span className="pilot-skeleton-block pilot-skeleton-card" />
        </div>
      </section>
      <section className="pilot-surface">
        <div className="pilot-day-stack">
          {Array.from({ length: 3 }, (_, index) => (
            <section key={index} className="pilot-day-group">
              <div className="pilot-day-header">
                <span className="pilot-skeleton-block pilot-skeleton-day" />
                <span className="pilot-skeleton-block pilot-skeleton-chip" />
              </div>
              <div className="pilot-session-list">
                <article className="pilot-session-card pilot-skeleton-card-shell">
                  <span className="pilot-skeleton-block pilot-skeleton-line-short" />
                  <span className="pilot-skeleton-block pilot-skeleton-line-medium" />
                  <span className="pilot-skeleton-block pilot-skeleton-line-long" />
                </article>
              </div>
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}

export function TimetableEditorPage({
  accessToken,
  timetableId,
}: {
  accessToken: string;
  timetableId: string;
}) {
  const [editor, setEditor] = useState<AdminTimetableEditor | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [refreshNotice, setRefreshNotice] = useState("");
  const [message, setMessage] = useState("");
  const [sessionForm, setSessionForm] =
    useState<SessionFormState>(emptySessionForm);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishLink, setPublishLink] = useState("");
  const [savingSession, setSavingSession] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(
    null,
  );
  const [dirtySessionForm, setDirtySessionForm] = useState(false);
  const [activeCourseField, setActiveCourseField] = useState<
    "code" | "name" | null
  >(null);
  const [saveFocusMode, setSaveFocusMode] = useState<"close" | "add-another">(
    "close",
  );
  const [highlightedSuggestionIndex, setHighlightedSuggestionIndex] =
    useState(0);
  const courseCodeInputRef = useRef<HTMLInputElement | null>(null);
  const savingSessionRef = useRef(false);
  const editorRef = useRef<AdminTimetableEditor | null>(null);
  const latestEditorRequestRef = useRef(0);
  const addButtonRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const returnFocusTargetRef = useRef<HTMLElement | null>(null);

  const loadEditor = useCallback(
    async ({
      background = false,
      refreshFailureMessage,
    }: {
      background?: boolean;
      refreshFailureMessage?: string;
    } = {}) => {
      const requestId = latestEditorRequestRef.current + 1;
      latestEditorRequestRef.current = requestId;
      const hasUsableEditor = editorRef.current !== null;

      if (background && hasUsableEditor) {
        setIsRefreshing(true);
        setRefreshNotice("");
      } else {
        setIsInitialLoading(true);
        setLoadError("");
      }

      try {
        const result = await getTimetable(accessToken, timetableId);
        if (requestId !== latestEditorRequestRef.current) return;
        editorRef.current = result.timetable;
        setEditor(result.timetable);
        setLoadError("");
        setRefreshNotice("");
      } catch (error) {
        if (requestId !== latestEditorRequestRef.current) return;
        const safeMessage =
          error instanceof Error ? error.message : "Could not load timetable.";
        if (background && editorRef.current) {
          setRefreshNotice(
            refreshFailureMessage ??
              "We couldn't refresh the timetable just now.",
          );
        } else {
          editorRef.current = null;
          setEditor(null);
          setLoadError(safeMessage);
        }
      } finally {
        if (requestId === latestEditorRequestRef.current) {
          if (background && hasUsableEditor) {
            setIsRefreshing(false);
          } else {
            setIsInitialLoading(false);
          }
        }
      }
    },
    [accessToken, timetableId],
  );

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadEditor();
    }, 0);
    return () => {
      window.clearTimeout(timeoutId);
      latestEditorRequestRef.current += 1;
    };
  }, [loadEditor]);

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  const sessionsByDay = useMemo(() => {
    const map = new Map<number, AdminTimetableSession[]>();
    for (let day = 1; day <= 7; day += 1) {
      map.set(day, []);
    }
    for (const session of editor?.sessions ?? []) {
      map.get(session.weekday)?.push(session);
    }
    return map;
  }, [editor]);

  const courseMemory = useMemo<CourseSuggestion[]>(
    () =>
      buildCourseMemoryEntries([
        ...(editor?.courseMemory ?? []),
        ...(editor?.sessions ?? []),
      ]),
    [editor],
  );

  const codeSuggestions = useMemo(
    () =>
      activeCourseField === "code"
        ? findCourseSuggestions(courseMemory, sessionForm.courseCode, "code")
        : [],
    [activeCourseField, courseMemory, sessionForm.courseCode],
  );
  const nameSuggestions = useMemo(
    () =>
      activeCourseField === "name"
        ? findCourseSuggestions(courseMemory, sessionForm.courseName, "name")
        : [],
    [activeCourseField, courseMemory, sessionForm.courseName],
  );

  const matchedCourse = useMemo(
    () =>
      courseMemory.find(
        (entry) =>
          entry.courseCode.toLowerCase() ===
          sessionForm.courseCode.trim().toLowerCase(),
      ) ?? null,
    [courseMemory, sessionForm.courseCode],
  );

  const duplicateSessionIds = useMemo(() => {
    const seen = new Map<string, string>();
    const duplicates = new Set<string>();
    for (const session of editor?.sessions ?? []) {
      const signature = duplicateSignature(session);
      const firstId = seen.get(signature);
      if (firstId) {
        duplicates.add(firstId);
        duplicates.add(session.id);
      } else {
        seen.set(signature, session.id);
      }
    }
    return duplicates;
  }, [editor]);

  function openNewSession(
    day: number,
    source?: AdminTimetableSession,
    trigger?: HTMLElement | null,
  ) {
    returnFocusTargetRef.current =
      trigger ?? addButtonRefs.current[day] ?? null;
    setSessionForm({
      id: undefined,
      courseCode: source?.courseCode ?? "",
      courseName: source?.courseName ?? "",
      weekday: String(day),
      startTime: source?.startTime ?? "",
      endTime: source?.endTime ?? "",
      venue: source?.venue ?? "",
      lecturer: source?.lecturer ?? "",
      sessionType: source?.sessionType ?? "",
      notes: source?.notes ?? "",
    });
    setDirtySessionForm(Boolean(source));
    setActiveCourseField(null);
    setHighlightedSuggestionIndex(0);
    setSheetOpen(true);
  }

  function openEditSession(
    session: AdminTimetableSession,
    trigger?: HTMLElement | null,
  ) {
    returnFocusTargetRef.current = trigger ?? null;
    setSessionForm({
      id: session.id,
      courseCode: session.courseCode,
      courseName: session.courseName,
      weekday: String(session.weekday),
      startTime: session.startTime,
      endTime: session.endTime,
      venue: session.venue ?? "",
      lecturer: session.lecturer ?? "",
      sessionType: session.sessionType ?? "",
      notes: session.notes ?? "",
    });
    setDirtySessionForm(false);
    setActiveCourseField(null);
    setHighlightedSuggestionIndex(0);
    setSheetOpen(true);
  }

  function updateSessionForm(
    update:
      SessionFormState | ((current: SessionFormState) => SessionFormState),
  ) {
    setSessionForm(update);
    setDirtySessionForm(true);
  }

  function closeSessionSheet() {
    if (savingSession) return;
    if (
      dirtySessionForm &&
      !window.confirm("Discard the changes to this class?")
    ) {
      return;
    }
    setSheetOpen(false);
    setSessionForm(emptySessionForm);
    setDirtySessionForm(false);
    setActiveCourseField(null);
    setSaveFocusMode("close");
    setHighlightedSuggestionIndex(0);
    window.setTimeout(() => returnFocusTargetRef.current?.focus(), 0);
  }

  function selectCourse(suggestion: CourseSuggestion) {
    setSessionForm((current) => applyCourseSuggestion(current, suggestion));
    setDirtySessionForm(true);
    setActiveCourseField(null);
    setHighlightedSuggestionIndex(0);
  }

  function handleSuggestionKeyDown(
    event: React.KeyboardEvent<HTMLInputElement>,
    suggestions: CourseSuggestion[],
  ) {
    if (suggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedSuggestionIndex((current) =>
        Math.min(current + 1, suggestions.length - 1),
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedSuggestionIndex((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      if (activeCourseField) {
        event.preventDefault();
        selectCourse(suggestions[highlightedSuggestionIndex] ?? suggestions[0]);
      }
      return;
    }
    if (event.key === "Escape") {
      setActiveCourseField(null);
      setHighlightedSuggestionIndex(0);
    }
  }

  async function saveSession(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || savingSessionRef.current) return;
    const submitter = (event.nativeEvent as SubmitEvent)
      .submitter as HTMLButtonElement | null;
    const mode = submitter?.value === "add-another" ? "add-another" : "close";
    savingSessionRef.current = true;
    setSavingSession(true);
    setSaveFocusMode(mode);
    setMessage("");
    setRefreshNotice("");
    const payload = {
      courseCode: sessionForm.courseCode,
      courseName: sessionForm.courseName,
      weekday: Number(sessionForm.weekday),
      startTime: sessionForm.startTime,
      endTime: sessionForm.endTime,
      venue: sessionForm.venue || null,
      lecturer: sessionForm.lecturer || null,
      sessionType: sessionForm.sessionType || null,
      notes: sessionForm.notes || null,
    };
    try {
      const result = sessionForm.id
        ? await updateTimetableSession(
            accessToken,
            editor.timetable.id,
            sessionForm.id,
            payload,
          )
        : await createTimetableSession(
            accessToken,
            editor.timetable.id,
            payload,
          );
      const savedSession = result.session;
      setEditor((current) => {
        if (!current) return current;
        const nextSessions = sessionForm.id
          ? current.sessions.map((session) =>
              session.id === savedSession.id ? savedSession : session,
            )
          : [...current.sessions, savedSession];
        return {
          ...current,
          sessions: sortAdminSessions(nextSessions),
          courseMemory: mergeCourseSuggestion(
            current.courseMemory,
            savedSession,
          ),
        };
      });
      setDirtySessionForm(false);
      const focusTarget = sessionForm.id
        ? returnFocusTargetRef.current
        : (addButtonRefs.current[Number(sessionForm.weekday)] ??
          returnFocusTargetRef.current);
      if (mode === "add-another") {
        setSessionForm({
          ...emptySessionForm,
          weekday: sessionForm.weekday,
        });
        setHighlightedSuggestionIndex(0);
        window.setTimeout(() => courseCodeInputRef.current?.focus(), 0);
      } else {
        setSheetOpen(false);
        setSessionForm(emptySessionForm);
        setHighlightedSuggestionIndex(0);
        window.setTimeout(() => focusTarget?.focus(), 0);
      }
      setMessage(
        `✓ ${savedSession.courseCode} ${sessionForm.id ? "updated" : "added"}`,
      );
      void loadEditor({
        background: true,
        refreshFailureMessage:
          "Saved. We couldn't refresh the timetable just now.",
      });
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not save class session.",
      );
    } finally {
      savingSessionRef.current = false;
      setSavingSession(false);
    }
  }

  async function removeSession(sessionId: string) {
    if (!editor) return;
    if (!window.confirm("Delete this class from the draft timetable?")) return;
    setDeletingSessionId(sessionId);
    try {
      setRefreshNotice("");
      const result = await deleteTimetableSession(
        accessToken,
        editor.timetable.id,
        sessionId,
      );
      setEditor((current) =>
        current
          ? {
              ...current,
              sessions: current.sessions.filter(
                (session) => session.id !== result.deletedSessionId,
              ),
            }
          : current,
      );
      setMessage("Class deleted.");
      void loadEditor({
        background: true,
        refreshFailureMessage:
          "Deleted. We couldn't refresh the timetable just now.",
      });
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not delete class.",
      );
    } finally {
      setDeletingSessionId(null);
    }
  }

  async function publishCurrent() {
    if (!editor) return;
    setPublishing(true);
    setMessage("");
    setRefreshNotice("");
    try {
      const result = await publishTimetable(accessToken, editor.timetable.id);
      const publicUrl = `${window.location.origin}/t/${result.publishResult.publicSlug}`;
      setPublishLink(publicUrl);
      setMessage("Timetable published.");
      void loadEditor({
        background: true,
        refreshFailureMessage:
          "Published. We couldn't refresh the timetable just now.",
      });
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not publish timetable.",
      );
    } finally {
      setPublishing(false);
    }
  }

  if (isInitialLoading && !editor) {
    return <TimetableEditorSkeleton />;
  }

  if (!editor) {
    return (
      <Surface title="Timetable unavailable">
        <p>{loadError || "The requested timetable could not be loaded."}</p>
      </Surface>
    );
  }

  return (
    <div className="pilot-stack">
      <Surface
        title={editor.timetable.classGroupLabel}
        subtitle={`${editor.timetable.programmeName} · ${editor.timetable.academicPeriodName}`}
        actions={
          <div className="pilot-inline-actions">
            {isRefreshing ? (
              <span className="pilot-sync-note">Syncing...</span>
            ) : null}
            {editor.timetable.currentPublishedVersionId ? (
              <a
                className="secondary"
                href={`/t/${editor.timetable.publicSlug}`}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={18} />
                Preview
              </a>
            ) : null}
            <button
              className="primary"
              onClick={publishCurrent}
              disabled={publishing}
            >
              <CalendarCheck size={18} />
              {publishing ? "Publishing" : "Publish"}
            </button>
          </div>
        }
      >
        <div className="pilot-summary-grid">
          <div>
            <strong>Status</strong>
            <p>{editor.activeVersion.status}</p>
          </div>
          <div>
            <strong>Public link</strong>
            <p>{editor.timetable.publicSlug}</p>
          </div>
          <div>
            <strong>Academic dates</strong>
            <p>
              {formatDate(editor.timetable.academicPeriodStartsOn)} -{" "}
              {formatDate(editor.timetable.academicPeriodEndsOn)}
            </p>
          </div>
        </div>
        {message ? <p className="content-notice">{message}</p> : null}
        {refreshNotice ? <p className="pilot-muted">{refreshNotice}</p> : null}
        {publishLink ? (
          <div className="pilot-publish-success">
            <div>
              <strong>Timetable is live</strong>
              <span>{publishLink}</span>
            </div>
            <div className="pilot-inline-actions">
              <button
                className="secondary"
                type="button"
                onClick={() => void copyText(publishLink)}
              >
                <Copy size={18} />
                Copy class link
              </button>
              <button
                className="secondary"
                type="button"
                onClick={() => {
                  if (navigator.share) {
                    void navigator.share({
                      title: "CalenderZW timetable",
                      url: publishLink,
                    });
                  } else {
                    void copyText(publishLink);
                  }
                }}
              >
                <Share2 size={18} />
                Share timetable
              </button>
            </div>
          </div>
        ) : null}
      </Surface>

      <Surface
        title="Weekly classes"
        subtitle="Add, edit, duplicate, and review recurring sessions by day."
      >
        {duplicateSessionIds.size > 0 ? (
          <p className="content-notice">
            Possible duplicate draft sessions detected. Review the highlighted
            cards and remove confirmed accidental duplicates.
          </p>
        ) : null}
        <div className="pilot-day-stack">
          {Array.from({ length: 7 }, (_, index) => index + 1).map((day) => {
            const sessions = sessionsByDay.get(day) ?? [];
            return (
              <section key={day} className="pilot-day-group">
                <div className="pilot-day-header">
                  <h3>{weekdayLabels[day]}</h3>
                  <button
                    className="secondary"
                    type="button"
                    ref={(element) => {
                      addButtonRefs.current[day] = element;
                    }}
                    onClick={(event) =>
                      openNewSession(day, undefined, event.currentTarget)
                    }
                  >
                    <Plus size={18} />
                    Add {weekdayLabels[day]} class
                  </button>
                </div>
                {sessions.length === 0 ? (
                  <p className="pilot-muted">
                    No classes added for {weekdayLabels[day].toLowerCase()} yet.
                  </p>
                ) : (
                  <div className="pilot-session-list">
                    {sessions.map((session) => (
                      <article
                        key={session.id}
                        className={`pilot-session-card${duplicateSessionIds.has(session.id) ? " duplicate-warning" : ""}`}
                      >
                        <div>
                          <strong>
                            {session.startTime.slice(0, 5)}-
                            {session.endTime.slice(0, 5)}
                          </strong>
                          <h4>{session.courseCode}</h4>
                          <p>{session.courseName}</p>
                          <span>
                            {session.venue || "Venue not set"}
                            {session.lecturer ? ` · ${session.lecturer}` : ""}
                          </span>
                        </div>
                        <div className="pilot-card-actions">
                          <button
                            className="secondary"
                            type="button"
                            onClick={(event) =>
                              openEditSession(session, event.currentTarget)
                            }
                          >
                            Edit
                          </button>
                          <button
                            className="secondary"
                            type="button"
                            onClick={(event) =>
                              openNewSession(day, session, event.currentTarget)
                            }
                          >
                            Duplicate
                          </button>
                          <button
                            className="secondary"
                            disabled={deletingSessionId === session.id}
                            type="button"
                            onClick={() => void removeSession(session.id)}
                          >
                            <Trash2 size={16} />
                            {deletingSessionId === session.id
                              ? "Deleting..."
                              : "Delete"}
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </Surface>

      {sheetOpen ? (
        <div className="sheet-backdrop" role="presentation">
          <section
            aria-labelledby="session-sheet-title"
            className="sync-sheet compact session-sheet"
            aria-modal="true"
            role="dialog"
          >
            <div className="sheet-header">
              <h2 id="session-sheet-title">
                {sessionForm.id ? "Edit class" : "Add class"}
              </h2>
              <button
                aria-label="Close class editor"
                className="icon-button"
                disabled={savingSession}
                type="button"
                onClick={closeSessionSheet}
              >
                x
              </button>
            </div>
            <form className="pilot-form" onSubmit={saveSession}>
              <Field label="Course code">
                <input
                  aria-activedescendant={
                    activeCourseField === "code" &&
                    codeSuggestions[highlightedSuggestionIndex]
                      ? `course-code-suggestion-${highlightedSuggestionIndex}`
                      : undefined
                  }
                  aria-controls="course-code-suggestions"
                  aria-expanded={
                    activeCourseField === "code" && codeSuggestions.length > 0
                  }
                  autoComplete="off"
                  ref={courseCodeInputRef}
                  required
                  value={sessionForm.courseCode}
                  onFocus={() => {
                    setActiveCourseField("code");
                    setHighlightedSuggestionIndex(0);
                  }}
                  onKeyDown={(event) =>
                    handleSuggestionKeyDown(event, codeSuggestions)
                  }
                  onChange={(event) => {
                    setActiveCourseField("code");
                    setHighlightedSuggestionIndex(0);
                    updateSessionForm((current) => ({
                      ...current,
                      courseCode: event.target.value,
                    }));
                  }}
                />
              </Field>
              {activeCourseField === "code" && codeSuggestions.length > 0 ? (
                <div
                  className="suggestion-list"
                  id="course-code-suggestions"
                  role="listbox"
                >
                  {codeSuggestions.map((suggestion, index) => (
                    <button
                      id={`course-code-suggestion-${index}`}
                      key={suggestion.courseCode}
                      aria-selected={highlightedSuggestionIndex === index}
                      className="suggestion-item"
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => selectCourse(suggestion)}
                    >
                      <strong>{suggestion.courseCode}</strong>
                      <span>{suggestion.courseName}</span>
                      {suggestion.lecturerSuggestions[0] ? (
                        <small>{suggestion.lecturerSuggestions[0]}</small>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
              <Field label="Course name">
                <input
                  aria-activedescendant={
                    activeCourseField === "name" &&
                    nameSuggestions[highlightedSuggestionIndex]
                      ? `course-name-suggestion-${highlightedSuggestionIndex}`
                      : undefined
                  }
                  aria-controls="course-name-suggestions"
                  aria-expanded={
                    activeCourseField === "name" && nameSuggestions.length > 0
                  }
                  autoComplete="off"
                  required
                  value={sessionForm.courseName}
                  onFocus={() => {
                    setActiveCourseField("name");
                    setHighlightedSuggestionIndex(0);
                  }}
                  onKeyDown={(event) =>
                    handleSuggestionKeyDown(event, nameSuggestions)
                  }
                  onChange={(event) => {
                    setActiveCourseField("name");
                    setHighlightedSuggestionIndex(0);
                    updateSessionForm((current) => ({
                      ...current,
                      courseName: event.target.value,
                    }));
                  }}
                />
              </Field>
              {activeCourseField === "name" && nameSuggestions.length > 0 ? (
                <div
                  className="suggestion-list"
                  id="course-name-suggestions"
                  role="listbox"
                >
                  {nameSuggestions.map((suggestion, index) => (
                    <button
                      id={`course-name-suggestion-${index}`}
                      key={suggestion.courseCode}
                      aria-selected={highlightedSuggestionIndex === index}
                      className="suggestion-item"
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => selectCourse(suggestion)}
                    >
                      <strong>{suggestion.courseCode}</strong>
                      <span>{suggestion.courseName}</span>
                      {suggestion.lecturerSuggestions[0] ? (
                        <small>{suggestion.lecturerSuggestions[0]}</small>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
              <Field label="Day">
                <select
                  value={sessionForm.weekday}
                  onChange={(event) =>
                    updateSessionForm((current) => ({
                      ...current,
                      weekday: event.target.value,
                    }))
                  }
                >
                  {weekdayLabels.slice(1).map((label, index) => (
                    <option key={label} value={String(index + 1)}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="pilot-two-col">
                <Field label="Start">
                  <input
                    required
                    type="time"
                    value={sessionForm.startTime}
                    onChange={(event) =>
                      updateSessionForm((current) => ({
                        ...current,
                        startTime: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="End">
                  <input
                    required
                    type="time"
                    value={sessionForm.endTime}
                    onChange={(event) =>
                      updateSessionForm((current) => ({
                        ...current,
                        endTime: event.target.value,
                      }))
                    }
                  />
                </Field>
              </div>
              <Field label="Venue">
                <input
                  value={sessionForm.venue}
                  onChange={(event) =>
                    updateSessionForm((current) => ({
                      ...current,
                      venue: event.target.value,
                    }))
                  }
                />
              </Field>
              {matchedCourse?.venueSuggestions.length ? (
                <div className="suggestion-chip-row" role="list">
                  {matchedCourse.venueSuggestions.map((venue) => (
                    <button
                      key={venue}
                      className="suggestion-chip"
                      type="button"
                      onClick={() =>
                        updateSessionForm((current) => ({ ...current, venue }))
                      }
                    >
                      {venue}
                    </button>
                  ))}
                </div>
              ) : null}
              <Field label="Lecturer">
                <input
                  value={sessionForm.lecturer}
                  onChange={(event) =>
                    updateSessionForm((current) => ({
                      ...current,
                      lecturer: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="Session type">
                <input
                  value={sessionForm.sessionType}
                  onChange={(event) =>
                    updateSessionForm((current) => ({
                      ...current,
                      sessionType: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="Notes">
                <textarea
                  rows={3}
                  value={sessionForm.notes}
                  onChange={(event) =>
                    updateSessionForm((current) => ({
                      ...current,
                      notes: event.target.value,
                    }))
                  }
                />
              </Field>
              <div className="session-sheet-actions">
                <button
                  className="secondary"
                  disabled={savingSession}
                  type="button"
                  onClick={closeSessionSheet}
                >
                  Cancel
                </button>
                <button
                  className="secondary"
                  disabled={savingSession}
                  type="submit"
                  value="add-another"
                >
                  {savingSession && saveFocusMode === "add-another"
                    ? "Saving..."
                    : "Save & add another"}
                </button>
                <button
                  className="primary"
                  disabled={savingSession}
                  type="submit"
                  value="save"
                >
                  <Save size={18} />
                  {savingSession && saveFocusMode === "close"
                    ? "Saving..."
                    : sessionForm.id
                      ? "Save class"
                      : "Add class"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function TimetablesPage({
  accessToken,
  institutions,
  programmes,
  classGroups,
  academicPeriods,
  timetables,
  refreshAll,
  path,
}: {
  accessToken: string;
  institutions: AdminInstitution[];
  programmes: AdminProgramme[];
  classGroups: AdminClassGroup[];
  academicPeriods: AdminAcademicPeriod[];
  timetables: AdminTimetableSummary[];
  refreshAll: () => Promise<void>;
  path: string;
}) {
  const match = path.match(/^\/admin\/timetables\/(.+)$/);
  if (match) {
    return (
      <TimetableEditorPage accessToken={accessToken} timetableId={match[1]} />
    );
  }

  return (
    <div className="pilot-stack">
      <TimetableSetupForm
        accessToken={accessToken}
        institutions={institutions}
        programmes={programmes}
        classGroups={classGroups}
        academicPeriods={academicPeriods}
        refreshAll={refreshAll}
      />
      <Surface title="Recent timetables">
        {timetables.length === 0 ? (
          <EmptyPanel
            title="Nothing created yet"
            text="New timetables will appear here after setup."
          />
        ) : (
          <div className="pilot-card-list">
            {timetables.map((timetable) => (
              <article key={timetable.id} className="pilot-card">
                <div className="pilot-card-meta">
                  <strong>{timetable.classGroupLabel}</strong>
                  <span>{timetable.programmeName}</span>
                  <span>{timetable.academicPeriodName}</span>
                </div>
                <div className="pilot-card-actions">
                  <a href={`/admin/timetables/${timetable.id}`}>Open</a>
                  {timetable.currentPublishedVersionId ? (
                    <a
                      href={`/t/${timetable.publicSlug}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Preview
                    </a>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </Surface>
    </div>
  );
}

function ClassRepDashboard({
  accessToken,
  session,
}: {
  accessToken: string;
  session: AdminSessionResponse;
}) {
  const assignment = session.assignments[0] ?? null;
  const [timetable, setTimetable] = useState<PublicTimetable | null>(null);
  const [message, setMessage] = useState("");
  const [extraForm, setExtraForm] = useState({
    exceptionDate: "2026-09-01",
    courseCode: "",
    courseName: "",
    startTime: "08:00",
    endTime: "10:00",
    venue: "",
    lecturer: "",
    reason: "",
    provenance: "",
  });
  const [correctionForm, setCorrectionForm] = useState({
    stableSessionKey: "",
    action: "modify" as "add" | "modify" | "remove",
    sourceMayReplace: true,
    courseCode: "",
    courseName: "",
    weekday: 2,
    startTime: "08:00",
    endTime: "10:00",
    venue: "",
    lecturer: "",
    reason: "",
    provenance: "",
  });

  useEffect(() => {
    let active = true;
    async function load() {
      if (!assignment?.publicSlug) return;
      try {
        const result = await fetchPublicTimetable(assignment.publicSlug);
        if (active) setTimetable(result);
      } catch (error) {
        if (active) {
          setMessage(
            error instanceof Error
              ? error.message
              : "Could not load your class timetable.",
          );
        }
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [assignment?.publicSlug]);

  async function submitExtra(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!assignment) return;
    setMessage("");
    try {
      await createTimetableException(accessToken, assignment.timetableId, {
        ...extraForm,
        exceptionType: "extra",
        sessionType: "Lecture",
      });
      setMessage("Extra class added. Students will see it for that date only.");
      if (assignment.publicSlug) {
        const result = await fetchPublicTimetable(assignment.publicSlug);
        setTimetable(result);
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not add extra class.",
      );
    }
  }

  async function submitCorrection(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!assignment) return;
    setMessage("");
    try {
      await createRecurringCorrection(accessToken, assignment.timetableId, {
        ...correctionForm,
        stableSessionKey: correctionForm.stableSessionKey || null,
        sessionType: "Lecture",
      });
      setMessage("Timetable correction saved.");
      if (assignment.publicSlug) {
        const result = await fetchPublicTimetable(assignment.publicSlug);
        setTimetable(result);
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not save timetable correction.",
      );
    }
  }

  if (!assignment) {
    return (
      <div className="pilot-stack">
        <Surface title="Your Class">
          <EmptyPanel
            title="No class assigned yet"
            text="Ask a superadmin to assign your class timetable."
          />
        </Surface>
      </div>
    );
  }

  const tomorrow = timetable ? getTomorrowSchedule(timetable) : null;
  const nextClass = timetable
    ? getUpcomingOccurrences(timetable, new Date(), 1)[0]
    : null;

  return (
    <div className="pilot-stack">
      <Surface
        title="Your Class"
        subtitle={`${assignment.classGroupLabel} - ${assignment.programmeName}`}
        actions={
          assignment.publicSlug ? (
            <a
              className="secondary"
              href={`/t/${assignment.publicSlug}`}
              target="_blank"
              rel="noreferrer"
            >
              Public timetable
            </a>
          ) : null
        }
      >
        {message ? <p className="content-notice">{message}</p> : null}
        <div className="pilot-manage-grid">
          <span>Tomorrow</span>
          <span>Next Class</span>
          <span>Current Schedule</span>
          <span>Recent Updates</span>
        </div>
      </Surface>

      <Surface title="Tomorrow" subtitle={tomorrow?.tomorrowLabel}>
        {tomorrow && tomorrow.sessions.length > 0 ? (
          <div className="pilot-card-list">
            {tomorrow.sessions.map((item) => (
              <article
                key={item.session.stableSessionKey}
                className="pilot-card"
              >
                <strong>{item.session.courseCode}</strong>
                <span>{item.session.courseName}</span>
                <span>
                  {item.session.startTime.slice(0, 5)} -{" "}
                  {item.session.endTime.slice(0, 5)}
                </span>
                <span>{item.session.venue || "Venue not set"}</span>
              </article>
            ))}
          </div>
        ) : (
          <EmptyPanel
            title="No classes tomorrow"
            text="Resolved schedule has no class tomorrow."
          />
        )}
      </Surface>

      <Surface title="Next Class">
        {nextClass ? (
          <article className="pilot-card">
            <strong>{nextClass.session.courseCode}</strong>
            <span>{nextClass.session.courseName}</span>
            <span>
              {formatOccurrenceTime(
                nextClass.start,
                timetable?.institutionTimezone || "Africa/Harare",
              )}
            </span>
          </article>
        ) : (
          <EmptyPanel
            title="No upcoming class"
            text="No upcoming class is currently resolved."
          />
        )}
      </Surface>

      <Surface title="Current Schedule">
        <div className="pilot-day-stack">
          {timetable?.sessions.map((sessionItem) => (
            <article
              key={sessionItem.stableSessionKey}
              className="pilot-session-card"
            >
              <strong>
                {weekdayLabels[sessionItem.weekday]}{" "}
                {sessionItem.startTime.slice(0, 5)}
              </strong>
              <span>{sessionItem.courseCode}</span>
              <span>{sessionItem.courseName}</span>
              <small>{sessionItem.venue || "Venue not set"}</small>
            </article>
          ))}
        </div>
      </Surface>

      <Surface
        title="Add Extra Class"
        subtitle="Adds one occurrence only. It will not repeat next week."
      >
        <form className="pilot-form" onSubmit={submitExtra}>
          <Field label="Date">
            <input
              required
              type="date"
              value={extraForm.exceptionDate}
              onChange={(event) =>
                setExtraForm((current) => ({
                  ...current,
                  exceptionDate: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="Course code">
            <input
              required
              value={extraForm.courseCode}
              onChange={(event) =>
                setExtraForm((current) => ({
                  ...current,
                  courseCode: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="Course name">
            <input
              required
              value={extraForm.courseName}
              onChange={(event) =>
                setExtraForm((current) => ({
                  ...current,
                  courseName: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="Start time">
            <input
              required
              type="time"
              value={extraForm.startTime}
              onChange={(event) =>
                setExtraForm((current) => ({
                  ...current,
                  startTime: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="End time">
            <input
              required
              type="time"
              value={extraForm.endTime}
              onChange={(event) =>
                setExtraForm((current) => ({
                  ...current,
                  endTime: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="Venue">
            <input
              value={extraForm.venue}
              onChange={(event) =>
                setExtraForm((current) => ({
                  ...current,
                  venue: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="Reason">
            <textarea
              required
              value={extraForm.reason}
              onChange={(event) =>
                setExtraForm((current) => ({
                  ...current,
                  reason: event.target.value,
                }))
              }
            />
          </Field>
          <button className="primary" type="submit">
            Add Extra Class
          </button>
        </form>
      </Surface>

      <Surface
        title="Update Timetable"
        subtitle="Create a recurring correction for your assigned class."
      >
        <form className="pilot-form" onSubmit={submitCorrection}>
          <Field label="Existing class to update">
            <select
              value={correctionForm.stableSessionKey}
              onChange={(event) => {
                const selected = timetable?.sessions.find(
                  (item) => item.stableSessionKey === event.target.value,
                );
                setCorrectionForm((current) => ({
                  ...current,
                  stableSessionKey: event.target.value,
                  action: event.target.value ? "modify" : "add",
                  courseCode: selected?.courseCode ?? current.courseCode,
                  courseName: selected?.courseName ?? current.courseName,
                  weekday: selected?.weekday ?? current.weekday,
                  startTime:
                    selected?.startTime.slice(0, 5) ?? current.startTime,
                  endTime: selected?.endTime.slice(0, 5) ?? current.endTime,
                  venue: selected?.venue ?? current.venue,
                  lecturer: selected?.lecturer ?? current.lecturer,
                }));
              }}
            >
              <option value="">Add new recurring class</option>
              {timetable?.sessions.map((sessionItem) => (
                <option
                  key={sessionItem.stableSessionKey}
                  value={sessionItem.stableSessionKey}
                >
                  {sessionItem.courseCode} -{" "}
                  {weekdayLabels[sessionItem.weekday]}{" "}
                  {sessionItem.startTime.slice(0, 5)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Correction type">
            <select
              value={correctionForm.action}
              onChange={(event) =>
                setCorrectionForm((current) => ({
                  ...current,
                  action: event.target.value as "add" | "modify" | "remove",
                }))
              }
            >
              <option value="modify">Update class</option>
              <option value="add">Add recurring class</option>
              <option value="remove">Remove recurring class</option>
            </select>
          </Field>
          <Field label="Course code">
            <input
              value={correctionForm.courseCode}
              onChange={(event) =>
                setCorrectionForm((current) => ({
                  ...current,
                  courseCode: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="Course name">
            <input
              value={correctionForm.courseName}
              onChange={(event) =>
                setCorrectionForm((current) => ({
                  ...current,
                  courseName: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="Weekday">
            <select
              value={correctionForm.weekday}
              onChange={(event) =>
                setCorrectionForm((current) => ({
                  ...current,
                  weekday: Number(event.target.value),
                }))
              }
            >
              {weekdayLabels.slice(1).map((label, index) => (
                <option key={label} value={index + 1}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Start time">
            <input
              type="time"
              value={correctionForm.startTime}
              onChange={(event) =>
                setCorrectionForm((current) => ({
                  ...current,
                  startTime: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="End time">
            <input
              type="time"
              value={correctionForm.endTime}
              onChange={(event) =>
                setCorrectionForm((current) => ({
                  ...current,
                  endTime: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="Venue">
            <input
              value={correctionForm.venue}
              onChange={(event) =>
                setCorrectionForm((current) => ({
                  ...current,
                  venue: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="Reason">
            <textarea
              required
              value={correctionForm.reason}
              onChange={(event) =>
                setCorrectionForm((current) => ({
                  ...current,
                  reason: event.target.value,
                }))
              }
            />
          </Field>
          <fieldset className="pilot-field">
            <legend>
              Can a future official timetable update replace this correction?
            </legend>
            <label className="pilot-checkbox">
              <input
                type="radio"
                name="source-may-replace"
                checked={correctionForm.sourceMayReplace}
                onChange={() =>
                  setCorrectionForm((current) => ({
                    ...current,
                    sourceMayReplace: true,
                  }))
                }
              />
              Yes - use newer official information when available
            </label>
            <label className="pilot-checkbox">
              <input
                type="radio"
                name="source-may-replace"
                checked={!correctionForm.sourceMayReplace}
                onChange={() =>
                  setCorrectionForm((current) => ({
                    ...current,
                    sourceMayReplace: false,
                  }))
                }
              />
              No - keep this correction until manually removed
            </label>
          </fieldset>
          <button className="primary" type="submit">
            Save correction
          </button>
        </form>
      </Surface>

      <Surface
        title="Source Differences"
        subtitle="Pinned corrections stay active until someone explicitly accepts newer official information."
      >
        <p className="pilot-muted">
          Official source reconciliation remains evidence-only here; ambiguous
          differences do not overwrite class-rep corrections.
        </p>
      </Surface>

      <Surface title="Recent Updates">
        {timetable?.corrections?.length || timetable?.exceptions?.length ? (
          <div className="pilot-card-list">
            {timetable?.corrections?.map((correction) => (
              <article key={correction.id} className="pilot-card">
                <strong>{correction.action} correction</strong>
                <span>{correction.reason}</span>
                <small>
                  {correction.sourceMayReplace
                    ? "Future official updates may replace it."
                    : "Kept until manually removed."}
                </small>
              </article>
            ))}
            {timetable?.exceptions?.map((exception) => (
              <article key={exception.id} className="pilot-card">
                <strong>{exception.exceptionType} exception</strong>
                <span>{exception.reason}</span>
                <small>{exception.exceptionDate}</small>
              </article>
            ))}
          </div>
        ) : (
          <EmptyPanel
            title="No updates yet"
            text="Corrections and extra classes will appear here."
          />
        )}
      </Surface>
    </div>
  );
}

export function AdminMvpScreen({ path }: { path: string }) {
  useDocumentMetadata(
    "CalenderZW Admin",
    "Create and publish class timetables.",
  );
  const { status, user, session, accessToken, signOut } = useAdminAccess();
  const isSuperadmin = session?.staff.role === "superadmin";
  const data = useAdminData(accessToken, isSuperadmin);

  if (status === "forbidden") {
    return (
      <main className="page admin-page">
        <section className="pilot-page-hero">
          <ShieldCheck size={28} />
          <div>
            <h1>Administrator access</h1>
            <p>This account does not have CalenderZW administrator access.</p>
          </div>
        </section>
        <Surface title="Access denied">
          <a href="/admin/login">Return to admin login</a>
        </Surface>
      </main>
    );
  }

  if (status === "login") {
    navigate("/admin/login", true);
    return null;
  }

  if (status !== "authorized" || !accessToken) {
    return (
      <main className="page admin-page">
        <section className="pilot-page-hero">
          <Lock size={28} />
          <div>
            <h1>Checking admin access</h1>
            <p>Verifying the current Supabase session.</p>
          </div>
        </section>
      </main>
    );
  }

  if (session?.staff.role === "class_rep") {
    return (
      <main className="page admin-page">
        <section className="pilot-page-hero">
          <ShieldCheck size={28} />
          <div>
            <h1>Class Rep Dashboard</h1>
            <p>
              {session.staff.displayName ||
                user?.email ||
                "Class rep session active"}
            </p>
          </div>
          <button
            className="secondary"
            type="button"
            onClick={() => void signOut()}
          >
            <LogOut size={18} />
            Sign out
          </button>
        </section>
        <ClassRepDashboard accessToken={accessToken} session={session} />
      </main>
    );
  }

  return (
    <main className="page admin-page">
      <section className="pilot-page-hero">
        <ShieldCheck size={28} />
        <div>
          <h1>CalenderZW Admin</h1>
          <p>{user?.email ?? "Administrator session active"}</p>
        </div>
        <button
          className="secondary"
          type="button"
          onClick={() => void signOut()}
        >
          <LogOut size={18} />
          Sign out
        </button>
      </section>
      <div className="pilot-admin-layout">
        <aside className="pilot-admin-sidebar">
          <AdminNav path={path} />
        </aside>
        <div className="pilot-admin-content">
          {data.error ? <p className="content-notice">{data.error}</p> : null}
          {data.loading && data.timetables.length === 0 ? (
            <p>Loading admin data...</p>
          ) : null}
          {path === "/admin" ? (
            <AdminOverview
              accessToken={accessToken}
              timetables={data.timetables}
            />
          ) : null}
          {path === "/admin/analytics" ? (
            <AnalyticsOverviewPage accessToken={accessToken} />
          ) : null}
          {path === "/admin/team" ? (
            <TeamPage accessToken={accessToken} timetables={data.timetables} />
          ) : null}
          {path === "/admin/institutions" ? (
            <InstitutionsPage
              accessToken={accessToken}
              institutions={data.institutions}
              refreshAll={data.refreshAll}
            />
          ) : null}
          {path === "/admin/programmes" ? (
            <ProgrammesPage
              accessToken={accessToken}
              institutions={data.institutions}
              programmes={data.programmes}
              refreshAll={data.refreshAll}
            />
          ) : null}
          {path === "/admin/class-groups" ? (
            <ClassGroupsPage
              accessToken={accessToken}
              programmes={data.programmes}
              classGroups={data.classGroups}
              refreshAll={data.refreshAll}
            />
          ) : null}
          {path === "/admin/academic-periods" ? (
            <AcademicPeriodsPage
              accessToken={accessToken}
              institutions={data.institutions}
              academicPeriods={data.academicPeriods}
              refreshAll={data.refreshAll}
            />
          ) : null}
          {path.startsWith("/admin/timetables") ? (
            <TimetablesPage
              accessToken={accessToken}
              institutions={data.institutions}
              programmes={data.programmes}
              classGroups={data.classGroups}
              academicPeriods={data.academicPeriods}
              timetables={data.timetables}
              refreshAll={data.refreshAll}
              path={path}
            />
          ) : null}
          {path === "/admin/source-gateway" ? (
            <SourceGatewayPage
              accessToken={accessToken}
              academicPeriods={data.academicPeriods}
              classGroups={data.classGroups}
              programmes={data.programmes}
            />
          ) : null}
        </div>
      </div>
    </main>
  );
}

export function FinderMvpScreen() {
  useDocumentMetadata(
    "Find timetable | CalenderZW",
    "Open a published class timetable.",
  );
  const [slug, setSlug] = useState("");

  return (
    <main className="page">
      <section className="pilot-page-hero">
        <Link2 size={28} />
        <div>
          <h1>Open a published timetable</h1>
          <p>
            Paste the shared class link or enter the final slug from the
            timetable URL.
          </p>
        </div>
      </section>
      <Surface title="Shared class link">
        <form
          className="pilot-form"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = slug.trim();
            if (!trimmed) return;
            try {
              const parsed = new URL(trimmed);
              if (parsed.pathname.startsWith("/t/")) {
                navigate(parsed.pathname);
                return;
              }
            } catch {
              // continue with raw slug
            }
            navigate(`/t/${trimmed.replace(/^\/?t\//, "")}`);
          }}
        >
          <Field label="Timetable link or slug">
            <input
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              placeholder="hit-btech-computer-science-part-2-1-semester-1-2026"
            />
          </Field>
          <button className="primary" type="submit">
            <ExternalLink size={18} />
            Open timetable
          </button>
        </form>
      </Surface>
    </main>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function LegacyPublicTimetableMvpScreen({ slug }: { slug: string }) {
  useDocumentMetadata(
    "Timetable | CalenderZW",
    "View a published timetable and add it to your calendar.",
  );
  const [timetable, setTimetable] = useState<PublicTimetable | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [message, setMessage] = useState("");
  const [reminderPreset, setReminderPreset] = useState<
    "prepared" | "on_time" | "commuter" | "custom"
  >("prepared");
  const [customReminders, setCustomReminders] = useState("30");
  const [calendarResult, setCalendarResult] = useState<{
    downloadUrl?: string;
    feedUrl?: string;
    webcalUrl?: string;
  } | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      setStatus("loading");
      try {
        const result = await fetchPublicTimetable(slug);
        if (!active) return;
        setTimetable(result);
        setStatus("ready");
      } catch (error) {
        if (!active) return;
        setMessage(
          error instanceof Error
            ? error.message
            : "This timetable is unavailable.",
        );
        setStatus("error");
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [slug]);

  const groupedSessions = useMemo(() => {
    const map = new Map<number, PublicTimetable["sessions"]>();
    for (let day = 1; day <= 7; day += 1) {
      map.set(day, []);
    }
    for (const session of timetable?.sessions ?? []) {
      map.get(session.weekday)?.push(session);
    }
    return map;
  }, [timetable]);

  async function prepareCalendar(
    provider: "ics_download" | "webcal_subscription" | "apple_subscription",
  ) {
    if (!timetable) return;
    try {
      const customReminderOffsets =
        reminderPreset === "custom"
          ? customReminders
              .split(",")
              .map((value) => Number(value.trim()))
              .filter((value) => Number.isFinite(value) && value > 0)
          : [];
      const result = await createCalendarSubscription({
        timetableId: timetable.timetableId,
        provider,
        reminderPreset,
        customReminderOffsets,
        timezone: timetable.institutionTimezone,
      });
      setCalendarResult({
        downloadUrl: result.downloadUrl,
        feedUrl: result.feedUrl,
        webcalUrl: result.appleSubscribeUrl,
      });
      setMessage("Calendar ready.");
      if (provider === "ics_download" && result.downloadUrl) {
        window.location.href = result.downloadUrl;
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not prepare the calendar.",
      );
    }
  }

  if (status === "loading") {
    return (
      <main className="page">
        <section className="pilot-page-hero">
          <CalendarCheck size={28} />
          <div>
            <h1>Loading timetable</h1>
            <p>Fetching the current published version.</p>
          </div>
        </section>
      </main>
    );
  }

  if (status === "error" || !timetable) {
    return (
      <main className="page">
        <section className="pilot-page-hero">
          <CalendarCheck size={28} />
          <div>
            <h1>Timetable unavailable</h1>
            <p>This timetable has not been published yet.</p>
          </div>
        </section>
        <Surface title="Try another link">
          <a href="/find">Open another timetable</a>
        </Surface>
      </main>
    );
  }

  return (
    <main className="page">
      <section className="pilot-page-hero">
        <CalendarCheck size={28} />
        <div>
          <h1>{timetable.classGroup}</h1>
          <p>
            {timetable.programme} · {timetable.academicPeriod}
          </p>
        </div>
      </section>
      <div className="pilot-public-layout">
        <div className="pilot-stack">
          <Surface
            title="Class timetable"
            subtitle={`${timetable.institution} · Published version ${timetable.versionNumber}`}
          >
            <div className="pilot-day-stack">
              {Array.from({ length: 7 }, (_, index) => index + 1).map((day) => {
                const sessions = groupedSessions.get(day) ?? [];
                if (sessions.length === 0) return null;
                return (
                  <section key={day} className="pilot-day-group">
                    <div className="pilot-day-header">
                      <h3>{weekdayLabels[day]}</h3>
                    </div>
                    <div className="pilot-session-list">
                      {sessions.map((session) => (
                        <article
                          key={session.stableSessionKey}
                          className="pilot-session-card"
                        >
                          <div>
                            <strong>
                              {session.startTime.slice(0, 5)}-
                              {session.endTime.slice(0, 5)}
                            </strong>
                            <h4>{session.courseCode}</h4>
                            <p>{session.courseName}</p>
                            <span>
                              {session.venue || "Venue not set"}
                              {session.lecturer ? ` · ${session.lecturer}` : ""}
                            </span>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          </Surface>
        </div>

        <aside className="side-panel">
          <h2>Add to calendar</h2>
          <Field label="Reminder preset">
            <select
              value={reminderPreset}
              onChange={(event) =>
                setReminderPreset(
                  event.target.value as
                    "prepared" | "on_time" | "commuter" | "custom",
                )
              }
            >
              <option value="prepared">Prepared</option>
              <option value="on_time">On time</option>
              <option value="commuter">Commuter</option>
              <option value="custom">Custom</option>
            </select>
          </Field>
          {reminderPreset === "custom" ? (
            <Field label="Custom reminder minutes">
              <input
                value={customReminders}
                onChange={(event) => setCustomReminders(event.target.value)}
                placeholder="1440,30"
              />
            </Field>
          ) : null}
          <button
            className="primary"
            type="button"
            onClick={() => void prepareCalendar("ics_download")}
          >
            <Download size={18} />
            Download calendar file
          </button>
          <button
            className="secondary"
            type="button"
            onClick={() => void prepareCalendar("webcal_subscription")}
          >
            <Link2 size={18} />
            Subscribe to updates
          </button>
          {message ? <p className="pilot-muted">{message}</p> : null}
          {calendarResult?.downloadUrl ? (
            <a href={calendarResult.downloadUrl}>Download .ics</a>
          ) : null}
          {calendarResult?.feedUrl ? (
            <>
              <button
                className="secondary"
                type="button"
                onClick={() => void copyText(calendarResult.feedUrl ?? "")}
              >
                <Copy size={18} />
                Copy calendar link
              </button>
              <a href={calendarResult.feedUrl} target="_blank" rel="noreferrer">
                Open HTTPS feed
              </a>
            </>
          ) : null}
          {calendarResult?.webcalUrl ? (
            <a href={calendarResult.webcalUrl}>Open in Apple Calendar</a>
          ) : null}
        </aside>
      </div>
    </main>
  );
}

type ReminderPresetId = "prepared" | "on_time" | "commuter" | "custom";
type PublicCalendarProvider =
  "apple_subscription" | "webcal_subscription" | "ics_download";

type PublicCalendarResult = {
  provider: PublicCalendarProvider;
  reminderPreset: ReminderPresetId;
  downloadUrl?: string;
  feedUrl?: string;
  appleSubscribeUrl?: string;
};

const reminderChoices: Array<{
  id: ReminderPresetId;
  title: string;
  detail: string;
  hint?: string;
}> = [
  {
    id: "on_time",
    title: "On time",
    detail: "30 minutes before",
    hint: "Recommended",
  },
  {
    id: "prepared",
    title: "Prepared",
    detail: "24 hours + 30 minutes before",
  },
  {
    id: "commuter",
    title: "Commuter",
    detail: "60 minutes + 15 minutes before",
  },
  {
    id: "custom",
    title: "Custom",
    detail: "Choose your own reminder minutes",
  },
];

function getReminderChoice(preset: ReminderPresetId) {
  return (
    reminderChoices.find((choice) => choice.id === preset) ?? reminderChoices[0]
  );
}

function buildTimetableSharePayload(
  timetable: PublicTimetable,
  publicUrl: string,
) {
  return {
    title: `${formatClassGroupLabel(timetable.classGroup)} timetable`,
    text:
      `${formatClassGroupLabel(timetable.classGroup)} timetable is ready on CalenderZW.\n\n` +
      "View the published timetable and add it to your calendar with reminders:\n\n" +
      `${publicUrl}\n\n` +
      "No app needed.",
    url: publicUrl,
  };
}

function getCalendarMethods(device: DeviceKind) {
  if (device === "ios") {
    return [
      {
        provider: "apple_subscription" as const,
        title: "Subscribe in Apple Calendar",
        description: "Stay connected to future published timetable changes.",
        accent: "Best on iPhone",
      },
      {
        provider: "ics_download" as const,
        title: "Download calendar file",
        description: "Import this timetable as a one-time calendar file.",
      },
    ];
  }

  if (device === "android") {
    return [
      {
        provider: "ics_download" as const,
        title: "Download calendar file",
        description: "Works on Android without needing an account.",
        accent: "Best supported",
      },
      {
        provider: "webcal_subscription" as const,
        title: "Copy subscription link",
        description:
          "Google Calendar URL subscriptions may require desktop setup.",
      },
      {
        provider: null,
        title: "Google Calendar direct sync",
        description: "Coming soon",
      },
    ];
  }

  return [
    {
      provider: "webcal_subscription" as const,
      title: "Subscribe using calendar URL",
      description:
        "Use this in Apple Calendar, Outlook, or another calendar app.",
      accent: "Keeps future updates",
    },
    {
      provider: "ics_download" as const,
      title: "Download .ics",
      description: "Import a one-time calendar file.",
    },
  ];
}

function triggerCalendarDownload(url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.rel = "noreferrer";
  link.target = "_blank";
  document.body.append(link);
  link.click();
  link.remove();
}

function getFocusableElements(root: HTMLElement | null) {
  if (!root) return [];
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute("hidden"));
}

export function PublicTimetableMvpScreen({ slug }: { slug: string }) {
  const [timetable, setTimetable] = useState<PublicTimetable | null>(null);
  const metadata = timetable ? buildPublicTimetableMetadata(timetable) : null;
  useDocumentMetadata(
    metadata ? `${metadata.title} | CalenderZW` : "Timetable | CalenderZW",
    metadata?.description ??
      "View a published timetable and add it to your calendar.",
  );
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [viewMode, setViewMode] = useState<"upcoming" | "week">("upcoming");
  const [reminderPreset, setReminderPreset] =
    useState<ReminderPresetId>("on_time");
  const [customReminderHours, setCustomReminderHours] = useState("1");
  const [customReminderMinutes, setCustomReminderMinutes] = useState("30");
  const [calendarResult, setCalendarResult] =
    useState<PublicCalendarResult | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [calendarError, setCalendarError] = useState("");
  const [calendarBusy, setCalendarBusy] =
    useState<PublicCalendarProvider | null>(null);
  const [shareState, setShareState] = useState<"idle" | "copied" | "manual">(
    "idle",
  );
  const [stickyVisible, setStickyVisible] = useState(false);
  const triggerButtonRef = useRef<HTMLButtonElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      setStatus("loading");
      try {
        const result = await fetchPublicTimetable(slug);
        if (!active) return;
        setTimetable(result);
        setStatus("ready");
        track("timetable_viewed", {
          publicSlug: result.publicSlug,
        });
      } catch {
        if (!active) return;
        setStatus("error");
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [slug]);

  const groupedSessions = useMemo(() => {
    const map = new Map<number, PublicTimetable["sessions"]>();
    for (let day = 1; day <= 7; day += 1) {
      map.set(day, []);
    }
    for (const session of timetable?.sessions ?? []) {
      map.get(session.weekday)?.push(session);
    }
    return map;
  }, [timetable]);

  const deviceKind = useMemo(
    () =>
      detectDevice(
        window.navigator.userAgent,
        window.navigator.maxTouchPoints ?? 0,
      ),
    [],
  );
  const upcoming = useMemo(
    () => (timetable ? getUpcomingOccurrences(timetable, new Date(), 3) : []),
    [timetable],
  );
  const nextClass = upcoming[0] ?? null;
  const publicUrl = timetable
    ? `${window.location.origin}/t/${encodeURIComponent(timetable.publicSlug)}`
    : "";
  const reminderChoice = getReminderChoice(reminderPreset);
  const calendarMethods = getCalendarMethods(deviceKind);
  const customReminderOffset = useMemo(() => {
    const hours = Number(customReminderHours.trim() || "0");
    const minutes = Number(customReminderMinutes.trim() || "0");
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    if (hours < 0 || minutes < 0) return null;
    const totalMinutes = hours * 60 + minutes;
    return totalMinutes > 0 ? totalMinutes : null;
  }, [customReminderHours, customReminderMinutes]);

  useEffect(() => {
    if (!sheetOpen) return;
    const triggerElement = triggerButtonRef.current;
    lastFocusedRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : triggerElement;
    const frame = window.requestAnimationFrame(() => {
      getFocusableElements(sheetRef.current)[0]?.focus();
    });

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setSheetOpen(false);
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = getFocusableElements(sheetRef.current);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      const focusTarget = triggerElement ?? lastFocusedRef.current;
      window.setTimeout(() => focusTarget?.focus(), 0);
    };
  }, [sheetOpen]);

  useEffect(() => {
    function onScroll() {
      setStickyVisible(
        window.innerWidth <= 820 && window.scrollY > 260 && !sheetOpen,
      );
    }

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [sheetOpen]);

  async function prepareCalendar(provider: PublicCalendarProvider) {
    if (!timetable) return;
    setCalendarBusy(provider);
    setCalendarError("");
    try {
      const customReminderOffsets =
        reminderPreset === "custom"
          ? customReminderOffset
            ? [customReminderOffset]
            : []
          : [];
      const result = await createCalendarSubscription({
        timetableId: timetable.timetableId,
        provider,
        reminderPreset,
        customReminderOffsets,
        timezone: timetable.institutionTimezone,
      });
      setCalendarResult({
        provider,
        reminderPreset,
        downloadUrl: result.downloadUrl,
        feedUrl: result.feedUrl,
        appleSubscribeUrl: result.appleSubscribeUrl,
      });
      setSheetOpen(false);
      track("subscription_created", {
        publicSlug: timetable.publicSlug,
        provider,
      });
      track("calendar_method_selected", {
        publicSlug: timetable.publicSlug,
        provider,
      });
      if (provider === "ics_download" && result.downloadUrl) {
        track("ics_downloaded", {
          publicSlug: timetable.publicSlug,
        });
        triggerCalendarDownload(result.downloadUrl);
      }
      if (provider === "apple_subscription" && result.appleSubscribeUrl) {
        window.location.assign(result.appleSubscribeUrl);
      }
    } catch (error) {
      setCalendarError(
        error instanceof Error
          ? error.message
          : "We couldn't prepare your calendar just now.",
      );
    } finally {
      setCalendarBusy(null);
    }
  }

  async function handleShare() {
    if (!timetable) return;
    const payload = buildTimetableSharePayload(timetable, publicUrl);
    try {
      if (navigator.share) {
        await navigator.share(payload);
        track("timetable_shared", {
          method: "web-share",
          publicSlug: timetable.publicSlug,
        });
        setShareState("idle");
        return;
      }
      await copyText(publicUrl);
      track("timetable_shared", {
        method: "copy-link",
        publicSlug: timetable.publicSlug,
      });
      setShareState("copied");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      try {
        await copyText(publicUrl);
        track("timetable_shared", {
          method: "copy-link",
          publicSlug: timetable.publicSlug,
        });
        setShareState("copied");
      } catch {
        setShareState("manual");
      }
    }
  }

  async function copySubscriptionLink() {
    if (!calendarResult?.feedUrl) return;
    try {
      await copyText(calendarResult.feedUrl);
      track("subscription_link_copied", {
        publicSlug: timetable?.publicSlug,
      });
      setCalendarError("Copied");
    } catch {
      setCalendarError("Select and copy the subscription URL below.");
    }
  }

  function openSheet() {
    setSheetOpen(true);
    setCalendarError("");
    track("calendar_cta_clicked", {
      publicSlug: timetable?.publicSlug,
    });
  }

  function closeSheet() {
    setSheetOpen(false);
    setCalendarError("");
  }

  function renderDeliverySuccess() {
    if (!timetable || !calendarResult) return null;

    const primaryLabel =
      calendarResult.provider === "apple_subscription"
        ? "Subscribe in Apple Calendar"
        : calendarResult.provider === "webcal_subscription"
          ? "Copy subscription link"
          : "Download calendar file";

    return (
      <section className="public-success-card" aria-live="polite">
        <div className="public-success-copy">
          <span className="public-kicker">Your timetable is ready</span>
          <h2>{timetable.programme}</h2>
          <p>
            {formatClassGroupLabel(timetable.classGroup)} -{" "}
            {timetable.sessions.length} weekly classes
          </p>
          <p>{reminderChoice.title} reminders</p>
        </div>
        <div className="public-success-actions">
          {calendarResult.provider === "apple_subscription" &&
          calendarResult.appleSubscribeUrl ? (
            <a className="primary" href={calendarResult.appleSubscribeUrl}>
              <Link2 size={18} />
              {primaryLabel}
            </a>
          ) : null}
          {calendarResult.provider === "webcal_subscription" ? (
            <button
              className="primary"
              type="button"
              onClick={() => void copySubscriptionLink()}
            >
              <Copy size={18} />
              {primaryLabel}
            </button>
          ) : null}
          {calendarResult.provider === "ics_download" ? (
            <button
              className="primary"
              type="button"
              onClick={() => {
                if (calendarResult.downloadUrl) {
                  triggerCalendarDownload(calendarResult.downloadUrl);
                }
              }}
            >
              <Download size={18} />
              {primaryLabel}
            </button>
          ) : null}
          <button
            className="secondary light"
            type="button"
            onClick={() => void handleShare()}
          >
            <Share2 size={18} />
            Share with classmates
          </button>
        </div>
        {calendarResult.feedUrl ? (
          <div className="subscription-link-panel">
            <label htmlFor="subscription-link">Private subscription link</label>
            <input
              id="subscription-link"
              readOnly
              value={calendarResult.feedUrl}
              onFocus={(event) => event.currentTarget.select()}
            />
          </div>
        ) : null}
      </section>
    );
  }

  function renderNextClassCard() {
    if (!timetable) return null;
    if (!nextClass) {
      return (
        <article className="public-next-card">
          <span className="public-kicker">Next class</span>
          <strong>No upcoming classes</strong>
          <p>
            This timetable has no more classes inside the current academic
            period.
          </p>
        </article>
      );
    }

    return (
      <article className="public-next-card">
        <span className="public-kicker">Next class</span>
        <strong>
          {nextClass.relativeLabel} -{" "}
          {formatOccurrenceTime(nextClass.start, timetable.institutionTimezone)}
        </strong>
        <h2>{nextClass.session.courseName}</h2>
        <p>{nextClass.session.courseCode}</p>
        <span>
          {nextClass.session.venue || "Venue not set"}
          {nextClass.session.lecturer ? ` - ${nextClass.session.lecturer}` : ""}
        </span>
      </article>
    );
  }

  if (status === "loading") {
    return (
      <main className="page">
        <section className="pilot-page-hero">
          <CalendarCheck size={28} />
          <div>
            <h1>Loading timetable</h1>
            <p>Fetching the current published version.</p>
          </div>
        </section>
      </main>
    );
  }

  if (status === "error" || !timetable) {
    return (
      <main className="page">
        <section className="pilot-page-hero">
          <CalendarCheck size={28} />
          <div>
            <h1>Timetable unavailable</h1>
            <p>This timetable has not been published yet.</p>
          </div>
        </section>
        <Surface title="Try another link">
          <a href="/find">Open another timetable</a>
        </Surface>
      </main>
    );
  }

  return (
    <main className="page public-timetable-page">
      <section className="public-hero">
        <div className="public-hero-copy">
          <span className="public-kicker">CalenderZW public timetable</span>
          <p className="public-institution">
            {getInstitutionIdentity(timetable)}
          </p>
          <h1>{timetable.programme}</h1>
          <p className="public-class-group">
            {formatClassGroupLabel(timetable.classGroup)}
          </p>
          <p className="public-academic-period">{timetable.academicPeriod}</p>
          <div className="public-trust-row">
            <span className="public-trust-badge">
              <ShieldCheck size={16} />
              Published by CalenderZW
            </span>
            <span className="public-trust-meta">
              Updated{" "}
              {formatPublishedTimestamp(
                timetable.publishedAt,
                timetable.institutionTimezone,
              )}
            </span>
          </div>
          {renderNextClassCard()}
          <div className="public-hero-actions">
            <button
              ref={triggerButtonRef}
              className="primary"
              type="button"
              onClick={openSheet}
            >
              <CalendarCheck size={18} />
              Add timetable to my calendar
            </button>
            <p className="public-helper">
              No account needed. Choose your reminders.
            </p>
            <button
              className="secondary light"
              type="button"
              onClick={() => void handleShare()}
            >
              <Share2 size={18} />
              Share with classmates
            </button>
            {shareState === "copied" ? (
              <p className="pilot-muted">Copied</p>
            ) : null}
            {shareState === "manual" ? (
              <div className="share-fallback-panel">
                <label htmlFor="public-timetable-url">
                  Public timetable link
                </label>
                <input
                  id="public-timetable-url"
                  readOnly
                  value={publicUrl}
                  onFocus={(event) => event.currentTarget.select()}
                />
              </div>
            ) : null}
          </div>
        </div>
        <div className="public-hero-side">{renderDeliverySuccess()}</div>
      </section>

      <div className="public-schedule-layout">
        <section className="pilot-surface public-schedule-surface">
          <div className="public-schedule-header">
            <div>
              <span className="public-kicker">Browse timetable</span>
              <h2>Useful now, full week when you need it</h2>
            </div>
            <div
              className="public-view-toggle"
              role="tablist"
              aria-label="Timetable view"
            >
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === "upcoming"}
                className={viewMode === "upcoming" ? "selected" : ""}
                onClick={() => setViewMode("upcoming")}
              >
                Upcoming
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === "week"}
                className={viewMode === "week" ? "selected" : ""}
                onClick={() => setViewMode("week")}
              >
                Week
              </button>
            </div>
          </div>

          {viewMode === "upcoming" ? (
            upcoming.length > 0 ? (
              <div className="public-upcoming-list">
                {upcoming.map((item) => (
                  <article
                    key={`${item.session.stableSessionKey}-${item.dateKey}`}
                    className="public-upcoming-card"
                  >
                    <div>
                      <span className="public-upcoming-time">
                        {item.relativeLabel} -{" "}
                        {formatOccurrenceTime(
                          item.start,
                          timetable.institutionTimezone,
                        )}
                      </span>
                      <h3>{item.session.courseName}</h3>
                      <p>{item.session.courseCode}</p>
                    </div>
                    <span className="public-upcoming-meta">
                      {item.session.venue || "Venue not set"}
                      {item.session.lecturer
                        ? ` - ${item.session.lecturer}`
                        : ""}
                    </span>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyPanel
                title="No upcoming classes"
                text="There are no more published classes inside this academic period."
              />
            )
          ) : (
            <div className="pilot-day-stack">
              {Array.from({ length: 7 }, (_, index) => index + 1).map((day) => {
                const sessions = groupedSessions.get(day) ?? [];
                if (sessions.length === 0) return null;
                return (
                  <section key={day} className="public-day-group">
                    <div className="public-day-header">
                      <h3>{weekdayLabels[day]}</h3>
                    </div>
                    <div className="public-session-list">
                      {sessions.map((session) => (
                        <article
                          key={session.stableSessionKey}
                          className="public-session-card"
                        >
                          <strong>
                            {session.startTime.slice(0, 5)} -{" "}
                            {session.endTime.slice(0, 5)}
                          </strong>
                          <h4>{session.courseCode}</h4>
                          <p>{session.courseName}</p>
                          <span>{session.venue || "Venue not set"}</span>
                          <small>
                            {session.lecturer || "Lecturer not set"}
                          </small>
                        </article>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {stickyVisible ? (
        <div className="sticky-action public-sticky-action">
          <button className="primary" type="button" onClick={openSheet}>
            <CalendarCheck size={18} />
            Add to calendar
          </button>
        </div>
      ) : null}

      {sheetOpen ? (
        <div
          className="sheet-backdrop"
          role="presentation"
          onClick={closeSheet}
        >
          <div
            ref={sheetRef}
            className="sync-sheet compact public-calendar-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="calendar-sheet-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sheet-header">
              <div>
                <span className="public-kicker">
                  Add timetable to my calendar
                </span>
                <h2 id="calendar-sheet-title">When should we remind you?</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close dialog"
                onClick={closeSheet}
              >
                x
              </button>
            </div>
            <div className="step-panel">
              <div
                className="public-reminder-list"
                role="radiogroup"
                aria-label="Reminder choices"
              >
                {reminderChoices.map((choice) => (
                  <label
                    key={choice.id}
                    className={`public-reminder-card ${reminderPreset === choice.id ? "selected" : ""}`}
                  >
                    <input
                      type="radio"
                      name="reminder-preset"
                      value={choice.id}
                      checked={reminderPreset === choice.id}
                      onChange={() => {
                        setReminderPreset(choice.id);
                        track("reminder_selected", { preset: choice.id });
                      }}
                    />
                    <div>
                      <strong>{choice.title}</strong>
                      <p>{choice.detail}</p>
                      {choice.hint ? <small>{choice.hint}</small> : null}
                    </div>
                  </label>
                ))}
              </div>

              {reminderPreset === "custom" ? (
                <div className="public-custom-reminder-panel">
                  <div className="public-custom-reminder-grid">
                    <Field label="Hours before class">
                      <input
                        inputMode="numeric"
                        value={customReminderHours}
                        onChange={(event) =>
                          setCustomReminderHours(
                            event.target.value.replace(/[^\d]/g, ""),
                          )
                        }
                        placeholder="1"
                      />
                    </Field>
                    <Field label="Minutes before class">
                      <input
                        inputMode="numeric"
                        value={customReminderMinutes}
                        onChange={(event) =>
                          setCustomReminderMinutes(
                            event.target.value.replace(/[^\d]/g, ""),
                          )
                        }
                        placeholder="30"
                      />
                    </Field>
                  </div>
                  <p className="public-helper">
                    Set a quick reminder using hours and minutes before class.
                  </p>
                </div>
              ) : null}

              <div className="public-sheet-divider" />
              <div className="public-sheet-section">
                <div>
                  <span className="public-kicker">Delivery method</span>
                  <h3 className="public-sheet-heading">
                    How should we deliver it?
                  </h3>
                  <p className="public-helper">
                    {reminderChoice.title} reminders selected.
                  </p>
                </div>
                <div className="provider-list">
                  {calendarMethods.map((method) =>
                    method.provider ? (
                      <button
                        key={method.title}
                        className="provider-card"
                        type="button"
                        onClick={() => void prepareCalendar(method.provider)}
                        disabled={
                          calendarBusy !== null ||
                          (reminderPreset === "custom" &&
                            customReminderOffset === null)
                        }
                      >
                        <span className="provider-icon">
                          {method.provider === "ics_download" ? (
                            <Download size={18} />
                          ) : (
                            <Link2 size={18} />
                          )}
                        </span>
                        <div>
                          <strong>{method.title}</strong>
                          <small>{method.description}</small>
                        </div>
                        {method.accent ? <em>{method.accent}</em> : null}
                      </button>
                    ) : (
                      <div
                        key={method.title}
                        className="provider-card"
                        aria-disabled="true"
                      >
                        <span className="provider-icon">
                          <CalendarCheck size={18} />
                        </span>
                        <div>
                          <strong>{method.title}</strong>
                          <small>{method.description}</small>
                        </div>
                      </div>
                    ),
                  )}
                </div>
              </div>

              {calendarError ? (
                <div
                  className="public-inline-error"
                  role="status"
                  aria-live="polite"
                >
                  <p>{calendarError}</p>
                  {calendarBusy === null ? (
                    <button
                      className="secondary light"
                      type="button"
                      onClick={() => setCalendarError("")}
                    >
                      Try again
                    </button>
                  ) : null}
                </div>
              ) : null}
              {reminderPreset === "custom" && customReminderOffset === null ? (
                <p className="public-helper">
                  Enter at least 1 minute before class to continue.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
