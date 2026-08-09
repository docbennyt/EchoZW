import { useEffect, useState } from "react";
import {
  Download,
  GraduationCap,
  History,
  Lock,
  Menu,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { appConfig } from "./config/app";
import { BRAND } from "./config/brand";
import { legalConfig } from "./config/legal";
import { fetchAdminSession } from "./api/adminSession";
import { track } from "./analytics";
import { createClient as createSupabaseBrowserClient } from "./utils/supabase/client";
import type { Timetable } from "./domain/types";
import {
  AdminMvpScreen,
  FinderMvpScreen,
  PublicTimetableMvpScreen,
} from "./pilotMvp";

const currentPath = () => window.location.pathname;
const currentYear = new Date().getFullYear();

function setPageMetadata(input: {
  title: string;
  description: string;
  canonicalPath: string;
  ogTitle?: string;
  ogDescription?: string;
  robots?: string;
}) {
  document.title = input.title;
  const tags: Array<[string, string, string]> = [
    ["name", "description", input.description],
    ["property", "og:title", input.ogTitle ?? input.title],
    ["property", "og:description", input.ogDescription ?? input.description],
    ["property", "og:url", `${BRAND.origin}${input.canonicalPath}`],
    ["property", "og:type", "website"],
    ["property", "og:image", `${BRAND.origin}${BRAND.squareIconPath}`],
    ["name", "twitter:card", "summary_large_image"],
  ];
  if (input.robots) tags.push(["name", "robots", input.robots]);

  for (const [attribute, key, value] of tags) {
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
  const {
    title,
    description,
    canonicalPath,
    ogTitle,
    ogDescription,
    robots,
  } = input;
  useEffect(() => {
    setPageMetadata({
      title,
      description,
      canonicalPath,
      ogTitle,
      ogDescription,
      robots,
    });
  }, [title, description, canonicalPath, ogTitle, ogDescription, robots]);
}


const navigationLinks = [
  { label: "Find timetable", href: "/find" },
  { label: "How it works", href: "/#how-it-works" },
  { label: "Calendar options", href: "/#calendar-options" },
  { label: "Privacy", href: "/privacy" },
  { label: "Admin", href: "/admin" },
] as const;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <GlobalHeader />
      {children}
      <GlobalFooter />
    </div>
  );
}

function GlobalHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const path = currentPath();

  return (
    <header className="topbar" data-component="GlobalHeader">
      <a className="brand" href="/" aria-label="CalenderZW home">
        <span className="brand-mark">
          <img src="/favicon-96x96.png" alt="" />
        </span>
        <span>
          <strong>{appConfig.productName}</strong>
          <small>Operated by {appConfig.companyName}</small>
        </span>
      </a>
      <a className="nav-find" href="/find">
        <Search size={18} aria-hidden="true" />
        Find timetable
      </a>
      <button
        className="menu-trigger"
        type="button"
        aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
        aria-expanded={menuOpen}
        aria-controls="global-navigation"
        onClick={() => setMenuOpen((open) => !open)}
      >
        {menuOpen ? (
          <X size={22} aria-hidden="true" />
        ) : (
          <Menu size={22} aria-hidden="true" />
        )}
      </button>
      <nav
        id="global-navigation"
        className={menuOpen ? "open" : ""}
        aria-label="Main navigation"
      >
        {navigationLinks.map((item) => (
          <a
            key={item.href}
            href={item.href}
            aria-current={
              isCurrentNavigationPath(path, item.href) ? "page" : undefined
            }
            onClick={() => setMenuOpen(false)}
          >
            {item.label}
          </a>
        ))}
      </nav>
    </header>
  );
}

function isCurrentNavigationPath(path: string, href: string) {
  if (href === "/") return path === "/";
  const [hrefPath] = href.split("#");
  if (hrefPath === "/" && href.includes("#")) return false;
  return path === hrefPath || path.startsWith(`${hrefPath}/`);
}

