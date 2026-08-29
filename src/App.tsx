import { useEffect, useState } from "react";
import {
  Download,
  GraduationCap,
  History,
  Lock,
  Menu,
  ShieldCheck,
  X,
} from "lucide-react";
import { appConfig } from "./config/app";
import { BRAND } from "./config/brand";
import { legalConfig } from "./config/legal";
import { fetchAdminSession } from "./api/adminSession";
import { track } from "./analytics";
import { createClient as createSupabaseBrowserClient } from "./utils/supabase/client";
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
  const { title, description, canonicalPath, ogTitle, ogDescription, robots } =
    input;
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
  { label: "How it works", href: "/#how" },
  { label: "Calendar options", href: "/#options" },
  { label: "For class reps", href: "/#reps" },
  { label: "Privacy & trust", href: "/#trust" },
  { label: "Admin", href: "/admin" },
] as const;

function Shell({
  children,
  footerVariant = "global",
}: {
  children: React.ReactNode;
  footerVariant?: "global" | "compact";
}) {
  return (
    <div className="app-shell">
      <GlobalHeader />
      {children}
      {footerVariant === "compact" ? <CompactFooter /> : <GlobalFooter />}
    </div>
  );
}

function GlobalHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const path = currentPath();

  return (
    <header className="site-header" id="header" data-component="GlobalHeader">
      <nav className="nav shell" aria-label="Primary navigation">
        <a href="/#top" className="brand" aria-label="CalenderZW home">
          <span className="mark" aria-hidden="true">
            <i></i>
            <i></i>
            <i></i>
            <i></i>
          </span>
          <span className="brand-name">
            Calender<span>ZW</span>
          </span>
        </a>
        <div className="nav-links">
          <a href="/#how">How it works</a>
          <a href="/#options">Calendar options</a>
          <a href="/#reps">For class reps</a>
          <a href="/#trust">Privacy &amp; trust</a>
        </div>
        <button
          className="menu-trigger menu"
          type="button"
          aria-label={
            menuOpen ? "Close navigation menu" : "Open navigation menu"
          }
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
        <div
          id="global-navigation"
          className={`nav-links ${menuOpen ? "open" : ""}`}
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
        </div>
        <a
          className="btn btn-primary nav-cta"
          href="/find"
          data-event="find_timetable_clicked"
        >
          Find timetable <span aria-hidden="true">→</span>
        </a>
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
      <div className="shell">
        <div className="footer-grid">
          <div className="footer-brand">
            <a href="/#top" className="brand" aria-label="CalenderZW home">
              <span className="mark" aria-hidden="true">
                <i></i>
                <i></i>
                <i></i>
                <i></i>
              </span>
              <span className="brand-name">
                Calender<span>ZW</span>
              </span>
            </a>
            <p>
              Operated by {appConfig.companyName}.<br />
              Built in Zimbabwe for university life.
            </p>
          </div>
          <div className="footer-links">
            <div className="footer-col">
              <b>Product</b>
              <a href="/find">Find timetable</a>
              <a href="/#how">How it works</a>
              <a href="/#options">Calendar options</a>
            </div>
            <div className="footer-col">
              <b>For students</b>
              <a href="/#reps">Class reps</a>
              <a href="/support">Support</a>
            </div>
            <div className="footer-col">
              <b>Legal</b>
              <a href="/privacy">Privacy</a>
              <a href="/terms">Terms</a>
              <a href="/data-deletion">Data deletion</a>
            </div>
          </div>
        </div>
        <div className="copyright">
          <span>
            © {currentYear} {appConfig.productName}. Operated by{" "}
            {appConfig.companyName}.
          </span>
          <span>
            {appConfig.productName} is the product. {appConfig.companyName} is
            the operator.
          </span>
        </div>
      </div>
    </footer>
  );
}

