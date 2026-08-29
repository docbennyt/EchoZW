import { Button as BaseButton } from "@base-ui/react/button";
import { Input as BaseInput } from "@base-ui/react/input";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CalendarCheck,
  Check,
  ExternalLink,
  History,
  Lock,
  Menu,
  ShieldCheck,
  X,
} from "lucide-react";
import { fetchAdminSession } from "./api/adminSession";
import { track } from "./analytics";
import { BRAND } from "./config/brand";
import { legalConfig } from "./config/legal";
import { AdminMvpScreen, PublicTimetableMvpScreen } from "./pilotMvp";
import { FinderDiscovery } from "./FinderDiscovery";
import { createClient as createSupabaseBrowserClient } from "./utils/supabase/client";

const currentPath = () => window.location.pathname;
const currentYear = new Date().getFullYear();

const publicNavigation = [
  { label: "How it works", href: "/#how" },
  { label: "Calendar options", href: "/#options" },
  { label: "For class reps", href: "/#reps" },
  { label: "Privacy & trust", href: "/#trust" },
] as const;

function setPageMetadata(input: {
  title: string;
  description: string;
  canonicalPath: string;
  robots?: string;
}) {
  document.title = input.title;
  const values: Array<[string, string, string]> = [
    ["name", "description", input.description],
    ["property", "og:title", input.title],
    ["property", "og:description", input.description],
    ["property", "og:url", `${BRAND.origin}${input.canonicalPath}`],
    ["property", "og:type", "website"],
    ["property", "og:image", `${BRAND.origin}${BRAND.squareIconPath}`],
    ["name", "twitter:card", "summary_large_image"],
  ];
  if (input.robots) values.push(["name", "robots", input.robots]);

  for (const [attribute, key, value] of values) {
    let meta = document.head.querySelector<HTMLMetaElement>(
      `meta[${attribute}="${key}"]`,
    );
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute(attribute, key);
      document.head.append(meta);
    }
    meta.setAttribute("content", value);
  }

  let canonical = document.head.querySelector<HTMLLinkElement>(
    'link[rel="canonical"]',
  );
  if (!canonical) {
    canonical = document.createElement("link");
    canonical.rel = "canonical";
    document.head.append(canonical);
  }
  canonical.href = `${BRAND.origin}${input.canonicalPath}`;
}

function usePageMetadata(input: Parameters<typeof setPageMetadata>[0]) {
  const { title, description, canonicalPath, robots } = input;
  useEffect(() => {
    setPageMetadata({ title, description, canonicalPath, robots });
  }, [title, description, canonicalPath, robots]);
}

function BrandLockup() {
  return (
    <span className="czw-brand-lockup">
      <span className="czw-mark" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      <span className="czw-wordmark">
        Calender<span>ZW</span>
      </span>
    </span>
  );
}

function GlobalHeader({ transparent = false }: { transparent?: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", close);
    };
  }, [menuOpen]);

  return (
    <header
      className={`czw-header${transparent ? " czw-header-home" : ""}`}
      data-component="GlobalHeader"
    >
      <div className="czw-shell czw-nav-row">
        <a className="czw-brand" href="/" aria-label="CalenderZW home">
          <BrandLockup />
        </a>
        <nav
          id="czw-public-navigation"
          className={`czw-nav-links${menuOpen ? " is-open" : ""}`}
          aria-label="Primary navigation"
        >
          {publicNavigation.map((item) => (
            <a
              key={item.href}
              href={item.href}
              onClick={() => setMenuOpen(false)}
            >
              {item.label}
            </a>
          ))}
          <a
            className="czw-nav-admin"
            href="/admin"
            onClick={() => setMenuOpen(false)}
          >
            Admin
          </a>
        </nav>
        <a className="czw-button czw-button-primary czw-nav-cta" href="/find">
          Find timetable <ArrowRight size={16} aria-hidden="true" />
        </a>
        <button
          className="czw-menu-button"
          type="button"
          aria-label={
            menuOpen ? "Close navigation menu" : "Open navigation menu"
          }
          aria-expanded={menuOpen}
          aria-controls="czw-public-navigation"
          onClick={() => setMenuOpen((value) => !value)}
        >
          {menuOpen ? (
            <X size={22} aria-hidden="true" />
          ) : (
            <Menu size={22} aria-hidden="true" />
          )}
        </button>
      </div>
    </header>
  );
}

