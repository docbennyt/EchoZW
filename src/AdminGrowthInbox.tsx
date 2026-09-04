import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Inbox,
  MessageSquareText,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { fetchAdminSession } from "./api/adminSession";
import {
  listGrowthRequests,
  updateGrowthRequest,
  type GrowthRequestRecord,
  type GrowthRequestStatus,
  type GrowthRequestType,
} from "./api/growthRequests";
import { createClient as createSupabaseBrowserClient } from "./utils/supabase/client";

const STATUS_OPTIONS: GrowthRequestStatus[] = [
  "new",
  "triaged",
  "in_progress",
  "resolved",
  "closed",
];

function formatStatus(value: GrowthRequestStatus) {
  return value.replaceAll("_", " ");
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-ZW", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function RequestCard({
  request,
  accessToken,
  onUpdated,
}: {
  request: GrowthRequestRecord;
  accessToken: string;
  onUpdated: (request: GrowthRequestRecord) => void;
}) {
  const [status, setStatus] = useState(request.status);
  const [internalNote, setInternalNote] = useState(request.internalNote ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    try {
      const result = await updateGrowthRequest(accessToken, request.id, {
        status,
        internalNote: internalNote.trim() || null,
      });
      onUpdated(result.request);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not update request.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function setTestimonialApproved(approved: boolean) {
    setSaving(true);
    setError("");
    try {
      const result = await updateGrowthRequest(accessToken, request.id, {
        testimonialApproved: approved,
      });
      onUpdated(result.request);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not update testimonial approval.",
      );
    } finally {
      setSaving(false);
    }
  }

  const isDemand = request.requestType === "missing_timetable";
  return (
    <article className="czw-growth-admin-card">
      <div className="czw-growth-admin-card-head">
        <div>
          <span className="czw-growth-admin-type">
            {isDemand ? <Inbox size={14} /> : <MessageSquareText size={14} />}
            {isDemand ? "Timetable demand" : "Feedback"}
          </span>
          <h2>
            {isDemand
              ? [
                  request.institutionName,
                  request.programmeName,
                  request.classGroupLabel,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : request.feedbackType?.replaceAll("_", " ") || "Feedback"}
          </h2>
          <p>{formatTimestamp(request.createdAt)}</p>
        </div>
        <span className="czw-growth-admin-status" data-status={request.status}>
          {formatStatus(request.status)}
        </span>
      </div>

      {isDemand ? (
        <dl className="czw-growth-admin-facts">
          <div>
            <dt>Academic period</dt>
            <dd>{request.academicPeriodName || "Not supplied"}</dd>
          </div>
          <div>
            <dt>Class Rep</dt>
            <dd>{request.isClassRep ? "Yes" : "No"}</dd>
          </div>
          <div>
            <dt>Official source access</dt>
            <dd>{request.canProvideSource ? "Yes" : "No"}</dd>
          </div>
        </dl>
      ) : (
        <dl className="czw-growth-admin-facts">
          <div>
            <dt>Rating</dt>
            <dd>{request.rating ? `${request.rating}/5` : "Not supplied"}</dd>
          </div>
          <div>
            <dt>Testimonial permission</dt>
            <dd>{request.testimonialConsent ? "Granted" : "Not granted"}</dd>
          </div>
          <div>
            <dt>Founder approval</dt>
            <dd>{request.testimonialApproved ? "Approved" : "Not approved"}</dd>
          </div>
        </dl>
      )}

      {request.message ? (
        <div className="czw-growth-admin-message">
          <strong>{isDemand ? "Notes" : "Feedback"}</strong>
          <p>{request.message}</p>
        </div>
      ) : null}

      {request.contactConsent ? (
        <div className="czw-growth-admin-contact">
          <strong>Consented contact</strong>
          <div>
            {request.contactName ? <span>{request.contactName}</span> : null}
            {request.contactEmail ? (
              <a href={`mailto:${request.contactEmail}`}>{request.contactEmail}</a>
            ) : null}
            {request.contactPhoneE164 ? (
              <a href={`tel:${request.contactPhoneE164}`}>
                {request.contactPhoneE164}
              </a>
            ) : null}
          </div>
        </div>
      ) : null}

      {request.sourcePage ? (
        <a
          className="czw-growth-admin-source"
          href={request.sourcePage}
          target="_blank"
          rel="noreferrer"
        >
          Source page <ExternalLink size={13} />
        </a>
      ) : null}

      <div className="czw-growth-admin-editor">
        <label>
          <span>Status</span>
          <select
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as GrowthRequestStatus)
            }
          >
            {STATUS_OPTIONS.map((item) => (
              <option key={item} value={item}>
                {formatStatus(item)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Founder note</span>
          <textarea
            rows={2}
            value={internalNote}
            onChange={(event) => setInternalNote(event.target.value)}
            placeholder="Next action, source owner, follow-up context…"
          />
        </label>
        <div className="czw-growth-admin-actions">
          {request.requestType === "feedback" && request.testimonialConsent ? (
            <button
              type="button"
              className="secondary"
              disabled={saving}
              onClick={() =>
                void setTestimonialApproved(!request.testimonialApproved)
              }
            >
              <CheckCircle2 size={16} />
              {request.testimonialApproved
                ? "Revoke testimonial approval"
                : "Approve testimonial"}
            </button>
          ) : null}
          <button
            type="button"
            className="primary"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
        {error ? (
          <p className="content-notice" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </article>
  );
}

export function AdminGrowthInbox() {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [requests, setRequests] = useState<GrowthRequestRecord[]>([]);
  const [authStatus, setAuthStatus] = useState<
    "checking" | "ready" | "forbidden" | "login" | "error"
  >("checking");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [requestType, setRequestType] = useState<GrowthRequestType | "all">(
    "all",
  );
  const [status, setStatus] = useState<GrowthRequestStatus | "all">("all");

  useEffect(() => {
    let active = true;
    async function authorize() {
      try {
        const supabase = createSupabaseBrowserClient();
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) {
          if (active) setAuthStatus("login");
          return;
        }
        const session = await fetchAdminSession(token);
        if (!active) return;
        if (session.staff.role !== "superadmin") {
          setAuthStatus("forbidden");
          return;
        }
        setAccessToken(token);
        setAuthStatus("ready");
      } catch {
        if (active) setAuthStatus("error");
      }
    }
    void authorize();
    return () => {
      active = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError("");
    try {
      const result = await listGrowthRequests(accessToken, {
        requestType: requestType === "all" ? undefined : requestType,
        status: status === "all" ? undefined : status,
      });
      setRequests(result.requests);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not load growth inbox.",
      );
    } finally {
      setLoading(false);
    }
  }, [accessToken, requestType, status]);

  useEffect(() => {
    if (authStatus === "ready") void refresh();
  }, [authStatus, refresh]);

  const summary = useMemo(
    () => ({
      total: requests.length,
      newCount: requests.filter((item) => item.status === "new").length,
      demandCount: requests.filter(
        (item) => item.requestType === "missing_timetable",
      ).length,
      sourceLeads: requests.filter(
        (item) => item.isClassRep || item.canProvideSource,
      ).length,
    }),
    [requests],
  );

  if (authStatus === "login") {
    window.location.replace("/admin/login");
    return null;
  }

  if (authStatus !== "ready" || !accessToken) {
    return (
      <main className="page admin-page">
        <section className="pilot-page-hero">
          <ShieldCheck size={28} />
          <div>
            <h1>Growth inbox</h1>
            <p>
              {authStatus === "forbidden"
                ? "Founder access is required."
                : authStatus === "error"
                  ? "Could not verify administrator access."
                  : "Checking administrator access…"}
            </p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="page admin-page czw-growth-admin-page">
      <section className="pilot-page-hero">
        <Inbox size={28} />
        <div>
          <h1>Growth inbox</h1>
          <p>Missing timetable demand, source leads and private feedback.</p>
        </div>
        <a className="secondary" href="/admin">
          <ArrowLeft size={17} /> Back to Admin
        </a>
      </section>

      <section className="czw-growth-admin-summary" aria-label="Growth summary">
        <div>
          <strong>{summary.newCount}</strong>
          <span>New</span>
        </div>
        <div>
          <strong>{summary.demandCount}</strong>
          <span>Timetable requests</span>
        </div>
        <div>
          <strong>{summary.sourceLeads}</strong>
          <span>Class Rep / source leads</span>
        </div>
        <div>
          <strong>{summary.total}</strong>
          <span>Visible in current filter</span>
        </div>
      </section>

      <section className="czw-growth-admin-toolbar">
        <label>
          <span>Type</span>
          <select
            value={requestType}
            onChange={(event) =>
              setRequestType(event.target.value as GrowthRequestType | "all")
            }
          >
            <option value="all">All</option>
            <option value="missing_timetable">Timetable demand</option>
            <option value="feedback">Feedback</option>
          </select>
        </label>
        <label>
          <span>Status</span>
          <select
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as GrowthRequestStatus | "all")
            }
          >
            <option value="all">All</option>
            {STATUS_OPTIONS.map((item) => (
              <option key={item} value={item}>
                {formatStatus(item)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="secondary"
          disabled={loading}
          onClick={() => void refresh()}
        >
          <RefreshCw size={16} /> {loading ? "Refreshing…" : "Refresh"}
        </button>
      </section>

      {error ? <p className="content-notice">{error}</p> : null}

      <section className="czw-growth-admin-list" aria-live="polite">
        {loading && requests.length === 0 ? <p>Loading growth inbox…</p> : null}
        {!loading && requests.length === 0 ? (
          <div className="empty-state">
            <Inbox size={28} />
            <strong>No requests in this filter</strong>
            <span>New timetable demand and feedback will appear here.</span>
          </div>
        ) : null}
        {requests.map((request) => (
          <RequestCard
            key={request.id}
            request={request}
            accessToken={accessToken}
            onUpdated={(updated) =>
              setRequests((current) =>
                current.map((item) =>
                  item.id === updated.id ? updated : item,
                ),
              )
            }
          />
        ))}
      </section>
    </main>
  );
}