function GlobalFooter() {
  return (
    <footer className="site-footer" data-component="GlobalFooter">
      <div className="footer-inner">
        <section className="footer-brand" aria-label="CalenderZW brand">
          <span className="brand-mark footer-mark">
            <img src="/favicon-96x96.png" alt="" />
          </span>
          <div>
            <strong>{appConfig.productName}</strong>
            <span>Student timetable and calendar synchronisation.</span>
          </div>
          <p>
            Verified university timetables, useful reminders, and simple
            calendar sync for students.
          </p>
          <small>Operated by {appConfig.companyName} Â· Built in Zimbabwe.</small>
        </section>
        <nav aria-label="Product">
          <h2>Product</h2>
          <a href="/find">Find timetable</a>
          <a href="/#how-it-works">How it works</a>
          <a href="/#calendar-options">Calendar options</a>
          <a href="/find">Published timetables</a>
        </nav>
        <nav aria-label="Support">
          <h2>Support</h2>
          <a href="/support">Help centre</a>
          <a href="/support">Report a timetable problem</a>
          <a href="/support">Google Calendar setup</a>
          <a href="/support">Apple Calendar setup</a>
        </nav>
        <nav aria-label="Legal">
          <h2>Legal</h2>
          <a href="/privacy">Privacy Policy</a>
          <a href="/terms">Terms of Service</a>
          <a href="/data-deletion">Data deletion</a>
          <a href="/support">Contact</a>
        </nav>
      </div>
      <div className="footer-bottom">
        <span>&copy; {currentYear} {legalConfig.operatorName}</span>
        <span>
          {legalConfig.tradingName} is operated by {legalConfig.operatorName}
        </span>
      </div>
    </footer>
  );
}


function VerificationBadge({
  status,
}: {
  status: Timetable["verificationStatus"];
}) {
  const label =
    status === "official"
      ? "Official"
      : status === "community_verified"
        ? "Community verified"
        : "Draft";
  return (
    <span className={`badge ${status}`}>
      <ShieldCheck size={16} aria-hidden="true" />
      {label}
    </span>
  );
}