function GlobalFooter({ compact = false }: { compact?: boolean }) {
  return (
    <footer
      className={`czw-footer${compact ? " czw-footer-compact" : ""}`}
      data-component="GlobalFooter"
    >
      <div className="czw-shell">
        {!compact ? (
          <div className="czw-footer-grid">
            <div className="czw-footer-brand">
              <a
                className="czw-brand czw-brand-on-dark"
                href="/"
                aria-label="CalenderZW home"
              >
                <BrandLockup />
              </a>
              <p>
                Student timetable and calendar synchronisation, built for
                university life in Zimbabwe.
              </p>
            </div>
            <div className="czw-footer-links">
              <div>
                <strong>Product</strong>
                <a href="/find">Find timetable</a>
                <a href="/#how">How it works</a>
                <a href="/#options">Calendar options</a>
              </div>
              <div>
                <strong>Support</strong>
                <a href="/support">Help centre</a>
                <a href="/support">Report a timetable problem</a>
                <a href="/account/settings">Calendar settings</a>
              </div>
              <div>
                <strong>Legal</strong>
                <a href="/privacy">Privacy Policy</a>
                <a href="/terms">Terms of Service</a>
                <a href="/data-deletion">Data deletion</a>
                <a href={`mailto:${legalConfig.supportEmail}`}>Contact</a>
              </div>
            </div>
          </div>
        ) : (
          <nav className="czw-compact-links" aria-label="Timetable footer">
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
            <a href="/support">Report a timetable problem</a>
          </nav>
        )}
        <div className="czw-footer-bottom">
          <span>© {currentYear} CalenderZW</span>
          <span>
            Made with ❤️ by{" "}
            <a
              href="https://docbennyt.github.io"
              target="_blank"
              rel="noreferrer noopener"
            >
              Dr BennyT
            </a>
          </span>
        </div>
      </div>
    </footer>
  );
}

function PublicShell({
  children,
  compactFooter = false,
}: {
  children: React.ReactNode;
  compactFooter?: boolean;
}) {
  return (
    <div className="czw-app-shell">
      <GlobalHeader />
      {children}
      <GlobalFooter compact={compactFooter} />
    </div>
  );
}

