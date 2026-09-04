import { Button } from "@base-ui/react/button";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "./utils/supabase/client";

type TimetableRequest = {
  id: string;
  institution_name: string;
  programme_name: string;
  class_group: string;
  academic_period: string | null;
  requester_role: string;
  source_access: string;
  source_note: string | null;
  contact_name: string | null;
  phone_e164: string | null;
  email: string | null;
  consent_contact: boolean;
  status: string;
  public_slug: string | null;
  created_at: string;
};

type Feedback = {
  id: string;
  category: string;
  rating: number | null;
  message: string;
  public_slug: string | null;
  contact_name: string | null;
  email: string | null;
  phone_e164: string | null;
  consent_contact: boolean;
  testimonial_permission: boolean;
  testimonial_approved: boolean;
  status: string;
  created_at: string;
};

type Inbox = { requests: TimetableRequest[]; feedback: Feedback[] };

async function loadToken() {
  const client = createClient();
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("AUTH_REQUIRED");
  return token;
}

async function api<T>(path: string, token: string, init?: RequestInit) {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => null)) as
    | T
    | { error?: { message?: string } }
    | null;
  if (!response.ok) {
    throw new Error(
      body && "error" in body && body.error?.message
        ? body.error.message
        : "Request failed.",
    );
  }
  return body as T;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-ZW", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Harare",
  }).format(new Date(value));
}

