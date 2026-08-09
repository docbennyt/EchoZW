import { useCallback, useEffect, useMemo, useState } from "react";
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
  Trash2,
} from "lucide-react";
import { fetchAdminSession, type AdminSessionUser } from "./api/adminSession";
import {
  createAcademicPeriod,
  createClassGroup,
  createInstitution,
  createProgramme,
  createTimetable,
  createTimetableSession,
  deleteTimetableSession,
  getTimetable,
  listAcademicPeriods,
  listClassGroups,
  listInstitutions,
  listProgrammes,
  listTimetables,
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
} from "./api/pilotTypes";
import { createCalendarSubscription } from "./api/calendarSubscriptions";
import { fetchPublicTimetable } from "./api/publicTimetable";
import type { PublicTimetable } from "./api/pilotTypes";
import { createClient as createSupabaseBrowserClient } from "./utils/supabase/client";

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

  return { status, user, accessToken, signOut };
}

function useAdminData(accessToken: string | null) {
  const [institutions, setInstitutions] = useState<AdminInstitution[]>([]);
  const [programmes, setProgrammes] = useState<AdminProgramme[]>([]);
  const [classGroups, setClassGroups] = useState<AdminClassGroup[]>([]);
  const [academicPeriods, setAcademicPeriods] = useState<AdminAcademicPeriod[]>([]);
  const [timetables, setTimetables] = useState<AdminTimetableSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refreshAll = useCallback(async () => {
    if (!accessToken) return;
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
      setError(error instanceof Error ? error.message : "Could not load admin data.");
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

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
        {actions ? <div className="pilot-surface-actions">{actions}</div> : null}
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
    { href: "/admin/institutions", label: "Institutions" },
    { href: "/admin/programmes", label: "Programmes" },
    { href: "/admin/class-groups", label: "Class groups" },
    { href: "/admin/academic-periods", label: "Academic periods" },
    { href: "/admin/timetables", label: "Timetables" },
  ];

  return (
    <nav className="pilot-nav" aria-label="Admin">
      {items.map((item) => (
        <a
          key={item.href}
          href={item.href}
          aria-current={path === item.href || path.startsWith(`${item.href}/`) ? "page" : undefined}
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}

function AdminOverview({
  timetables,
}: {
  timetables: AdminTimetableSummary[];
}) {
  return (
    <div className="pilot-stack">
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
                  <span className={`status ${timetable.status === "Published" ? "confirmed" : ""}`}>
                    {timetable.status}
                  </span>
                  <small>Updated {formatTimestamp(timetable.lastUpdated)}</small>
                </div>
                <div className="pilot-card-actions">
                  <a href={`/admin/timetables/${timetable.id}`}>Open</a>
                  {timetable.currentPublishedVersionId ? (
                    <a href={`/t/${timetable.publicSlug}`} target="_blank" rel="noreferrer">
                      Preview
                    </a>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </Surface>

      <Surface title="Manage setup" subtitle="These records power every timetable you publish.">
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
      setMessage(error instanceof Error ? error.message : "Could not save institution.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pilot-stack">
      <Surface title="Institutions" subtitle="Use one clear record per university or college.">
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
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />
          </Field>
          <Field label="Short name">
            <input
              value={form.shortName}
              onChange={(event) =>
                setForm((current) => ({ ...current, shortName: event.target.value }))
              }
            />
          </Field>
          <Field label="Slug">
            <input
              value={form.slug}
              onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value }))}
            />
          </Field>
          <Field label="Timezone">
            <input
              value={form.timezone}
              onChange={(event) =>
                setForm((current) => ({ ...current, timezone: event.target.value }))
              }
            />
          </Field>
          <label className="pilot-checkbox">
            <input
              checked={form.active}
              type="checkbox"
              onChange={(event) =>
                setForm((current) => ({ ...current, active: event.target.checked }))
              }
            />
            Active
          </label>
          {message ? <p className="content-notice">{message}</p> : null}
          <div className="pilot-inline-actions">
            <button className="primary" disabled={saving} type="submit">
              <Save size={18} />
              {saving ? "Saving" : editing ? "Save changes" : "Create institution"}
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
      setMessage(error instanceof Error ? error.message : "Could not save programme.");
    }
  }

  return (
    <div className="pilot-stack">
      <Surface title="Programmes" subtitle="Every programme belongs to one institution.">
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
                setForm((current) => ({ ...current, institutionId: event.target.value }))
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
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />
          </Field>
          <Field label="Code">
            <input
              value={form.code}
              onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))}
            />
          </Field>
          <Field label="Slug">
            <input
              value={form.slug}
              onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value }))}
            />
          </Field>
          <label className="pilot-checkbox">
            <input
              checked={form.active}
              type="checkbox"
              onChange={(event) =>
                setForm((current) => ({ ...current, active: event.target.checked }))
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
      setMessage(error instanceof Error ? error.message : "Could not save class group.");
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
                  {classGroup.yearLevel ? `Year ${classGroup.yearLevel}` : "Year optional"} ·{" "}
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
                      semesterNumber: classGroup.semesterNumber?.toString() ?? "",
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
                setForm((current) => ({ ...current, programmeId: event.target.value }))
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
              onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))}
              placeholder="Part 2.1"
            />
          </Field>
          <Field label="Slug">
            <input
              value={form.slug}
              onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value }))}
            />
          </Field>
          <Field label="Year level">
            <input
              inputMode="numeric"
              value={form.yearLevel}
              onChange={(event) =>
                setForm((current) => ({ ...current, yearLevel: event.target.value }))
              }
            />
          </Field>
          <Field label="Semester number">
            <input
              inputMode="numeric"
              value={form.semesterNumber}
              onChange={(event) =>
                setForm((current) => ({ ...current, semesterNumber: event.target.value }))
              }
            />
          </Field>
          <Field label="Group name">
            <input
              value={form.groupName}
              onChange={(event) =>
                setForm((current) => ({ ...current, groupName: event.target.value }))
              }
            />
          </Field>
          <label className="pilot-checkbox">
            <input
              checked={form.active}
              type="checkbox"
              onChange={(event) =>
                setForm((current) => ({ ...current, active: event.target.checked }))
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
      setMessage(editing ? "Academic period updated." : "Academic period created.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save academic period.");
    }
  }

  return (
    <div className="pilot-stack">
      <Surface title="Academic periods" subtitle="Use confirmed start and end dates.">
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
                setForm((current) => ({ ...current, institutionId: event.target.value }))
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
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Semester 1, 2026"
            />
          </Field>
          <Field label="Starts on">
            <input
              required
              type="date"
              value={form.startsOn}
              onChange={(event) =>
                setForm((current) => ({ ...current, startsOn: event.target.value }))
              }
            />
          </Field>
          <Field label="Ends on">
            <input
              required
              type="date"
              value={form.endsOn}
              onChange={(event) =>
                setForm((current) => ({ ...current, endsOn: event.target.value }))
              }
            />
          </Field>
          <label className="pilot-checkbox">
            <input
              checked={form.active}
              type="checkbox"
              onChange={(event) =>
                setForm((current) => ({ ...current, active: event.target.checked }))
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
  const selectedProgrammeId = filteredProgrammes.some((item) => item.id === programmeId)
    ? programmeId
    : filteredProgrammes[0]?.id || "";
  const filteredClassGroups = classGroups.filter(
    (classGroup) => classGroup.programmeId === selectedProgrammeId,
  );
  const selectedClassGroupId = filteredClassGroups.some((item) => item.id === classGroupId)
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
      setMessage(error instanceof Error ? error.message : "Could not create timetable.");
    }
  }

  return (
    <Surface title="New timetable" subtitle="Choose the academic setup, then enter weekly classes.">
      <form className="pilot-form" onSubmit={submit}>
        <Field label="Institution">
          <select value={selectedInstitutionId} onChange={(event) => setInstitutionId(event.target.value)}>
            <option value="">Select institution</option>
            {institutions.map((institution) => (
              <option key={institution.id} value={institution.id}>
                {institution.name}
              </option>
            ))}
          </select>
        </Field>
        <InlineCreateHint href="/admin/institutions" show={institutions.length === 0}>
          Add an institution first.
        </InlineCreateHint>

        <Field label="Programme">
          <select value={selectedProgrammeId} onChange={(event) => setProgrammeId(event.target.value)}>
            <option value="">Select programme</option>
            {filteredProgrammes.map((programme) => (
              <option key={programme.id} value={programme.id}>
                {programme.name}
              </option>
            ))}
          </select>
        </Field>
        <InlineCreateHint href="/admin/programmes" show={filteredProgrammes.length === 0}>
          Add a programme for this institution.
        </InlineCreateHint>

        <Field label="Class group">
          <select value={selectedClassGroupId} onChange={(event) => setClassGroupId(event.target.value)}>
            <option value="">Select class group</option>
            {filteredClassGroups.map((classGroup) => (
              <option key={classGroup.id} value={classGroup.id}>
                {classGroup.label}
              </option>
            ))}
          </select>
        </Field>
        <InlineCreateHint href="/admin/class-groups" show={filteredClassGroups.length === 0}>
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
        <InlineCreateHint href="/admin/academic-periods" show={filteredAcademicPeriods.length === 0}>
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

function TimetableEditorPage({
  accessToken,
  timetableId,
}: {
  accessToken: string;
  timetableId: string;
}) {
  const [editor, setEditor] = useState<AdminTimetableEditor | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [sessionForm, setSessionForm] = useState<SessionFormState>(emptySessionForm);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishLink, setPublishLink] = useState("");

  const loadEditor = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getTimetable(accessToken, timetableId);
      setEditor(result.timetable);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load timetable.");
    } finally {
      setLoading(false);
    }
  }, [accessToken, timetableId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadEditor();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadEditor]);

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

  function openNewSession(day: number, source?: AdminTimetableSession) {
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
    setSheetOpen(true);
  }

  function openEditSession(session: AdminTimetableSession) {
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
    setSheetOpen(true);
  }

  async function saveSession(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    setMessage("");
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
      if (sessionForm.id) {
        await updateTimetableSession(accessToken, editor.timetable.id, sessionForm.id, payload);
      } else {
        await createTimetableSession(accessToken, editor.timetable.id, payload);
      }
      setSheetOpen(false);
      setSessionForm(emptySessionForm);
      await loadEditor();
      setMessage(sessionForm.id ? "Class updated." : "Class added.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save class session.");
    }
  }

  async function removeSession(sessionId: string) {
    if (!editor) return;
    try {
      await deleteTimetableSession(accessToken, editor.timetable.id, sessionId);
      await loadEditor();
      setMessage("Class deleted.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not delete class.");
    }
  }

  async function publishCurrent() {
    if (!editor) return;
    setPublishing(true);
    setMessage("");
    try {
      const result = await publishTimetable(accessToken, editor.timetable.id);
      const publicUrl = `${window.location.origin}/t/${result.publishResult.publicSlug}`;
      setPublishLink(publicUrl);
      await loadEditor();
      setMessage("Timetable published.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not publish timetable.");
    } finally {
      setPublishing(false);
    }
  }

  if (loading) {
    return (
      <Surface title="Loading timetable" subtitle="Fetching the latest draft and weekly sessions.">
        <p>Loading...</p>
      </Surface>
    );
  }

  if (!editor) {
    return (
      <Surface title="Timetable unavailable">
        <p>{message || "The requested timetable could not be loaded."}</p>
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
            {editor.timetable.currentPublishedVersionId ? (
              <a className="secondary" href={`/t/${editor.timetable.publicSlug}`} target="_blank" rel="noreferrer">
                <ExternalLink size={18} />
                Preview
              </a>
            ) : null}
            <button className="primary" onClick={publishCurrent} disabled={publishing}>
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
        {publishLink ? (
          <div className="pilot-publish-success">
            <div>
              <strong>Timetable is live</strong>
              <span>{publishLink}</span>
            </div>
            <div className="pilot-inline-actions">
              <button className="secondary" type="button" onClick={() => void copyText(publishLink)}>
                <Copy size={18} />
                Copy class link
              </button>
              <button
                className="secondary"
                type="button"
                onClick={() => {
                  if (navigator.share) {
                    void navigator.share({ title: "CalenderZW timetable", url: publishLink });
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

      <Surface title="Weekly classes" subtitle="Add, edit, duplicate, and review recurring sessions by day.">
        <div className="pilot-day-stack">
          {Array.from({ length: 7 }, (_, index) => index + 1).map((day) => {
            const sessions = sessionsByDay.get(day) ?? [];
            return (
              <section key={day} className="pilot-day-group">
                <div className="pilot-day-header">
                  <h3>{weekdayLabels[day]}</h3>
                  <button className="secondary" type="button" onClick={() => openNewSession(day)}>
                    <Plus size={18} />
                    Add {weekdayLabels[day]} class
                  </button>
                </div>
                {sessions.length === 0 ? (
                  <p className="pilot-muted">No classes added for {weekdayLabels[day].toLowerCase()} yet.</p>
                ) : (
                  <div className="pilot-session-list">
                    {sessions.map((session) => (
                      <article key={session.id} className="pilot-session-card">
                        <div>
                          <strong>
                            {session.startTime.slice(0, 5)}-{session.endTime.slice(0, 5)}
                          </strong>
                          <h4>{session.courseCode}</h4>
                          <p>{session.courseName}</p>
                          <span>
                            {session.venue || "Venue not set"}
                            {session.lecturer ? ` · ${session.lecturer}` : ""}
                          </span>
                        </div>
                        <div className="pilot-card-actions">
                          <button className="secondary" type="button" onClick={() => openEditSession(session)}>
                            Edit
                          </button>
                          <button className="secondary" type="button" onClick={() => openNewSession(day, session)}>
                            Duplicate
                          </button>
                          <button className="secondary" type="button" onClick={() => void removeSession(session.id)}>
                            <Trash2 size={16} />
                            Delete
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
          <section className="sync-sheet compact" aria-modal="true" role="dialog">
            <div className="sheet-header">
              <h2>{sessionForm.id ? "Edit class" : "Add class"}</h2>
              <button className="icon-button" type="button" onClick={() => setSheetOpen(false)}>
                x
              </button>
            </div>
            <form className="pilot-form" onSubmit={saveSession}>
              <Field label="Course code">
                <input
                  required
                  value={sessionForm.courseCode}
                  onChange={(event) =>
                    setSessionForm((current) => ({ ...current, courseCode: event.target.value }))
                  }
                />
              </Field>
              <Field label="Course name">
                <input
                  required
                  value={sessionForm.courseName}
                  onChange={(event) =>
                    setSessionForm((current) => ({ ...current, courseName: event.target.value }))
                  }
                />
              </Field>
              <Field label="Day">
                <select
                  value={sessionForm.weekday}
                  onChange={(event) =>
                    setSessionForm((current) => ({ ...current, weekday: event.target.value }))
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
                      setSessionForm((current) => ({ ...current, startTime: event.target.value }))
                    }
                  />
                </Field>
                <Field label="End">
                  <input
                    required
                    type="time"
                    value={sessionForm.endTime}
                    onChange={(event) =>
                      setSessionForm((current) => ({ ...current, endTime: event.target.value }))
                    }
                  />
                </Field>
              </div>
              <Field label="Venue">
                <input
                  value={sessionForm.venue}
                  onChange={(event) =>
                    setSessionForm((current) => ({ ...current, venue: event.target.value }))
                  }
                />
              </Field>
              <Field label="Lecturer">
                <input
                  value={sessionForm.lecturer}
                  onChange={(event) =>
                    setSessionForm((current) => ({ ...current, lecturer: event.target.value }))
                  }
                />
              </Field>
              <Field label="Session type">
                <input
                  value={sessionForm.sessionType}
                  onChange={(event) =>
                    setSessionForm((current) => ({ ...current, sessionType: event.target.value }))
                  }
                />
              </Field>
              <Field label="Notes">
                <textarea
                  rows={3}
                  value={sessionForm.notes}
                  onChange={(event) =>
                    setSessionForm((current) => ({ ...current, notes: event.target.value }))
                  }
                />
              </Field>
              <button className="primary" type="submit">
                <Save size={18} />
                {sessionForm.id ? "Save class" : "Add class"}
              </button>
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
    return <TimetableEditorPage accessToken={accessToken} timetableId={match[1]} />;
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
          <EmptyPanel title="Nothing created yet" text="New timetables will appear here after setup." />
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
                    <a href={`/t/${timetable.publicSlug}`} target="_blank" rel="noreferrer">
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

export function AdminMvpScreen({ path }: { path: string }) {
  useDocumentMetadata("CalenderZW Admin", "Create and publish class timetables.");
  const { status, user, accessToken, signOut } = useAdminAccess();
  const data = useAdminData(accessToken);

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

  return (
    <main className="page admin-page">
      <section className="pilot-page-hero">
        <ShieldCheck size={28} />
        <div>
          <h1>CalenderZW Admin</h1>
          <p>{user?.email ?? "Administrator session active"}</p>
        </div>
        <button className="secondary" type="button" onClick={() => void signOut()}>
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
          {data.loading && data.timetables.length === 0 ? <p>Loading admin data...</p> : null}
          {path === "/admin" ? <AdminOverview timetables={data.timetables} /> : null}
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
        </div>
      </div>
    </main>
  );
}

export function FinderMvpScreen() {
  useDocumentMetadata("Find timetable | CalenderZW", "Open a published class timetable.");
  const [slug, setSlug] = useState("");

  return (
    <main className="page">
      <section className="pilot-page-hero">
        <Link2 size={28} />
        <div>
          <h1>Open a published timetable</h1>
          <p>Paste the shared class link or enter the final slug from the timetable URL.</p>
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

export function PublicTimetableMvpScreen({ slug }: { slug: string }) {
  useDocumentMetadata("Timetable | CalenderZW", "View a published timetable and add it to your calendar.");
  const [timetable, setTimetable] = useState<PublicTimetable | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [reminderPreset, setReminderPreset] = useState<"prepared" | "on_time" | "commuter" | "custom">("prepared");
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
        setMessage(error instanceof Error ? error.message : "This timetable is unavailable.");
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

  async function prepareCalendar(provider: "ics_download" | "webcal_subscription" | "apple_subscription") {
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
      setMessage(error instanceof Error ? error.message : "Could not prepare the calendar.");
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
          <Surface title="Class timetable" subtitle={`${timetable.institution} · Published version ${timetable.versionNumber}`}>
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
                        <article key={session.stableSessionKey} className="pilot-session-card">
                          <div>
                            <strong>
                              {session.startTime.slice(0, 5)}-{session.endTime.slice(0, 5)}
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
                  event.target.value as "prepared" | "on_time" | "commuter" | "custom",
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
          <button className="primary" type="button" onClick={() => void prepareCalendar("ics_download")}>
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