function HomePage() {
  usePageMetadata({
    title: "CalenderZW | Your university timetable, already in your calendar",
    description:
      "Find a published class timetable, choose useful reminders, and add lectures to the calendar you already use.",
    canonicalPath: "/",
  });

  return (
    <div className="czw-app-shell czw-marketing">
      <GlobalHeader transparent />
      <a className="czw-skip" href="#main">
        Skip to content
      </a>
      <main id="main">
        <section className="czw-hero" id="top">
          <div className="czw-shell czw-hero-grid">
            <div className="czw-hero-copy-block">
              <span className="czw-eyebrow">
                Your timetable, already organised
              </span>
              <h1>
                Your university timetable,{" "}
                <span>already in your calendar.</span>
              </h1>
              <p>
                CalenderZW helps students find a published class timetable,
                choose useful reminders, and add lectures to the calendar they
                already use.
              </p>
              <div className="czw-hero-actions">
                <a className="czw-button czw-button-primary" href="/find">
                  Find my timetable <ArrowRight size={17} aria-hidden="true" />
                </a>
                <a className="czw-button czw-button-secondary" href="#how">
                  See how it works <span aria-hidden="true">↓</span>
                </a>
              </div>
              <div className="czw-microcopy">
                <span>No app required</span>
                <i />
                <span>No student account needed</span>
              </div>
            </div>
            <ProductScene />
          </div>
        </section>

        <section className="czw-trust-strip" aria-label="Product principles">
          <div className="czw-shell czw-trust-strip-inner">
            <span>
              <strong>Built in Zimbabwe</strong> for university life
            </span>
            <i />
            <span>One class link</span>
            <i />
            <span>The calendar you already use</span>
          </div>
        </section>

        <section className="czw-section czw-problem-section">
          <div className="czw-shell czw-two-col">
            <div
              className="czw-message-stack"
              aria-label="Typical timetable messages"
            >
              <div>
                “Does anyone know where tomorrow’s lecture is?”
                <small>Class group · 19:42</small>
              </div>
              <div>
                “Timetable updated again 👆”<small>Class rep · 20:08</small>
              </div>
              <div>
                “Please resend the PDF.”<small>3 unread replies</small>
              </div>
            </div>
            <div className="czw-section-copy czw-section-copy-dark">
              <span className="czw-kicker">
                Keep the conversation. Lose the searching.
              </span>
              <h2>
                Keep WhatsApp for conversation.{" "}
                <em>Let your calendar remember the timetable.</em>
              </h2>
              <p>
                CalenderZW turns a published class schedule into something your
                phone already knows how to use.
              </p>
            </div>
          </div>
        </section>

        <section className="czw-section" id="how">
          <div className="czw-shell">
            <div className="czw-section-head">
              <span className="czw-kicker">Three clear steps</span>
              <h2>From class link to calendar in minutes.</h2>
              <p>
                No account maze. No new daily habit. Just find, prepare and add.
              </p>
            </div>
            <div className="czw-step-grid">
              <article>
                <span>01</span>
                <h3>Find your class</h3>
                <p>
                  Open a shared class link or find the timetable for your
                  institution, programme and group.
                </p>
              </article>
              <article>
                <span>02</span>
                <h3>Choose your reminders</h3>
                <p>
                  Pick a useful reminder preset before preparing the calendar
                  connection.
                </p>
              </article>
              <article>
                <span>03</span>
                <h3>Add it to your calendar</h3>
                <p>
                  Use the supported method that works best on your phone or
                  desktop.
                </p>
              </article>
            </div>
          </div>
        </section>

        <section className="czw-section czw-options-section" id="options">
          <div className="czw-shell">
            <div className="czw-section-head czw-section-head-on-dark">
              <span className="czw-kicker">Calendar options</span>
              <h2>Use the method your device understands.</h2>
              <p>
                CalenderZW keeps setup language simple and separates one-time
                imports from subscriptions.
              </p>
            </div>
            <div className="czw-option-grid">
              <article>
                <CalendarCheck size={22} />
                <h3>Apple Calendar</h3>
                <p>
                  Subscribe where supported and stay connected to future
                  published timetable changes.
                </p>
              </article>
              <article>
                <CalendarCheck size={22} />
                <h3>Calendar file (.ics)</h3>
                <p>
                  Download a one-time calendar file compatible with many
                  calendar applications.
                </p>
              </article>
              <article>
                <ExternalLink size={22} />
                <h3>Subscription link</h3>
                <p>
                  Use a private calendar URL in supported desktop and calendar
                  clients.
                </p>
              </article>
              <article>
                <CalendarCheck size={22} />
                <h3>Google Calendar</h3>
                <p>
                  Direct CalenderZW connection is not presented as ready yet.
                  Subscription/import options remain available.
                </p>
                <small>Coming later</small>
              </article>
            </div>
          </div>
        </section>

        <section className="czw-section" id="trust">
          <div className="czw-shell czw-trust-grid">
            <div className="czw-section-head">
              <span className="czw-kicker">Know what you’re looking at</span>
              <h2>Clear timetable context, without invented trust.</h2>
              <p>
                Students should be able to see publication status, update
                context and where to report a timetable problem.
              </p>
            </div>
            <div className="czw-trust-card">
              <div>
                <small>CLASS TIMETABLE</small>
                <strong>BTech Computer Science · 1.1</strong>
                <span>
                  <Check size={14} /> Published
                </span>
              </div>
              <div className="czw-change-row">
                <span>
                  <strong>Operating Systems</strong>
                  <small>Tuesday · 14:00</small>
                </span>
                <span>
                  <s>N109</s> → <b>N205</b>
                </span>
              </div>
              <a href="/support">Report a problem →</a>
            </div>
          </div>
        </section>

        <section className="czw-section czw-rep-section" id="reps">
          <div className="czw-shell czw-rep-card">
            <div>
              <span className="czw-kicker">For class representatives</span>
              <h2>Your class doesn’t have a timetable here yet?</h2>
              <p>
                Class representatives can help keep one class schedule accurate,
                published and easy to share.
              </p>
            </div>
            <a className="czw-button czw-button-primary" href="/admin/login">
              Set up my class <ArrowRight size={16} />
            </a>
          </div>
        </section>

        <section className="czw-share-section">
          <div className="czw-shell czw-two-col">
            <div className="czw-whatsapp-card">
              <div className="czw-wa-head">
                <span>CS</span>
                <div>
                  <strong>Computer Science 1.1</strong>
                  <small>Class group</small>
                </div>
              </div>
              <div className="czw-wa-message">
                CS 1.1 timetable is live ✅<br />
                <br />
                View it and add it to your calendar:
                <br />
                <a href="/find">calender.aido.co.zw/t/...</a>
                <small>No app needed · 10:42</small>
              </div>
            </div>
            <div className="czw-section-copy czw-section-copy-dark">
              <span className="czw-kicker">Made to move through the class</span>
              <h2>One useful link. Everyone keeps their own calendar.</h2>
              <p>
                WhatsApp remains the distribution channel. CalenderZW gives the
                timetable a cleaner place to live.
              </p>
            </div>
          </div>
        </section>

        <section className="czw-final-cta">
          <div className="czw-shell">
            <span className="czw-kicker">Find your class</span>
            <h2>Let your calendar handle the rest.</h2>
            <p>
              Your timetable is probably the last thing you should have to
              remember.
            </p>
            <div className="czw-final-actions">
              <a className="czw-button czw-button-primary" href="/find">
                Find my timetable <ArrowRight size={16} />
              </a>
              <a
                className="czw-button czw-button-secondary"
                href="/admin/login"
              >
                Set up my class
              </a>
            </div>
            <small>Free for students.</small>
          </div>
        </section>
      </main>
      <GlobalFooter />
    </div>
  );
}

