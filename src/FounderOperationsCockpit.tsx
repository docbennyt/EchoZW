import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  CalendarCheck2,
  CircleAlert,
  ExternalLink,
  Eye,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { fetchAnalyticsOverview } from "./api/adminAnalytics";
import type { AdminTimetableSummary } from "./api/pilotTypes";
import type {
  AnalyticsOverview,
  FounderOperationsOverview,
} from "./domain/adminAnalytics";
import "./founderOperationsCockpit.css";

const funnelLabels: Record<string, string> = {
  timetable_viewed: "Viewed timetable",
  onboarding_opened: "Subscribe opened",
  reminders_complete: "Reminders complete",
  reminder_complete: "Reminders complete",
  phone_step_completed: "Contact complete",
  contact_complete: "Contact complete",
  provider_selected: "Provider selected",
  subscription_created: "Subscription created",
  onboarding_completed: "Onboarding done",
};

const providerLabels: Record<string, string> = {
  google_api: "Google",
  apple_subscription: "Apple",
  webcal_subscription: "Webcal",
  outlook_subscription: "Outlook",
  ics_download: "ICS",
};

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  const percentage = value <= 1 ? value * 100 : value;
  return `${Math.round(percentage)}%`;
}

function formatTime(value: string | null) {
  if (!value) return "Not observed yet";
  return new Intl.DateTimeFormat("en-ZW", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function labelProvider(value: string) {
  return providerLabels[value] ?? value.replaceAll("_", " ");
}

function sevenDayParams(now = new Date()) {
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - 6);
  const params = new URLSearchParams();
  params.set("from", from.toISOString().slice(0, 10));
  params.set("to", now.toISOString().slice(0, 10));
  params.set("timezone", "Africa/Harare");
  return params;
}

function PulseCard({
  label,
  value,
  detail,
  emphasis = false,
}: {
  label: string;
  value: string | number;
  detail: string;
  emphasis?: boolean;
}) {
  return (
    <article className={emphasis ? "foc-pulse-card foc-pulse-emphasis" : "foc-pulse-card"}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="foc-empty">{children}</div>;
}

export function FounderOperationsCockpit({
  accessToken,
  timetables,
}: {
  accessToken: string;
  timetables: AdminTimetableSummary[];
}) {
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const params = useMemo(() => sevenDayParams(), []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setOverview(await fetchAnalyticsOverview(accessToken, params));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not load the operations cockpit.",
      );
    } finally {
      setLoading(false);
    }
  }, [accessToken, params]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [refresh]);

  const operations: FounderOperationsOverview | null = overview?.operations ?? null;
  const pulse = operations?.pilotPulse;
  const funnel = overview?.funnel ?? [];
  const firstStagePeople = funnel[0]?.people ?? 0;
  const smallSample = firstStagePeople > 0 && firstStagePeople < 5;
  const trustRows = [...(operations?.timetableTrust ?? [])].sort(
    (left, right) => right.warnings.length - left.warnings.length,
  );
  const warningCount = trustRows.reduce(
    (total, row) => total + row.warnings.length,
    0,
  );

  return (
    <div className="foc-shell">
      <section className="foc-hero" aria-labelledby="operations-heading">
        <div className="foc-hero-copy">
          <div className="foc-kicker">
            <Sparkles size={15} aria-hidden="true" />
            7-day pilot command center
          </div>
          <h1 id="operations-heading">Know what needs attention before opening CRUD.</h1>
          <p>
            Adoption, subscription health and timetable trust in one privacy-safe
            operational view. Counts come from CalenderZW first-party data; no raw
            phone, email or private feed token is returned here.
          </p>
          <div className="foc-hero-actions">
            <a className="foc-primary-action" href="/admin/team">
              <Users size={17} aria-hidden="true" />
              Manage team
            </a>
            <a className="foc-secondary-action" href="/admin/timetables">
              Timetables
              <ArrowRight size={16} aria-hidden="true" />
            </a>
            <button
              className="foc-icon-button"
              type="button"
              onClick={() => void refresh()}
              disabled={loading}
              aria-label="Refresh operations cockpit"
            >
              <RefreshCw size={17} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="foc-hero-status" aria-live="polite">
          <div>
            <span>Configured timetables</span>
            <strong>{timetables.length}</strong>
          </div>
          <div>
            <span>Trust warnings</span>
            <strong>{loading ? "…" : warningCount}</strong>
          </div>
          <div>
            <span>Data refreshed</span>
            <strong>{overview ? formatTime(overview.refreshedAt) : loading ? "Loading…" : "Unavailable"}</strong>
          </div>
          <p>
            <ShieldCheck size={16} aria-hidden="true" />
            Aggregate-only dashboard. Subscriber identity stays behind dedicated
            authorized workflows.
          </p>
        </div>
      </section>

      {error ? (
        <div className="foc-error" role="alert">
          <CircleAlert size={18} aria-hidden="true" />
          <span>{error}</span>
          <button type="button" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      ) : null}

      <section className="foc-section" aria-labelledby="pulse-heading">
        <div className="foc-section-heading">
          <div>
            <span className="foc-eyebrow">Pilot pulse</span>
            <h2 id="pulse-heading">What moved this week</h2>
          </div>
          <p>Activation is update-enabled subscriptions divided by timetable viewers.</p>
        </div>
        <div className="foc-pulse-grid" aria-busy={loading}>
          <PulseCard
            label="Timetable viewers"
            value={loading ? "…" : (pulse?.uniqueTimetableViewers ?? 0)}
            detail="Unique analytics identities that viewed a timetable."
          />
          <PulseCard
            label="Onboarding done"
            value={loading ? "…" : (pulse?.onboardingCompletions ?? 0)}
            detail="Reached the final calendar onboarding success state."
          />
          <PulseCard
            label="Update-enabled"
            value={loading ? "…" : (pulse?.updateEnabledSubscriptions ?? 0)}
            detail="Google, Apple, webcal or Outlook connections that can receive changes."
            emphasis
          />
          <PulseCard
            label="Activation conversion"
            value={loading ? "…" : formatPercent(pulse?.activationConversion ?? null)}
            detail="Shown only from the defined first-party activation metric."
          />
          <PulseCard
            label="Feed observed"
            value={loading ? "…" : (pulse?.feedObservedSubscriptions ?? 0)}
            detail="A calendar client requested a feed; this is not proof of an active human user."
          />
          <PulseCard
            label="One-time ICS"
            value={loading ? "…" : (pulse?.oneTimeIcsDownloads ?? 0)}
            detail="Prepared file imports that will not receive future timetable changes."
          />
          <PulseCard
            label="Subscriptions created"
            value={loading ? "…" : (pulse?.calendarSubscriptionsCreated ?? 0)}
            detail="Calendar subscription rows successfully committed."
          />
          <PulseCard
            label="Shares"
            value={loading ? "…" : (pulse?.shares ?? 0)}
            detail="Public class timetable share events captured by first-party analytics."
          />
        </div>
      </section>

      <section className="foc-section foc-funnel-section" aria-labelledby="funnel-heading">
        <div className="foc-section-heading">
          <div>
            <span className="foc-eyebrow">Activation funnel</span>
            <h2 id="funnel-heading">Where students stop</h2>
          </div>
          <a href="/admin/analytics">
            Open analytics
            <ExternalLink size={15} aria-hidden="true" />
          </a>
        </div>
        {smallSample ? (
          <p className="foc-sample-note">
            Small sample: use the counts as directional evidence, not a stable conversion benchmark.
          </p>
        ) : null}
        {!loading && funnel.length === 0 ? (
          <EmptyState>No onboarding funnel events in this 7-day window yet.</EmptyState>
        ) : (
          <ol className="foc-funnel-list" aria-busy={loading}>
            {funnel.map((stage, index) => {
              const maximum = Math.max(firstStagePeople, 1);
              const width = Math.max(4, Math.min(100, (stage.people / maximum) * 100));
              return (
                <li key={`${stage.stage}-${index}`}>
                  <div className="foc-funnel-label">
                    <span>{funnelLabels[stage.stage] ?? stage.stage.replaceAll("_", " ")}</span>
                    <strong>{stage.people}</strong>
                  </div>
                  <div className="foc-funnel-track" aria-hidden="true">
                    <span style={{ width: `${width}%` }} />
                  </div>
                  <small>
                    {index === 0
                      ? "Entry count"
                      : `${formatPercent(stage.conversionFromPrevious)} from previous step`}
                  </small>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <div className="foc-split-grid">
        <section className="foc-section" aria-labelledby="subscriber-heading">
          <div className="foc-section-heading compact">
            <div>
              <span className="foc-eyebrow">Subscriber health</span>
              <h2 id="subscriber-heading">Can updates actually travel?</h2>
            </div>
          </div>
          {!loading && !(operations?.subscriberHealth.length ?? 0) ? (
            <EmptyState>No subscription sample yet.</EmptyState>
          ) : (
            <div className="foc-health-list" aria-busy={loading}>
              {(operations?.subscriberHealth ?? []).slice(0, 6).map((row) => (
                <article key={row.timetableId}>
                  <div className="foc-row-title">
                    <div>
                      <strong>{row.label}</strong>
                      <span>{row.publicSlug}</span>
                    </div>
                    <span className="foc-feed-chip">
                      <Eye size={14} aria-hidden="true" />
                      {row.feedObservedSubscriptions} feed observed
                    </span>
                  </div>
                  <div className="foc-health-metrics">
                    <span><strong>{row.activeSubscriptions}</strong> active records</span>
                    <span><strong>{row.updateEnabledSubscriptions}</strong> update-enabled</span>
                    <span><strong>{row.oneTimeIcsDownloads}</strong> one-time ICS</span>
                    <span><strong>{row.contactableSubscriptions}</strong> contact-consented</span>
                  </div>
                  <div className="foc-provider-line">
                    {Object.entries(row.providerMix).map(([provider, count]) => (
                      <span key={provider}>{labelProvider(provider)} {count}</span>
                    ))}
                  </div>
                  <small>Last feed observed: {formatTime(row.lastFeedObservedAt)}</small>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="foc-section" aria-labelledby="trust-heading">
          <div className="foc-section-heading compact">
            <div>
              <span className="foc-eyebrow">Timetable trust</span>
              <h2 id="trust-heading">Warnings before routine setup</h2>
            </div>
          </div>
          {!loading && trustRows.length === 0 ? (
            <EmptyState>No published timetable trust rows yet.</EmptyState>
          ) : (
            <div className="foc-trust-list" aria-busy={loading}>
              {trustRows.slice(0, 6).map((row) => (
                <article key={row.timetableId} className={row.warnings.length ? "has-warning" : "is-clear"}>
                  <div className="foc-row-title">
                    <div>
                      <strong>{row.label}</strong>
                      <span>Published {formatTime(row.currentPublishedAt)}</span>
                    </div>
                    {row.warnings.length ? (
                      <CircleAlert size={18} aria-label="Needs attention" />
                    ) : (
                      <CalendarCheck2 size={18} aria-label="No trust warning" />
                    )}
                  </div>
                  {row.warnings.length ? (
                    <ul>
                      {row.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                    </ul>
                  ) : (
                    <p>No current trust warning.</p>
                  )}
                  <div className="foc-trust-meta">
                    <span>{row.unresolvedSourceReviews} source reviews</span>
                    <span>{row.pinnedCorrections} pinned corrections</span>
                    <span>{row.pendingExceptions} date exceptions</span>
                    <span>{row.hasClassRep ? "Class Rep assigned" : "No Class Rep"}</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="foc-section" aria-labelledby="team-ops-heading">
        <div className="foc-section-heading">
          <div>
            <span className="foc-eyebrow">Class Rep operations</span>
            <h2 id="team-ops-heading">Keep class truth covered</h2>
          </div>
          <a href="/admin/team">Open Team <ArrowRight size={15} aria-hidden="true" /></a>
        </div>
        <div className="foc-shortcuts">
          <a href="/admin/team">
            <Users size={18} aria-hidden="true" />
            <strong>{loading ? "…" : (operations?.classRepOperations.activeClassReps ?? 0)}</strong>
            <span>Active Class Reps</span>
          </a>
          <a href="/admin/team">
            <ShieldCheck size={18} aria-hidden="true" />
            <strong>{loading ? "…" : (operations?.classRepOperations.assignedTimetables ?? 0)}</strong>
            <span>Assigned timetables</span>
          </a>
          <a href="/admin/timetables">
            <CircleAlert size={18} aria-hidden="true" />
            <strong>{loading ? "…" : (operations?.classRepOperations.unassignedPublishedTimetables ?? 0)}</strong>
            <span>Published without rep</span>
          </a>
          <a href="/admin/team">
            <Activity size={18} aria-hidden="true" />
            <strong>{loading ? "…" : (operations?.classRepOperations.recentCorrections ?? 0)}</strong>
            <span>Recent corrections</span>
          </a>
        </div>
      </section>
    </div>
  );
}