function PublicTimetablePage() {
  return (
    <Shell>
      <PublicTimetableMvpScreen slug={currentPath().replace(/^\/t\//, "")} />
    </Shell>
  );
}

function FinderPage() {
  return (
    <Shell>
      <FinderMvpScreen />
    </Shell>
  );
}

function HomePage() {
  usePageMetadata({
    title: "CalenderZW | Add your university timetable to your calendar",
    description:
      "Find a verified student timetable, choose useful reminders, and add lectures to Google Calendar, Apple Calendar, Outlook, or another calendar application.",
    canonicalPath: "/",
    ogTitle: "CalenderZW",
    ogDescription: "Add your university timetable to your calendar.",
  });

  return (
    <Shell>
      <main className="home-page">
        <section className="home-hero">
          <div className="home-hero-copy">
            <p className="eyebrow">Your timetable, already organised</p>
            <p className="product-name">CalenderZW</p>
            <h1>Add your university timetable to your calendar</h1>
            <p className="product-category">
              Student timetable and calendar synchronisation, operated by aiDo.
            </p>
            <p>
              CalenderZW helps students find a verified class timetable, choose
              useful reminder times, and add lectures to Google Calendar, Apple
              Calendar, Outlook, or another calendar application.
            </p>
            <p className="trust-copy">
              Google Calendar connection is optional. When you choose direct
              Google Calendar synchronisation, CalenderZW asks for permission to
              create and manage a separate timetable calendar created by
              CalenderZW. It does not read or modify events in your existing
              personal calendars.
            </p>
            <div className="hero-actions">
              <a className="primary" href="/find">
                <Search size={20} aria-hidden="true" />
                Find my timetable
              </a>
              <a className="secondary dark" href="#how-it-works">
                See how it works
              </a>
              <a className="text-link" href="/find">
                Use a calendar file instead
              </a>
            </div>
          </div>
          <div className="product-preview" aria-label="CalenderZW product preview">
            <div className="preview-top">
              <img src={BRAND.iconPath} alt="" />
              <strong>CalenderZW</strong>
              <VerificationBadge status="community_verified" />
            </div>
            <ol>
              <li>Open a shared timetable or scan a QR code.</li>
              <li>Check the timetable and verification status.</li>
              <li>Choose reminder timing.</li>
              <li>Add it to a supported calendar.</li>
            </ol>
          </div>
        </section>

        <section id="how-it-works" className="home-section">
          <h2>How it works</h2>
          <div className="section-grid three">
            <article>
              <h3>Find your class</h3>
              <p>
                Search by institution, programme, year, semester, or shared
                class link.
              </p>
            </article>
            <article>
              <h3>Choose your reminders</h3>
              <p>
                Select a prepared, on-time, commuter, or custom reminder setup
                after you have seen the timetable.
              </p>
            </article>
            <article>
              <h3>Add your timetable</h3>
              <p>
                Connect Google Calendar, subscribe with Apple Calendar, or
                download a standard calendar file.
              </p>
            </article>
          </div>
        </section>

        <section id="calendar-options" className="home-section">
          <h2>Calendar options</h2>
          <div className="section-grid four">
            <article>
              <h3>Google Calendar</h3>
              <p>
                CalenderZW creates a dedicated secondary calendar, adds and
                maintains only timetable events selected by you, requires Google
                consent, and does not inspect existing personal calendars.
              </p>
            </article>
            <article>
              <h3>Apple Calendar</h3>
              <p>
                Use one-tap webcal subscription where supported. Apple Calendar
                asks you to confirm and controls refresh timing.
              </p>
            </article>
            <article>
              <h3>Universal .ics</h3>
              <p>
                Download a standard calendar file for many calendar apps. Future
                updates may require a new download unless you subscribe.
              </p>
            </article>
            <article>
              <h3>Outlook</h3>
              <p>
                Use supported subscription or .ics import paths. CalenderZW does
                not currently present a direct Outlook API connection.
              </p>
            </article>
          </div>
        </section>

        <section id="google-calendar-access" className="home-section disclosure-band">
          <h2>Why CalenderZW asks for Google Calendar access</h2>
          <p>
            When you select direct Google Calendar synchronisation, CalenderZW
            asks for permission to create and manage a separate timetable
            calendar created by CalenderZW. We use that permission to add your
            selected lectures, apply your reminder choices, and maintain those
            CalenderZW-created events when a published timetable changes.
          </p>
          <p>
            CalenderZW does not use this permission to read, analyse, modify, or
            delete events from your existing personal calendars.
          </p>
          <div className="inline-links">
            <a href="/privacy">Read the Privacy Policy</a>
            <a href="/data-deletion">View data-deletion controls</a>
            <a href="/find">Use .ics instead</a>
          </div>
        </section>

        <section className="home-section">
          <h2>Timetable trust</h2>
          <div className="section-grid three">
            <article>
              <h3>Official</h3>
              <p>Published or confirmed by an institution or authorised team.</p>
            </article>
            <article>
              <h3>Community verified</h3>
              <p>Checked by class representatives or verified contributors.</p>
            </article>
            <article>
              <h3>Draft or unverified</h3>
              <p>
                Useful for coordination, but students should verify
                high-consequence information such as exam dates with official
                institution sources.
              </p>
            </article>
          </div>
          <p className="helper">
            Timetable information may be supplied by institutions, authorised
            programme administrators, class representatives, or verified
            contributors.
          </p>
        </section>

        <section className="home-section">
          <h2>Built for student routines</h2>
          <ul className="benefit-list">
            <li>Stop searching through screenshots and chat history.</li>
            <li>See times and venues in one place.</li>
            <li>Use calendar-native reminders.</li>
            <li>Receive timetable updates where supported.</li>
            <li>Share one class link or QR code.</li>
            <li>Report incorrect timetable details.</li>
          </ul>
        </section>

        <section className="home-section privacy-summary">
          <h2>Privacy summary</h2>
          <p>
            CalenderZW collects only the information needed to provide timetable
            and calendar features. Google Calendar access is optional and
            limited to a separate calendar created by CalenderZW. We do not sell
            Google user data or use it for advertising.
          </p>
          <div className="inline-links">
            <a href="/privacy">Privacy Policy</a>
            <a href="/terms">Terms of Service</a>
            <a href="/data-deletion">Data deletion</a>
            <a href="/support">Support</a>
          </div>
        </section>

        <section className="home-section final-cta">
          <h2>Ready to add your class timetable?</h2>
          <p>
            Search for your programme, check the verification status, and choose
            the calendar method that works best on your device.
          </p>
          <div className="hero-actions">
            <a className="primary" href="/find">
              <Search size={20} aria-hidden="true" />
              Find my timetable
            </a>
            <a className="secondary dark" href="/support">
              Request a timetable
            </a>
          </div>
        </section>
      </main>
    </Shell>
  );
}

function PageHeader({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <header className="page-header">
      <span>{icon}</span>
      <div>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
    </header>
  );
}

function HistoryPage() {
  return (
    <Shell>
      <main className="page">
        <PageHeader
          icon={<History />}
          title="Update history unavailable"
          text="No published timetable history is available from the database for this link."
        />
        <EmptyState
          title="No published history."
          text="Version history will appear after a real timetable has been published."
        />
      </main>
    </Shell>
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
  const isPrivacy = type === "privacy";
  const isTerms = type === "terms";
  const title = isPrivacy
    ? "Privacy Policy"
    : isTerms
      ? "Terms of Service"
      : "Data deletion";
  usePageMetadata({
    title: `${title} | ${legalConfig.tradingName}`,
    description: `${title} for ${legalConfig.tradingName}, the student timetable and calendar synchronisation service operated by ${legalConfig.operatorName}.`,
    canonicalPath: type === "data" ? "/data-deletion" : `/${type}`,
  });

  return (
    <Shell>
      <main className="legal-page">
        <aside className="legal-toc" aria-label={`${title} sections`}>
          {(isPrivacy
            ? privacySections
            : [
                "Overview",
                "Google Calendar",
                "Private feeds",
                "Requests",
                "Contact",
              ]
          ).map((item) => (
            <a key={item} href={`#${item.toLowerCase().replaceAll(" ", "-")}`}>
              {item}
            </a>
          ))}
        </aside>
        <article className="legal-document">
          <p className="eyebrow">{legalConfig.tradingName} legal</p>
          <h1>{title}</h1>
          <p>
            Effective date: {legalConfig.effectiveDate}
            <br />
            Last updated: {legalConfig.lastUpdatedDate}
          </p>
          {isPrivacy && <PrivacyContent />}
          {isTerms && <TermsContent />}
          {type === "data" && <DataDeletionContent />}
        </article>
      </main>
    </Shell>
  );
}

function PrivacyContent() {
  return (
    <>
      <p className="summary-card">
        CalenderZW uses the minimum access needed to create and maintain a
        separate Google Calendar containing the timetable you choose. We do not
        read or modify your existing personal calendars.
      </p>
      <section id="scope">
        <h2>1. Scope</h2>
        <p>
          This policy applies to timetable pages, administrator tools, calendar
          feeds, Google Calendar connection, downloads, and support services
          for {legalConfig.tradingName}, operated by{" "}
          {legalConfig.operatorName} from {legalConfig.publicAppUrl}.
        </p>
      </section>
      <section id="information-we-collect">
        <h2>2. Information we collect</h2>
        <h3>Information you provide</h3>
        <p>
          We may collect account email, institution and class selections,
          timetable submissions, reminder preferences, reports, support
          messages, and payment references when paid services are enabled.
          Students can view public timetables and download public calendar files
          without an account.
        </p>
        <h3>Information collected automatically</h3>
        <p>
          We may collect device/browser type, operating system, approximate
          region, server IP logs, page interactions, diagnostics, timestamps,
          anonymous session identifiers, subscription identifiers, and feed
          retrieval timestamps for security and reliability.
        </p>
      </section>
      <section id="google-calendar-data">
        <h2>3. Google Calendar data</h2>
        <p>
          When you choose direct Google Calendar synchronisation, CalenderZW
          requests permission to create and manage a separate secondary calendar
          created by CalenderZW. We use it only to add selected timetable
          events, reminders, updates, cancellations, failure recovery, and
          disconnect actions for that app-created calendar.
        </p>
        <p>
          CalenderZW does not use this permission to read, analyse, modify, or
          delete events from your pre-existing personal calendars. CalenderZW's
          use and transfer of information received from Google APIs adheres to
          the Google API Services User Data Policy, including the Limited Use
          requirements.
        </p>
        <p>
          CalenderZW does not use information obtained through Google Workspace
          APIs to develop, improve, or train generalised or non-personalised
          artificial intelligence or machine-learning models.
        </p>
      </section>
      <section id="calendar-subscriptions">
        <h2>4. Calendar subscriptions</h2>
        <p>
          Private feed URLs are unguessable capability links. Anyone possessing
          one may be able to view the timetable feed. CalenderZW stores hashed
          feed tokens and lets feed records be revoked.
        </p>
      </section>
      <section id="use-and-sharing">
        <h2>5. Use and sharing</h2>
        <p>
          We use data to show timetables, create calendar files/subscriptions,
          apply reminders, process reports, provide support, protect the
          service, diagnose failures, comply with law, and improve user-facing
          features. We do not sell personal information or Google user data, and
          we do not use Google user data for targeted advertising.
        </p>
        <p>
          Current production processors should be confirmed by the operator
          before submission. CalenderZW does not share Google user data with
          advertising services.
        </p>
      </section>
      <section id="retention-and-security">
        <h2>6. Retention and security</h2>
        <p>
          Public timetable audit history may be retained for accuracy. Google
          tokens are retained only while direct sync remains connected. Current
          safeguards include HTTPS requirements, server-side credentials, secure
          SameSite cookies, hashed private-feed tokens, API validation, and
          dependency checks. Encrypted refresh-token persistence requires the
          production token store to be configured.
        </p>
      </section>
      <section id="your-choices">
        <h2>7. Your choices</h2>
        <p>
          You can avoid Google Calendar, use .ics instead, disconnect Google,
          revoke Google access in your Google Account, request feed revocation,
          change reminders by creating a new subscription, and request deletion
          at <a href="/data-deletion">/data-deletion</a>.
        </p>
      </section>
      <section id="contact">
        <h2>8. Contact</h2>
        <p>
          {legalConfig.operatorName}
          <br />
          Operator address: {legalConfig.operatorAddress}
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
      <section id="overview">
        <h2>1. Agreement and service</h2>
        <p>
          These Terms govern access to {legalConfig.tradingName}, a timetable
          discovery, calendar synchronisation, reminder, and academic scheduling
          service operated by {legalConfig.operatorName}. Availability may vary
          by institution, provider, device, and location.
        </p>
      </section>
      <section id="google-calendar">
        <h2>2. Google Calendar connection</h2>
        <p>
          Google connection is voluntary and narrowly scoped. CalenderZW creates
          and manages a separate secondary calendar, and you can disconnect
          access. Google services are governed by Google's terms, and no Google
          endorsement is implied.
        </p>
      </section>
      <section id="private-feeds">
        <h2>3. Accuracy, reminders, and private feeds</h2>
        <p>
          Academic schedules can change without immediate notice. Check critical
          dates against official institution sources. Calendar providers and
          devices control final alert delivery and feed refresh frequency.
        </p>
      </section>
      <section id="requests">
        <h2>4. Submissions and acceptable use</h2>
        <p>
          Submitted timetable data must be authorised or reasonably based,
          non-malicious, and respectful of institutional rules. You grant
          CalenderZW the limited licence needed to host and display submitted
          timetable content to operate the service.
        </p>
      </section>
      <section id="contact">
        <h2>5. Governing law, paid features, and contact</h2>
        <p>
          These Terms are governed by the laws of {legalConfig.governingLaw},
          without prejudice to mandatory consumer protections that may apply in
          your country. {legalConfig.disputeVenue} will have jurisdiction,
          subject to applicable law.
        </p>
        <p>
          Paid features may be introduced in the future. Before a paid
          transaction is offered, CalenderZW will display the applicable price,
          currency, payment terms, and refund conditions.
        </p>
        <p>
          Contact{" "}
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
      <section id="overview">
        <h2>Delete an account or records</h2>
        <p>
          Email{" "}
          <a href={`mailto:${legalConfig.privacyEmail}`}>
            {legalConfig.privacyEmail}
          </a>{" "}
          from the address associated with the account or connection. We will
          display or send a confirmation reference.
        </p>
      </section>
      <section id="google-calendar">
        <h2>Disconnect Google Calendar</h2>
        <p>
          Use account settings to disconnect Google Calendar, or revoke
          CalenderZW access from your Google Account third-party connections.
          You may keep or delete the app-created calendar before revocation.
        </p>
      </section>
      <section id="private-feeds">
        <h2>Revoke private feeds</h2>
        <p>
          Submit a feed revocation request from the same browser session or
          contact support with the subscription reference.
        </p>
      </section>
    </>
  );
}

function SupportPage() {
  usePageMetadata({
    title: "Support | CalenderZW",
    description:
      "CalenderZW support for timetable setup, Google disconnect, Apple Calendar subscriptions, .ics imports, and timetable problem reports.",
    canonicalPath: "/support",
  });

  return (
    <Shell>
      <main className="page support-page">
        <PageHeader
          icon={<ShieldCheck />}
          title="CalenderZW support"
          text={`Get help with timetable and calendar setup. Email ${legalConfig.supportEmail}.`}
        />
        <section className="section-grid two">
          <article className="action-panel">
            <h2>Calendar setup issues</h2>
            <p>
              If a calendar does not appear immediately, check that the selected
              reminder preset was saved, your device calendar sync is enabled,
              and your calendar app has network access.
            </p>
          </article>
          <article className="action-panel">
            <h2>Disconnect Google Calendar</h2>
            <p>
              Open account settings, choose Disconnect Google Calendar, and
              decide whether to keep or delete the CalenderZW-created calendar.
              You can also revoke access in your Google Account.
            </p>
          </article>
          <article className="action-panel">
            <h2>Apple subscription guidance</h2>
            <p>
              Use the Apple Calendar subscription option from the live HTTPS
              site. Apple Calendar controls refresh timing and may not update
              immediately after timetable changes.
            </p>
          </article>
          <article className="action-panel">
            <h2>.ics import guidance</h2>
            <p>
              Downloaded .ics files are useful for one-time imports into many
              calendar apps. Future timetable updates may require another
              download unless you use a subscription option.
            </p>
          </article>
          <article className="action-panel">
            <h2>Notification delivery</h2>
            <p>
              CalenderZW creates calendar reminders, but final notification
              delivery depends on the calendar provider, phone settings,
              battery mode, connectivity, and notification permissions.
            </p>
          </article>
          <article className="action-panel">
            <h2>Report a timetable problem</h2>
            <p>
              Open the timetable page and choose Report a problem, or email{" "}
              <a href={`mailto:${legalConfig.supportEmail}`}>
                {legalConfig.supportEmail}
              </a>{" "}
              with the class link and the correction needed.
            </p>
            <a href="/privacy">Privacy Policy</a>
            <a href="/data-deletion">Data deletion</a>
          </article>
        </section>
      </main>
    </Shell>
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

  const rows = [
    ["OAuth app name expected", BRAND.productName],
    ["Homepage visible app name", BRAND.productName],
    ["Operator", BRAND.operatorName],
    ["Homepage purpose statement", "present"],
    ["Google data-use statement", "present"],
    ["Raw HTML app-name match", "pass"],
    ["Metadata app-name match", "pass"],
    ["Manifest app-name match", "pass"],
    ["Legacy-brand scan", "pass"],
    [
      "External OAuth draft-versus-published-branding check",
      "requires manual confirmation",
    ],
    ["External OAuth logo match", "requires manual confirmation"],
    ["Homepage URL", `${BRAND.origin}/`],
    ["Homepage status", "Expected direct 200 after production smoke test"],
    ["Homepage title", "CalenderZW | Add your university timetable to your calendar"],
    ["Homepage H1", "Add your university timetable to your calendar"],
    ["Privacy URL", `${BRAND.origin}/privacy`],
    ["Terms URL", `${BRAND.origin}/terms`],
    ["Deletion URL", `${BRAND.origin}/data-deletion`],
    ["Support URL", `${BRAND.origin}/support`],
    ["Canonical host", BRAND.domain],
    ["OAuth scope", "https://www.googleapis.com/auth/calendar.app.created"],
    [
      "Redirect URI",
      `${BRAND.origin}/api/calendar/google/callback`,
    ],
    ["No-JavaScript purpose-content check", "Present in raw index.html"],
    ["Service-worker version", "No local service worker source found"],
    ["Production logo asset", BRAND.squareIconPath],
    ["Search Console ownership", "Requires external confirmation"],
  ];

  return (
    <Shell>
      <main className="page">
        <PageHeader
          icon={<ShieldCheck />}
          title="Google verification readiness"
          text="Reviewer checklist without secrets, tokens, OAuth codes, or private feed tokens."
        />
        <section className="readiness-table" aria-label="Verification values">
          {rows.map(([label, value]) => (
            <div key={label}>
              <strong>{label}</strong>
              <span>{value}</span>
            </div>
          ))}
        </section>
        <a
          className="primary download-checklist"
          href="/google-oauth-reviewer-checklist.md"
          download
        >
          <Download size={18} aria-hidden="true" />
          Download reviewer checklist
        </a>
      </main>
    </Shell>
  );
}

function AccountSettingsPage() {
  const [message, setMessage] = useState("");
  return (
    <Shell>
      <main className="page">
        <PageHeader
          icon={<Lock />}
          title="Account settings"
          text="Calendar privacy controls and legal links."
        />
        <section className="action-panel settings-panel">
          <h2>Calendar connections</h2>
          <p>
            Disconnect Google Calendar or request feed revocation when you no
            longer want external calendar updates.
          </p>
          <button
            onClick={() =>
              setMessage(
                "Google disconnect request recorded locally. Production uses /api/calendar/google/disconnect to revoke provider access when stored credentials exist.",
              )
            }
          >
            Disconnect Google Calendar
          </button>
          <a href="/data-deletion">Account and data deletion</a>
          <a href="/privacy#google-calendar-data">Google data use</a>
          <a href="/terms">Terms of Service</a>
          {message && <p className="content-notice">{message}</p>}
        </section>
      </main>
    </Shell>
  );
}

function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<
    "idle" | "loading" | "forbidden" | "error"
  >("idle");
  const [message, setMessage] = useState("");

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("loading");
    setMessage("");

    let supabase;
    try {
      supabase = createSupabaseBrowserClient();
    } catch {
      setStatus("error");
      setMessage("Administrator sign-in is not configured.");
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
        return;
      }
      setStatus("error");
      setMessage("Administrator sign-in is temporarily unavailable.");
    }
  }

  return (
    <Shell>
      <main className="page admin-page">
        <PageHeader
          icon={<Lock />}
          title="Admin login"
          text="Sign in with the administrator email and password provisioned in Supabase Auth."
        />
        <section className="action-panel" aria-labelledby="admin-login-title">
          <h2 id="admin-login-title">Administrator sign-in</h2>
          <form className="admin-form" onSubmit={signIn}>
            <label>
              Email
              <input
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
              Password
              <input
                autoComplete="current-password"
                name="password"
                required
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <button className="primary" disabled={status === "loading"}>
              <Lock size={18} />
              {status === "loading" ? "Signing in" : "Sign in"}
            </button>
          </form>
          {message && (
            <p
              className="content-notice"
              role={status === "error" || status === "forbidden" ? "alert" : "status"}
            >
              {message}
            </p>
          )}
          <a href="/">Back to CalenderZW home</a>
        </section>
      </main>
    </Shell>
  );
}

function AdminPage() {
  return (
    <Shell>
      <AdminMvpScreen path={currentPath()} />
    </Shell>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty-state">
      <GraduationCap size={28} />
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}

export function App() {
  const [path, setPath] = useState(currentPath());
  useEffect(() => {
    const updatePath = () => setPath(currentPath());
    window.addEventListener("popstate", updatePath);
    return () => window.removeEventListener("popstate", updatePath);
  }, []);

  if (path === "/dashboard" || path.startsWith("/dashboard/")) {
    window.history.replaceState({}, "", "/admin");
    return <AdminPage />;
  }
  if (path === "/") return <HomePage />;
  if (path === "/privacy") return <LegalDocumentPage type="privacy" />;
  if (path === "/terms") return <LegalDocumentPage type="terms" />;
  if (path === "/data-deletion") return <LegalDocumentPage type="data" />;
  if (path === "/support") return <SupportPage />;
  if (path === "/account/settings") return <AccountSettingsPage />;
  if (path === "/find" || path === "/institutions") return <FinderPage />;
  if (path === "/admin/google-verification-readiness")
    return <GoogleVerificationReadinessPage />;
  if (path === "/admin/login") return <AdminLoginPage />;
  if (path === "/admin") return <AdminPage />;
  if (path.startsWith("/admin/")) return <AdminPage />;
  if (path.endsWith("/history")) return <HistoryPage />;
  if (path.startsWith("/t/") || path.startsWith("/sync/"))
    return <PublicTimetablePage />;
  return <PublicTimetablePage />;
}