function ProductScene() {
  return (
    <div
      className="czw-product-scene"
      aria-label="CalenderZW timetable being added to a calendar"
    >
      <div className="czw-scene-halo" />
      <div className="czw-floating-card czw-reminder-card">
        <strong>◷ Reminder preset</strong>
        <small>Prepared</small>
        <div>
          <span>24h</span>
          <span>30m</span>
        </div>
      </div>
      <div className="czw-phone">
        <div className="czw-phone-top">
          <i />
        </div>
        <div className="czw-phone-head">
          <span>
            <small>CS 1.1 · WEEK 4</small>
            <strong>Monday</strong>
          </span>
          <span>
            <Check size={12} /> Published
          </span>
        </div>
        <div className="czw-phone-schedule">
          <div>
            <time>08:00</time>
            <span>
              <strong>Operating Systems</strong>
              <small>N110 · 1h 30m</small>
            </span>
          </div>
          <div>
            <time>10:15</time>
            <span>
              <strong>Discrete Mathematics</strong>
              <small>E/HALL · 1h 30m</small>
            </span>
          </div>
          <div>
            <time>14:00</time>
            <span>
              <strong>Technopreneurship I</strong>
              <small>N109 · 1h</small>
            </span>
          </div>
        </div>
        <div className="czw-phone-cta">
          Add timetable to calendar <span>→</span>
        </div>
      </div>
      <div className="czw-floating-card czw-result-card">
        <strong>
          <Check size={14} /> Added to calendar
        </strong>
        <small>3 lectures · reminders ready</small>
      </div>
    </div>
  );
}

const privacySections = [
  "Scope",
  "Information we collect",
  "Google Calendar data",
  "Calendar subscriptions",
  "Use and sharing",
  "Retention and security",
  "Your choices",
  "Contact",
];

function LegalDocumentPage({ type }: { type: "privacy" | "terms" | "data" }) {
  const privacy = type === "privacy";
  const terms = type === "terms";
  const title = privacy
    ? "Privacy Policy"
    : terms
      ? "Terms of Service"
      : "Data deletion";
  const sections = privacy
    ? privacySections
    : terms
      ? ["Overview", "Google Calendar", "Private feeds", "Requests", "Contact"]
      : ["Overview", "Google Calendar", "Private feeds", "Contact"];
  const canonicalPath = type === "data" ? "/data-deletion" : `/${type}`;

  usePageMetadata({
    title: `${title} | CalenderZW`,
    description: `${title} for CalenderZW, the student timetable and calendar synchronisation service.`,
    canonicalPath,
  });

  return (
    <PublicShell>
      <main className="czw-legal-page">
        <div className="czw-shell czw-legal-grid">
          <aside className="czw-legal-toc" aria-label={`${title} sections`}>
            <strong>On this page</strong>
            <nav>
              {sections.map((item) => (
                <a
                  key={item}
                  href={`#${item.toLowerCase().replaceAll(" ", "-")}`}
                >
                  {item}
                </a>
              ))}
            </nav>
          </aside>
          <article className="czw-legal-document">
            <span className="czw-eyebrow">CalenderZW legal</span>
            <h1>{title}</h1>
            <p className="czw-legal-meta">
              Effective date: {legalConfig.effectiveDate}
              <br />
              Last updated: {legalConfig.lastUpdatedDate}
            </p>
            {privacy ? <PrivacyContent /> : null}
            {terms ? <TermsContent /> : null}
            {type === "data" ? <DataDeletionContent /> : null}
          </article>
        </div>
      </main>
    </PublicShell>
  );
}