export function GrowthInboxPage() {
  const [token, setToken] = useState<string | null>(null);
  const [inbox, setInbox] = useState<Inbox>({ requests: [], feedback: [] });
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "auth">(
    "loading",
  );
  const [error, setError] = useState("");

  const refresh = useCallback(async (accessToken: string) => {
    const next = await api<Inbox>("/api/admin/growth/inbox", accessToken);
    setInbox(next);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const accessToken = await loadToken();
        setToken(accessToken);
        await refresh(accessToken);
        setStatus("ready");
      } catch (caught) {
        if (caught instanceof Error && caught.message === "AUTH_REQUIRED") {
          setStatus("auth");
        } else {
          setError(caught instanceof Error ? caught.message : "Could not load inbox.");
          setStatus("error");
        }
      }
    })();
  }, [refresh]);

  const demandGroups = useMemo(() => {
    const groups = new Map<string, number>();
    for (const item of inbox.requests) {
      const key = [
        item.institution_name,
        item.programme_name,
        item.class_group,
        item.academic_period ?? "Current period",
      ].join(" · ");
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    return [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [inbox.requests]);

  async function updateRequest(item: TimetableRequest, nextStatus: string) {
    if (!token) return;
    await api(`/api/admin/growth/requests/${item.id}`, token, {
      method: "PATCH",
      body: JSON.stringify({ status: nextStatus, publicSlug: item.public_slug }),
    });
    await refresh(token);
  }

  async function updateFeedback(item: Feedback, testimonialApproved: boolean) {
    if (!token) return;
    await api(`/api/admin/growth/feedback/${item.id}`, token, {
      method: "PATCH",
      body: JSON.stringify({
        status: item.status === "new" ? "reviewed" : item.status,
        testimonialApproved,
      }),
    });
    await refresh(token);
  }

  if (status === "auth") {
    return (
      <main className="czw-growth-inbox czw-growth-inbox-state">
        <h1>Founder Demand Inbox</h1>
        <p>Superadmin sign-in is required.</p>
        <a className="czw-button czw-button-primary" href="/admin/login">
          Sign in
        </a>
      </main>
    );
  }

  if (status === "loading") {
    return <main className="czw-growth-inbox czw-growth-inbox-state">Loading demand…</main>;
  }

  if (status === "error") {
    return (
      <main className="czw-growth-inbox czw-growth-inbox-state">
        <h1>Founder Demand Inbox</h1>
        <p>{error}</p>
        <a href="/admin">Back to Admin</a>
      </main>
    );
  }

  return (
    <main className="czw-growth-inbox">
      <header className="czw-growth-inbox-header">
        <div>
          <span>CalenderZW operations</span>
          <h1>Founder Demand Inbox</h1>
          <p>Student demand, source access and private product feedback.</p>
        </div>
        <a href="/admin">Back to Admin</a>
      </header>

      <section className="czw-growth-inbox-stats" aria-label="Growth summary">
        <article>
          <strong>{inbox.requests.length}</strong>
          <span>Timetable requests</span>
        </article>
        <article>
          <strong>{inbox.requests.filter((item) => item.status === "new").length}</strong>
          <span>New requests</span>
        </article>
        <article>
          <strong>
            {inbox.requests.filter((item) => item.source_access !== "none").length}
          </strong>
          <span>Source-access leads</span>
        </article>
        <article>
          <strong>{inbox.feedback.length}</strong>
          <span>Feedback entries</span>
        </article>
      </section>

      <section className="czw-growth-inbox-panel">
        <div className="czw-growth-inbox-title">
          <div>
            <span>Prioritisation</span>
            <h2>Demand clusters</h2>
          </div>
          <small>Grouped locally in this view; no IP/device fingerprinting.</small>
        </div>
        {demandGroups.length ? (
          <ol className="czw-demand-clusters">
            {demandGroups.map(([label, count]) => (
              <li key={label}>
                <span>{label}</span>
                <strong>{count}</strong>
              </li>
            ))}
          </ol>
        ) : (
          <p>No timetable requests yet.</p>
        )}
      </section>

      <section className="czw-growth-inbox-panel">
        <div className="czw-growth-inbox-title">
          <div>
            <span>Acquisition</span>
            <h2>Timetable requests</h2>
          </div>
        </div>
        <div className="czw-growth-inbox-list">
          {inbox.requests.map((item) => (
            <article key={item.id} className="czw-growth-inbox-item">
              <div className="czw-growth-inbox-item-main">
                <div className="czw-growth-inbox-item-meta">
                  <span>{item.status}</span>
                  <time>{formatDate(item.created_at)}</time>
                </div>
                <h3>
                  {item.institution_name} · {item.programme_name}
                </h3>
                <p>
                  Class {item.class_group}
                  {item.academic_period ? ` · ${item.academic_period}` : ""}
                </p>
                <p>
                  <strong>Role:</strong> {item.requester_role} · <strong>Source:</strong>{" "}
                  {item.source_access}
                </p>
                {item.source_note ? <p>{item.source_note}</p> : null}
                {item.consent_contact ? (
                  <p className="czw-growth-contact-line">
                    {[item.contact_name, item.phone_e164, item.email]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                ) : null}
              </div>
              <div className="czw-growth-inbox-actions">
                {[
                  "triaged",
                  "source_needed",
                  "in_progress",
                  "published",
                  "closed",
                ].map((next) => (
                  <Button
                    key={next}
                    type="button"
                    disabled={item.status === next}
                    onClick={() => void updateRequest(item, next)}
                  >
                    {next.replaceAll("_", " ")}
                  </Button>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="czw-growth-inbox-panel">
        <div className="czw-growth-inbox-title">
          <div>
            <span>Voice of user</span>
            <h2>Feedback</h2>
          </div>
        </div>
        <div className="czw-growth-inbox-list">
          {inbox.feedback.map((item) => (
            <article key={item.id} className="czw-growth-inbox-item">
              <div className="czw-growth-inbox-item-main">
                <div className="czw-growth-inbox-item-meta">
                  <span>{item.category.replaceAll("_", " ")}</span>
                  <time>{formatDate(item.created_at)}</time>
                </div>
                <p>{item.message}</p>
                {item.rating ? <p><strong>{item.rating}/5</strong></p> : null}
                <p>
                  Testimonial permission: {item.testimonial_permission ? "yes" : "no"} ·
                  approved: {item.testimonial_approved ? "yes" : "no"}
                </p>
              </div>
              <div className="czw-growth-inbox-actions">
                <Button
                  type="button"
                  disabled={!item.testimonial_permission}
                  onClick={() => void updateFeedback(item, !item.testimonial_approved)}
                >
                  {item.testimonial_approved ? "Revoke approval" : "Approve testimonial"}
                </Button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