function PublicTimetablePage() {
  return (
    <Shell footerVariant="compact">
      <PublicTimetableMvpScreen slug={currentPath().replace(/^\/t\//, "")} />
    </Shell>
  );
}

function CompactFooter() {
  return (
    <footer
      className="site-footer compact-site-footer"
      data-component="CompactFooter"
    >
      <div className="compact-footer-inner">
        <strong>CalenderZW · Operated by aiDo</strong>
        <nav aria-label="Timetable footer">
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href="/support">Report a timetable problem</a>
        </nav>
      </div>
    </footer>
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
  const [currentStep, setCurrentStep] = useState(1);

  usePageMetadata({
    title: "CalenderZW | Add your university timetable to your calendar",
    description:
      "Find a verified student timetable, choose useful reminders, and add lectures to Google Calendar, Apple Calendar, Outlook, or another calendar application.",
    canonicalPath: "/",
    ogTitle: "CalenderZW",
    ogDescription: "Add your university timetable to your calendar.",
  });

  return (
    <div className="app-shell">
      <GlobalHeader />
      <a href="#main" className="skip">
        Skip to content
      </a>
      <main id="main">
        <section className="hero" id="top">
          <div className="hero-grid shell">
            <div>
              <span className="eyebrow">Your timetable, already organised</span>
              <h1>
                Your university timetable,{" "}
                <span>already in your calendar.</span>
              </h1>
              <p className="hero-copy">
                CalenderZW helps students find a published class timetable,
                choose useful reminders, and add lectures to the calendar they
                already use.
              </p>
              <div className="hero-actions">
                <a
                  className="btn btn-primary"
                  href="https://calender.aido.co.zw/"
                  data-event="find_timetable_clicked"
                >
                  Find my timetable{" "}
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </a>
                <a
                  className="btn btn-secondary"
                  href="#how"
                  data-event="how_it_works_clicked"
                >
                  See how it works <span aria-hidden="true">↓</span>
                </a>
              </div>
              <p className="micro">
                <span>No app required</span>
                <i></i>
                <span>No student account needed</span>
              </p>
            </div>
            <div
              className="product-scene"
              aria-label="A CalenderZW timetable being prepared and added to a calendar"
            >
              <div className="scene-halo"></div>
              <div className="path"></div>
              <div className="flow-card reminder">
                <div className="flow-title">
                  <i>◷</i>
                  <span>Reminder preset</span>
                </div>
                <small>Prepared</small>
                <div className="chips">
                  <span>24h</span>
                  <span>30m</span>
                </div>
              </div>
              <div className="phone">
                <div className="phone-screen">
                  <div className="phone-top">
                    <i></i>
                  </div>
                  <div className="phone-head">
                    <span>
                      <small>CS 1.1 · WEEK 4</small>
                      <b>Monday</b>
                    </span>
                    <span className="verified">Published</span>
                  </div>
                  <div className="schedule">
                    <div className="lecture">
                      <time>08:00</time>
                      <span>
                        <b>Operating Systems</b>
                        <small>N110 · 1h 30m</small>
                      </span>
                    </div>
                    <div className="lecture">
                      <time>10:15</time>
                      <span>
                        <b>Discrete Mathematics</b>
                        <small>E/HALL · 1h 30m</small>
                      </span>
                    </div>
                    <div className="lecture">
                      <time>14:00</time>
                      <span>
                        <b>Technopreneurship I</b>
                        <small>N109 · 1h</small>
                      </span>
                    </div>
                  </div>
                  <div className="add-bar">
                    <span>Add timetable to calendar</span>
                    <span aria-hidden="true">→</span>
                  </div>
                </div>
              </div>
              <div className="flow-card result">
                <div className="flow-title">
                  <i>✓</i>
                  <span>Added to calendar</span>
                </div>
                <small>3 lectures · reminders ready</small>
              </div>
            </div>
          </div>
        </section>
        <section className="trust-strip" aria-label="Product principles">
          <div className="trust-inner shell">
            <span>
              <b>Built in Zimbabwe</b> for university life
            </span>
            <i></i>
            <span>One class link</span>
            <i></i>
            <span>The calendar you already use</span>
          </div>
        </section>

        <section className="section stage" aria-labelledby="problem-title">
          <div className="recognition shell reveal-group">
            <div
              className="clutter"
              aria-label="Common ways students receive timetable information"
            >
              <div className="message m1">
                “Does anyone know where tomorrow’s lecture is?”
                <small>Class group · 19:42</small>
              </div>
              <div className="message m2">
                “Timetable updated again 👆”<small>Class rep · 20:08</small>
              </div>
              <div className="message m3">
                “Please resend the PDF.”<small>3 unread replies</small>
              </div>
              <div className="pdf">
                <b>LECTURE TIMETABLE</b>
                <i></i>
                <i></i>
                <i></i>
                <i></i>
                <i></i>
              </div>
            </div>
            <div className="clean-note">
              <span className="kicker">
                Keep the conversation. Lose the searching.
              </span>
              <h2 id="problem-title">
                Keep WhatsApp for conversation.{" "}
                <strong>Let your calendar remember the timetable.</strong>
              </h2>
              <p className="small-note">
                CalenderZW turns a published class schedule into something your
                phone already knows how to use.
              </p>
            </div>
          </div>
        </section>

        <section className="section" id="how" aria-labelledby="how-title">
          <div className="shell">
            <div className="section-head reveal-group">
              <span className="kicker">Three clear steps</span>
              <h2 id="how-title">From class link to calendar in minutes.</h2>
              <p>
                No account maze. No new daily habit. Just find, prepare and add.
              </p>
            </div>
            <div className="steps-shell reveal-group">
              <div
                className="step-list"
                role="tablist"
                aria-label="How CalenderZW works"
              >
                <button
                  className="step-button"
                  role="tab"
                  aria-selected={currentStep === 1}
                  aria-controls="demo-1"
                  id="step-1"
                  onClick={() => setCurrentStep(1)}
                >
                  <span className="num">01</span>
                  <span>
                    <b>Find your class</b>
                    <small>
                      Open a shared class link or search by institution,
                      programme and group.
                    </small>
                  </span>
                </button>
                <button
                  className="step-button"
                  role="tab"
                  aria-selected={currentStep === 2}
                  aria-controls="demo-2"
                  id="step-2"
                  onClick={() => setCurrentStep(2)}
                >
                  <span className="num">02</span>
                  <span>
                    <b>Choose your reminders</b>
                    <small>
                      Pick Prepared, On time, Commuter or a timing that suits
                      you.
                    </small>
                  </span>
                </button>
                <button
                  className="step-button"
                  role="tab"
                  aria-selected={currentStep === 3}
                  aria-controls="demo-3"
                  id="step-3"
                  onClick={() => setCurrentStep(3)}
                >
                  <span className="num">03</span>
                  <span>
                    <b>Add it to your calendar</b>
                    <small>
                      Use the supported option that works best on your phone.
                    </small>
                  </span>
                </button>
              </div>
              <div className="demo-panel">
                <div
                  className={`demo ${currentStep === 1 ? "active" : ""}`}
                  id="demo-1"
                  role="tabpanel"
                  aria-labelledby="step-1"
                >
                  <div className="finder">
                    <span className="mock-label">Institution</span>
                    <div className="field">
                      <span>Choose your university</span>
                      <b>⌄</b>
                    </div>
                    <span className="mock-label">Programme & class group</span>
                    <div className="field">
                      <span>Computer Science · 1.1</span>
                      <b>⌄</b>
                    </div>
                    <div className="add-bar">
                      <span>View published timetable</span>
                      <span>→</span>
                    </div>
                  </div>
                </div>
                <div
                  className={`demo ${currentStep === 2 ? "active" : ""}`}
                  id="demo-2"
                  role="tabpanel"
                  aria-labelledby="step-2"
                >
                  <div className="finder">
                    <span className="mock-label">Reminder preset</span>
                    <div className="presets">
                      <div className="preset active">
                        <span>
                          <b>Prepared</b>
                          <br />
                          <small>24 hours + 30 minutes</small>
                        </span>
                        <i>✓</i>
                      </div>
                      <div className="preset">
                        <span>
                          <b>On time</b>
                          <br />
                          <small>30 minutes</small>
                        </span>
                        <i></i>
                      </div>
                      <div className="preset">
                        <span>
                          <b>Commuter</b>
                          <br />
                          <small>2 hours + 30 minutes</small>
                        </span>
                        <i></i>
                      </div>
                    </div>
                  </div>
                </div>
                <div
                  className={`demo ${currentStep === 3 ? "active" : ""}`}
                  id="demo-3"
                  role="tabpanel"
                  aria-labelledby="step-3"
                >
                  <div className="cal-result">
                    <span className="result-date">MONDAY · 08:00</span>
                    <div className="result-event">
                      <time>Lecture · 1h 30m</time>
                      <b>Operating Systems</b>
                      <small>Venue N110 · Reminder 30m before</small>
                    </div>
                    <div className="ready">
                      <i>✓</i>
                      <span>Calendar event ready</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="proof-stage" aria-labelledby="proof-title">
          <div className="proof-grid shell reveal-group">
            <div className="proof-copy">
              <span className="kicker">Set it once</span>
              <h2 id="proof-title">Let your calendar do the remembering.</h2>
              <p>
                A published timetable becomes readable events with the reminders
                you chose. The timetable stays the source; your calendar becomes
                the memory.
              </p>
            </div>
            <div className="sequence">
              <div className="sequence-head">
                <small>Published timetable · Week 4</small>
                <span className="status">Ready</span>
              </div>
              <div className="event-row">
                <time>
                  MON
                  <br />
                  08:00
                </time>
                <span>
                  <b>Technopreneurship I</b>
                  <small>E/HALL</small>
                </span>
                <span className="remind">
                  <i>24h</i>
                  <i>30m</i>
                </span>
              </div>
              <div className="event-row">
                <time>
                  TUE
                  <br />
                  14:00
                </time>
                <span>
                  <b>Operating Systems</b>
                  <small>N109</small>
                </span>
                <span className="remind">
                  <i>24h</i>
                  <i>30m</i>
                </span>
              </div>
              <div className="event-row">
                <time>
                  WED
                  <br />
                  10:15
                </time>
                <span>
                  <b>Discrete Mathematics</b>
                  <small>N110</small>
                </span>
                <span className="remind">
                  <i>24h</i>
                  <i>30m</i>
                </span>
              </div>
              <div className="sequence-foot">
                <span>3 events prepared</span>
                <span>✓ Timetable ready</span>
              </div>
            </div>
          </div>
        </section>

        <section className="section" aria-labelledby="habit-title">
          <div className="habit shell reveal-group">
            <div className="habit-copy">
              <span className="kicker">Why not another app?</span>
              <h2 className="quote" id="habit-title">
                Your timetable shouldn’t need <em>another daily habit.</em>
              </h2>
              <p>
                CalenderZW works with the calendar already built into your
                routine.
              </p>
            </div>
            <div className="benefit-lines">
              <div className="benefit-line">
                <i>01</i>
                <span>
                  <b>No app install for the core flow</b>
                  <small>Open it from a browser or class link.</small>
                </span>
              </div>
              <div className="benefit-line">
                <i>02</i>
                <span>
                  <b>No new student account</b>
                  <small>Basic timetable access stays low-friction.</small>
                </span>
              </div>
              <div className="benefit-line">
                <i>03</i>
                <span>
                  <b>One link for the class</b>
                  <small>
                    A rep can share the same published schedule with everyone.
                  </small>
                </span>
              </div>
              <div className="benefit-line">
                <i>04</i>
                <span>
                  <b>Calendar-native reminders</b>
                  <small>Your existing calendar handles the alert.</small>
                </span>
              </div>
            </div>
          </div>
        </section>

        <section
          className="section stage"
          id="options"
          aria-labelledby="options-title"
        >
          <div className="shell">
            <div className="section-head reveal-group">
              <span className="kicker">Calendar options</span>
              <h2 id="options-title">
                Use the method your device understands.
              </h2>
              <p>
                CalenderZW presents supported choices in plain language and
                keeps technical setup out of the way.
              </p>
            </div>
            <div className="options-wrap reveal-group">
              <article className="option">
                <span className="option-icon">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    aria-hidden="true"
                  >
                    <rect x="3" y="5" width="18" height="16" rx="2" />
                    <path d="M16 3v4M8 3v4M3 10h18" />
                  </svg>
                </span>
                <span>
                  <b>Apple Calendar</b>
                  <p>
                    Subscription-friendly where supported by your device and
                    timetable.
                  </p>
                </span>
              </article>
              <article className="option">
                <span className="option-icon">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    aria-hidden="true"
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <path d="M14 2v6h6M8 13h8M8 17h6" />
                  </svg>
                </span>
                <span>
                  <b>Calendar file (.ics)</b>
                  <p>
                    Compatible with many calendar apps and useful for a
                    straightforward import.
                  </p>
                </span>
              </article>
              <article className="option">
                <span className="option-icon">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    aria-hidden="true"
                  >
                    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
                    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
                  </svg>
                </span>
                <span>
                  <b>Subscription link</b>
                  <p>
                    Stay connected to published timetable changes where
                    subscriptions are supported.
                  </p>
                </span>
              </article>
              <article className="option">
                <span className="option-icon">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    aria-hidden="true"
                  >
                    <path d="M4 5h16v14H4zM8 3v4M16 3v4M4 9h16" />
                  </svg>
                </span>
                <span>
                  <b>Google Calendar</b>
                  <p>
                    Direct CalenderZW connection is not presented as ready yet.
                  </p>
                  <span className="coming">Coming later</span>
                </span>
              </article>
            </div>
          </div>
        </section>

        <section className="section" id="trust" aria-labelledby="trust-title">
          <div className="trust-layout shell reveal-group">
            <div>
              <div className="section-head">
                <span className="kicker">Know what you’re looking at</span>
                <h2 id="trust-title">
                  Clear timetable context, without invented trust.
                </h2>
                <p>
                  Students should be able to see when a timetable was published,
                  when it changed, and where to report a problem. Verification
                  labels appear only when the product can support them.
                </p>
              </div>
              <div className="trust-points">
                <div className="trust-point">
                  <i>✓</i>
                  <span>
                    <b>Visible status</b>
                    <p>Published status is shown clearly on the timetable.</p>
                  </span>
                </div>
                <div className="trust-point">
                  <i>↻</i>
                  <span>
                    <b>Useful update context</b>
                    <p>
                      Changes can be surfaced with an updated time where
                      available.
                    </p>
                  </span>
                </div>
                <div className="trust-point">
                  <i>!</i>
                  <span>
                    <b>A path to correct errors</b>
                    <p>
                      Support remains visible when timetable details need
                      attention.
                    </p>
                  </span>
                </div>
              </div>
            </div>
            <div className="trust-card">
              <div className="trust-card-head">
                <span>
                  <small>CLASS TIMETABLE</small>
                  <b>BTech Computer Science · 1.1</b>
                </span>
                <span className="trust-state">Published</span>
              </div>
              <div className="update">
                <span className="kicker">Latest change</span>
                <div className="change">
                  <span>
                    <b>Operating Systems</b>
                    <small>Tuesday · 14:00</small>
                  </span>
                  <span>
                    <span className="venue-old">N109</span>{" "}
                    <span aria-hidden="true">→</span>{" "}
                    <span className="venue-new">N205</span>
                  </span>
                </div>
              </div>
              <div className="trust-meta">
                <span>Updated recently</span>
                <a href="https://calender.aido.co.zw/support">
                  Report a problem ↗
                </a>
              </div>
            </div>
          </div>
        </section>

        <section className="section conditions" aria-labelledby="quality-title">
          <div className="shell">
            <div className="section-head center reveal-group">
              <span className="kicker">Built for real student conditions</span>
              <h2 id="quality-title">
                Product quality that holds up on an ordinary phone.
              </h2>
            </div>
            <div className="quality-grid reveal-group">
              <article className="quality">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  aria-hidden="true"
                >
                  <path d="M13 2L3 14h9l-1 8 10-12h-9z" />
                </svg>
                <b>Fast on mobile data</b>
                <small>No giant video or heavy image dependency.</small>
              </article>
              <article className="quality">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  aria-hidden="true"
                >
                  <rect x="6" y="2" width="12" height="20" rx="2" />
                  <path d="M10 18h4" />
                </svg>
                <b>Small-screen readable</b>
                <small>Clear type and deliberate 20px gutters.</small>
              </article>
              <article className="quality">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  aria-hidden="true"
                >
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                  <path d="M19 8l2 2-4 4" />
                </svg>
                <b>No basic-flow account</b>
                <small>Find and view before being asked for commitment.</small>
              </article>
              <article className="quality">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  aria-hidden="true"
                >
                  <path d="M4 17l6-6 4 4 6-8" />
                  <path d="M20 7h-6" />
                </svg>
                <b>Keyboard friendly</b>
                <small>Visible focus and semantic controls.</small>
              </article>
              <article className="quality">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  aria-hidden="true"
                >
                  <path d="M12 3a9 9 0 1 0 9 9" />
                  <path d="M12 7v5l3 2" />
                </svg>
                <b>Reduced motion</b>
                <small>The final product state remains understandable.</small>
              </article>
            </div>
          </div>
        </section>

        <section className="rep-section" id="reps">
          <div className="rep-card shell reveal-group">
            <div>
              <span className="kicker">For class representatives</span>
              <h2>Your class doesn’t have a timetable here yet?</h2>
              <p>
                Class representatives can help keep one class schedule accurate,
                published and easy to share.
              </p>
            </div>
            <a
              className="btn btn-primary"
              href="https://calender.aido.co.zw/admin/login"
              data-event="class_rep_cta_clicked"
            >
              Set up my class <span aria-hidden="true">→</span>
            </a>
          </div>
        </section>

        <section className="share" aria-labelledby="share-title">
          <div className="share-grid shell reveal-group">
            <div className="whatsapp">
              <div className="wa-head">
                <span className="wa-avatar">CS</span>
                <span>
                  <b>Computer Science 1.1</b>
                  <small>Class group</small>
                </span>
              </div>
              <div className="wa-msg">
                CS 1.1 timetable is live ✅<br />
                <br />
                View your timetable and add it to your calendar:
                <a href="https://calender.aido.co.zw/">
                  calender.aido.co.zw/t/...
                </a>
                <small>No app needed · 10:42</small>
              </div>
            </div>
            <div className="share-copy">
              <span className="kicker">Made to move through the class</span>
              <h2 id="share-title">
                One useful link. Everyone keeps their own calendar.
              </h2>
              <p>
                WhatsApp remains the distribution channel. CalenderZW gives the
                timetable a cleaner place to live.
              </p>
              <div className="distribution">
                <span>Class rep</span>
                <i>→</i>
                <span>WhatsApp group</span>
                <i>→</i>
                <span>Classmates’ calendars</span>
              </div>
            </div>
          </div>
        </section>

        <section className="section future" aria-labelledby="future-title">
          <div className="shell reveal-group">
            <span className="kicker">Focused now, useful later</span>
            <h2 id="future-title">
              Timetables today.
              <br />
              More of your academic schedule tomorrow.
            </h2>
            <p className="section-copy" style={{ marginInline: "auto" }}>
              Future ideas stay separate from what CalenderZW can do now.
            </p>
            <div className="future-chips">
              <span>Assignments</span>
              <span>Tests</span>
              <span>Exams</span>
              <span>Academic reminders</span>
            </div>
          </div>
        </section>

        <section className="privacy-band" aria-label="Privacy and control">
          <div className="privacy-inner shell">
            <div className="privacy-copy">
              <b>Privacy stays understandable.</b>
              <p>
                No student account is required for core timetable access.
                Calendar connections are optional.
              </p>
            </div>
            <nav className="legal-links" aria-label="Legal and support">
              <a href="https://calender.aido.co.zw/privacy">Privacy</a>
              <a href="https://calender.aido.co.zw/terms">Terms</a>
              <a href="https://calender.aido.co.zw/data-deletion">
                Data deletion
              </a>
              <a href="https://calender.aido.co.zw/support">Support</a>
            </nav>
          </div>
        </section>

        <section className="final-cta section" aria-labelledby="final-title">
          <div className="shell reveal-group">
            <span className="kicker">Find your class</span>
            <h2 id="final-title">Let your calendar handle the rest.</h2>
            <p>
              Your timetable is probably the last thing you should have to
              remember.
            </p>
            <div className="final-actions">
              <a
                className="btn btn-primary"
                href="https://calender.aido.co.zw/"
                data-event="find_timetable_clicked"
              >
                Find my timetable <span>→</span>
              </a>
              <a
                className="btn btn-secondary"
                href="https://calender.aido.co.zw/admin/login"
                data-event="class_rep_cta_clicked"
              >
                Set up my class
              </a>
            </div>
            <small className="free">Free for students.</small>
          </div>
        </section>
      </main>
      <GlobalFooter />
    </div>
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
          feeds, Google Calendar connection, downloads, and support services for{" "}
          {legalConfig.tradingName}, operated by {legalConfig.operatorName} from{" "}
          {legalConfig.publicAppUrl}.
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
              delivery depends on the calendar provider, phone settings, battery
              mode, connectivity, and notification permissions.
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
    [
      "Homepage title",
      "CalenderZW | Add your university timetable to your calendar",
    ],
    ["Homepage H1", "Add your university timetable to your calendar"],
    ["Privacy URL", `${BRAND.origin}/privacy`],
    ["Terms URL", `${BRAND.origin}/terms`],
    ["Deletion URL", `${BRAND.origin}/data-deletion`],
    ["Support URL", `${BRAND.origin}/support`],
    ["Canonical host", BRAND.domain],
    ["OAuth scope", "https://www.googleapis.com/auth/calendar.app.created"],
    ["Redirect URI", `${BRAND.origin}/api/calendar/google/callback`],
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
              role={
                status === "error" || status === "forbidden"
                  ? "alert"
                  : "status"
              }
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