function PrivacyContent() {
  return (
    <>
      <div className="czw-summary-card">
        CalenderZW uses the minimum access needed for timetable and calendar
        features. Public timetables can be viewed without a student account.
      </div>
      <section id="scope">
        <h2>1. Scope</h2>
        <p>
          This policy applies to timetable pages, administrator tools, calendar
          feeds, downloads, optional Google Calendar connection and support
          services for {legalConfig.tradingName}, operated by{" "}
          {legalConfig.operatorName} from {legalConfig.publicAppUrl}.
        </p>
      </section>
      <section id="information-we-collect">
        <h2>2. Information we collect</h2>
        <h3>Information you provide</h3>
        <p>
          We may collect account email, institution and class selections,
          timetable submissions, reminder preferences, reports and support
          messages. Students can view public timetables and download public
          calendar files without an account.
        </p>
        <h3>Information collected automatically</h3>
        <p>
          We may collect device/browser type, operating system, approximate
          region, server IP logs, page interactions, diagnostics, timestamps,
          anonymous session identifiers, subscription identifiers and feed
          retrieval timestamps for security and reliability.
        </p>
      </section>
      <section id="google-calendar-data">
        <h2>3. Google Calendar data</h2>
        <p>
          If you choose direct Google Calendar synchronisation when that feature
          is enabled, CalenderZW requests permission to create and manage a
          separate secondary calendar created by CalenderZW. It is used for the
          timetable events, reminders, updates, cancellations, recovery and
          disconnect actions associated with that app-created calendar.
        </p>
        <p>
          CalenderZW does not use this permission to read, analyse, modify or
          delete events from your pre-existing personal calendars. Use and
          transfer of information received from Google APIs is intended to
          follow the Google API Services User Data Policy, including Limited Use
          requirements.
        </p>
        <p>
          Google Workspace API information is not used to develop, improve or
          train generalised or non-personalised AI or machine-learning models.
        </p>
      </section>
      <section id="calendar-subscriptions">
        <h2>4. Calendar subscriptions</h2>
        <p>
          Private feed URLs are capability links. Anyone possessing one may be
          able to view the timetable feed. CalenderZW stores hashed feed tokens
          and supports feed revocation.
        </p>
      </section>
      <section id="use-and-sharing">
        <h2>5. Use and sharing</h2>
        <p>
          We use data to show timetables, create calendar files and
          subscriptions, apply reminders, process reports, provide support,
          protect the service, diagnose failures and comply with law. We do not
          sell personal information or Google user data and do not use Google
          user data for targeted advertising.
        </p>
      </section>
      <section id="retention-and-security">
        <h2>6. Retention and security</h2>
        <p>
          Public timetable audit history may be retained for accuracy. Google
          credentials are retained only while the relevant connection remains
          active. Safeguards include HTTPS requirements, server-side secrets,
          API validation, hashed private-feed tokens and access controls.
        </p>
      </section>
      <section id="your-choices">
        <h2>7. Your choices</h2>
        <p>
          You can use calendar-file or subscription options without direct
          Google connection, disconnect optional connections, request feed
          revocation and request deletion through{" "}
          <a href="/data-deletion">Data deletion</a>.
        </p>
      </section>
      <section id="contact">
        <h2>8. Contact</h2>
        <p>
          {legalConfig.operatorName}
          <br />
          {legalConfig.operatorAddress}
          <br />
          {legalConfig.country}
          <br />
          Privacy:{" "}
          <a href={`mailto:${legalConfig.privacyEmail}`}>
            {legalConfig.privacyEmail}
          </a>
          <br />
          Support:{" "}
          <a href={`mailto:${legalConfig.supportEmail}`}>
            {legalConfig.supportEmail}
          </a>
        </p>
      </section>
    </>
  );
}

