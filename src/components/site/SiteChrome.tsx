import { ArrowRight, Menu, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { legalConfig } from "../../config/legal";

const currentYear = new Date().getFullYear();

const publicNavigation = [
  { label: "How it works", href: "/#how" },
  { label: "Calendar options", href: "/#options" },
  { label: "For class reps", href: "/#reps" },
  { label: "Privacy & trust", href: "/#trust" },
] as const;

export function BrandLockup() {
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

export function GlobalHeader({ transparent = false }: { transparent?: boolean }) {
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
          aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={menuOpen}
          aria-controls="czw-public-navigation"
          onClick={() => setMenuOpen((value) => !value)}
        >
          {menuOpen ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
        </button>
      </div>
    </header>
  );
}

export function GlobalFooter({ compact = false }: { compact?: boolean }) {
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
                Student timetable and calendar synchronisation, built for university life
                in Zimbabwe.
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

export function PublicShell({
  children,
  compactFooter = false,
  className = "",
}: {
  children: ReactNode;
  compactFooter?: boolean;
  className?: string;
}) {
  return (
    <div className={`czw-app-shell${className ? ` ${className}` : ""}`}>
      <GlobalHeader />
      {children}
      <GlobalFooter compact={compactFooter} />
    </div>
  );
}