function TermsContent() {
  return (
    <>
      <div className="czw-summary-card">
        These terms describe responsible use of CalenderZW timetable, reminder
        and calendar features.
      </div>
      <section id="overview">
        <h2>1. Agreement and service</h2>
        <p>
          These Terms govern access to {legalConfig.tradingName}, a timetable
          discovery, calendar synchronisation, reminder and academic scheduling
          service operated by {legalConfig.operatorName}. Availability varies by
          institution, provider, device and location.
        </p>
      </section>
      <section id="google-calendar">
        <h2>2. Google Calendar connection</h2>
        <p>
          Any direct Google connection is voluntary and narrowly scoped. Where
          enabled, CalenderZW creates and manages a separate secondary calendar.
          Google services remain subject to Google’s terms and no Google
          endorsement is implied.
        </p>
      </section>
      <section id="private-feeds">
        <h2>3. Accuracy, reminders and private feeds</h2>
        <p>
          Academic schedules can change without immediate notice. Check
          high-consequence dates against official institution sources. Calendar
          providers and devices control final alert delivery and subscription
          refresh timing. Keep private feed URLs private.
        </p>
      </section>
      <section id="requests">
        <h2>4. Submissions and acceptable use</h2>
        <p>
          Submitted timetable data must be authorised or reasonably based,
          non-malicious and respectful of institutional rules. You grant
          CalenderZW the limited licence needed to host and display submitted
          timetable content to operate the service.
        </p>
      </section>
      <section id="contact">
        <h2>5. Governing law and contact</h2>
        <p>
          These Terms are governed by the laws of {legalConfig.governingLaw},
          subject to mandatory protections that may apply.{" "}
          {legalConfig.disputeVenue} will have jurisdiction subject to
          applicable law.
        </p>
        <p>
          Questions:{" "}
          <a href={`mailto:${legalConfig.supportEmail}`}>
            {legalConfig.supportEmail}
          </a>
          .
        </p>
      </section>
    </>
  );
}

function DataDeletionContent() {
  return (
    <>
      <div className="czw-summary-card">
        Use these options to disconnect calendar access, revoke private feeds or
        request deletion of CalenderZW account and connection records.
      </div>
      <section id="overview">
        <h2>1. Delete an account or records</h2>
        <p>
          Email{" "}
          <a href={`mailto:${legalConfig.privacyEmail}`}>
            {legalConfig.privacyEmail}
          </a>{" "}
          from the address associated with the account or connection. Include
          enough detail to identify the record without sending passwords, tokens
          or private feed URLs in plain text.
        </p>
      </section>
      <section id="google-calendar">
        <h2>2. Disconnect Google Calendar</h2>
        <p>
          If a direct Google Calendar connection is enabled for your account,
          disconnect it through account settings or revoke CalenderZW access
          from your Google Account. You can also contact support for help.
        </p>
      </section>
      <section id="private-feeds">
        <h2>3. Revoke private feeds</h2>
        <p>
          Request feed revocation through the supported settings flow or contact
          support with the relevant subscription reference. Do not publish a
          private feed URL.
        </p>
      </section>
      <section id="contact">
        <h2>4. Contact</h2>
        <p>
          Privacy:{" "}
          <a href={`mailto:${legalConfig.privacyEmail}`}>
            {legalConfig.privacyEmail}
          </a>
          <br />
          Support:{" "}
          <a href={`mailto:${legalConfig.supportEmail}`}>
            {legalConfig.supportEmail}
          </a>
        </p>
      </section>
    </>
  );
}

function SupportPage() {
  usePageMetadata({
    title: "Support | CalenderZW",
    description:
      "CalenderZW help for timetable links, calendar subscriptions, .ics imports and timetable problem reports.",
    canonicalPath: "/support",
  });
  return (
    <PublicShell>
      <main className="czw-product-page czw-support-page">
        <div className="czw-shell">
          <div className="czw-page-heading">
            <ShieldCheck size={28} />
            <div>
              <span className="czw-eyebrow">CalenderZW support</span>
              <h1>How can we help?</h1>
              <p>
                Get help with timetable and calendar setup. Email{" "}
                <a href={`mailto:${legalConfig.supportEmail}`}>
                  {legalConfig.supportEmail}
                </a>
                .
              </p>
            </div>
          </div>
          <div className="czw-support-grid">
            <article>
              <h2>Calendar setup</h2>
              <p>
                Check that your reminder preset was saved, device calendar sync
                is enabled, and the calendar app has network access.
              </p>
            </article>
            <article>
              <h2>Apple subscriptions</h2>
              <p>
                Apple Calendar controls refresh timing, so a published timetable
                change may not appear immediately on every device.
              </p>
            </article>
            <article>
              <h2>.ics imports</h2>
              <p>
                A downloaded .ics file is a one-time import. Future changes may
                require another import unless you use a supported subscription.
              </p>
            </article>
            <article>
              <h2>Report a timetable problem</h2>
              <p>
                Email support with the public class link and the correction
                needed. Never send a private calendar subscription URL.
              </p>
            </article>
          </div>
        </div>
      </main>
    </PublicShell>
  );
}

function FinderPage() {
  usePageMetadata({
    title: "Find your timetable | CalenderZW",
    description:
      "Choose your institution, programme and class to open a published timetable without creating a student account.",
    canonicalPath: "/find",
  });
  return (
    <PublicShell>
      <div className="czw-product-page czw-finder-wrap">
        <div className="czw-shell">
          <div className="czw-product-intro">
            <span className="czw-eyebrow">Find your class</span>
            <h1>Find your timetable.</h1>
            <p>
              Choose your institution, programme and class. No student account
              needed.
            </p>
            <span className="czw-trust-note">
              <Check size={14} /> Published class timetables only
            </span>
          </div>
          <FinderDiscovery />
        </div>
      </div>
    </PublicShell>
  );
}

function PublicTimetablePage({ path }: { path: string }) {
  const slug = path.startsWith("/t/")
    ? path.replace(/^\/t\//, "")
    : path.replace(/^\/sync\//, "");
  return (
    <PublicShell compactFooter>
      <div className="czw-embedded-product czw-public-timetable-wrap">
        <PublicTimetableMvpScreen slug={slug} />
      </div>
    </PublicShell>
  );
}

function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<
    "idle" | "loading" | "forbidden" | "error"
  >("idle");
  const [message, setMessage] = useState("");

  usePageMetadata({
    title: "Admin login | CalenderZW",
    description: "Sign in to manage CalenderZW timetables.",
    canonicalPath: "/admin/login",
    robots: "noindex, nofollow",
  });

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("loading");
    setMessage("");
    let supabase;
    try {
      supabase = createSupabaseBrowserClient();
    } catch {
      setStatus("error");
      setMessage("Administrator sign-in is temporarily unavailable.");
      return;
    }
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    const accessToken = data.session?.access_token;
    if (error || !accessToken) {
      setStatus("error");
      setMessage("Email or password is incorrect.");
      return;
    }
    try {
      await fetchAdminSession(accessToken);
      track("admin_logged_in");
      window.history.replaceState({}, "", "/admin");
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (caught) {
      await supabase.auth.signOut();
      if (caught instanceof Error && caught.name === "FORBIDDEN") {
        setStatus("forbidden");
        setMessage(
          "This account does not have CalenderZW administrator access.",
        );
      } else {
        setStatus("error");
        setMessage("Administrator sign-in is temporarily unavailable.");
      }
    }
  }

  return (
    <PublicShell>
      <main className="czw-auth-page">
        <section className="czw-auth-card" aria-labelledby="admin-login-title">
          <div className="czw-auth-icon">
            <Lock size={22} />
          </div>
          <span className="czw-eyebrow">Admin</span>
          <h1 id="admin-login-title">Welcome back.</h1>
          <p>Sign in to manage CalenderZW timetables.</p>
          <form onSubmit={signIn}>
            <label>
              <span>Email</span>
              <BaseInput
                autoComplete="email"
                inputMode="email"
                name="email"
                required
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label>
              <span>Password</span>
              <BaseInput
                autoComplete="current-password"
                name="password"
                required
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <BaseButton
              className="czw-button czw-button-primary"
              disabled={status === "loading"}
              type="submit"
            >
              <Lock size={17} />
              {status === "loading" ? "Signing in…" : "Sign in"}
            </BaseButton>
          </form>
          {message ? (
            <p
              className="czw-auth-message"
              role={
                status === "error" || status === "forbidden"
                  ? "alert"
                  : "status"
              }
            >
              {message}
            </p>
          ) : null}
          <a className="czw-auth-back" href="/">
            ← Back to CalenderZW
          </a>
        </section>
      </main>
    </PublicShell>
  );
}

function AdminPage({ path }: { path: string }) {
  return (
    <PublicShell>
      <div className="czw-product-page czw-admin-wrap">
        <AdminMvpScreen path={path} />
      </div>
    </PublicShell>
  );
}

function AccountSettingsPage() {
  usePageMetadata({
    title: "Account settings | CalenderZW",
    description: "Calendar privacy controls and legal links for CalenderZW.",
    canonicalPath: "/account/settings",
    robots: "noindex, nofollow",
  });
  return (
    <PublicShell>
      <main className="czw-product-page">
        <div className="czw-shell czw-narrow-page">
          <div className="czw-page-heading">
            <Lock size={26} />
            <div>
              <h1>Account settings</h1>
              <p>Calendar privacy controls and account help.</p>
            </div>
          </div>
          <div className="czw-action-card">
            <h2>Calendar connections</h2>
            <p>
              Use the deletion and support pages to disconnect optional
              integrations or revoke private feeds.
            </p>
            <a className="czw-button czw-button-primary" href="/data-deletion">
              Data deletion options
            </a>
            <a className="czw-text-link" href="/privacy#google-calendar-data">
              Google data use
            </a>
          </div>
        </div>
      </main>
    </PublicShell>
  );
}

function HistoryPage() {
  return (
    <PublicShell>
      <main className="czw-product-page">
        <div className="czw-shell czw-narrow-page">
          <div className="czw-page-heading">
            <History size={26} />
            <div>
              <h1>Update history unavailable</h1>
              <p>
                Version history will appear when a published timetable exposes
                historical changes.
              </p>
            </div>
          </div>
        </div>
      </main>
    </PublicShell>
  );
}

function GoogleVerificationReadinessPage() {
  usePageMetadata({
    title: "Google verification readiness | CalenderZW",
    description:
      "Development-only Google OAuth verification readiness checklist for CalenderZW.",
    canonicalPath: "/admin/google-verification-readiness",
    robots: "noindex, nofollow",
  });
  const rows = useMemo(
    () => [
      ["App name", BRAND.productName],
      ["Homepage", BRAND.origin],
      ["Privacy", `${BRAND.origin}/privacy`],
      ["Terms", `${BRAND.origin}/terms`],
      ["Data deletion", `${BRAND.origin}/data-deletion`],
      ["Support", `${BRAND.origin}/support`],
      ["Operator", legalConfig.operatorName],
    ],
    [],
  );
  return (
    <PublicShell>
      <main className="czw-product-page">
        <div className="czw-shell czw-narrow-page">
          <div className="czw-page-heading">
            <ShieldCheck size={26} />
            <div>
              <h1>Google verification readiness</h1>
              <p>
                Reviewer-facing URLs and identity checks without secrets or
                tokens.
              </p>
            </div>
          </div>
          <div className="czw-readiness-table">
            {rows.map(([label, value]) => (
              <div key={label}>
                <strong>{label}</strong>
                <span>{value}</span>
              </div>
            ))}
          </div>
        </div>
      </main>
    </PublicShell>
  );
}

function NotFoundPage() {
  return (
    <PublicShell>
      <main className="czw-product-page">
        <div className="czw-shell czw-narrow-page">
          <div className="czw-page-heading">
            <CalendarCheck size={26} />
            <div>
              <h1>Page not found</h1>
              <p>
                Use the timetable finder to open a published class schedule.
              </p>
            </div>
          </div>
          <a className="czw-button czw-button-primary" href="/find">
            Find timetable
          </a>
        </div>
      </main>
    </PublicShell>
  );
}

export function AppV2() {
  const [path, setPath] = useState(currentPath());
  useEffect(() => {
    const update = () => setPath(currentPath());
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);

  if (path === "/dashboard" || path.startsWith("/dashboard/")) {
    window.history.replaceState({}, "", "/admin");
    return <AdminPage path="/admin" />;
  }
  if (path === "/") return <HomePage />;
  if (path === "/find" || path === "/institutions") return <FinderPage />;
  if (path === "/privacy") return <LegalDocumentPage type="privacy" />;
  if (path === "/terms") return <LegalDocumentPage type="terms" />;
  if (path === "/data-deletion") return <LegalDocumentPage type="data" />;
  if (path === "/support") return <SupportPage />;
  if (path === "/account/settings") return <AccountSettingsPage />;
  if (path === "/admin/google-verification-readiness")
    return <GoogleVerificationReadinessPage />;
  if (path === "/admin/login") return <AdminLoginPage />;
  if (path === "/admin" || path.startsWith("/admin/"))
    return <AdminPage path={path} />;
  if (path.endsWith("/history")) return <HistoryPage />;
  if (path.startsWith("/t/") || path.startsWith("/sync/"))
    return <PublicTimetablePage path={path} />;
  return <NotFoundPage />;
}
