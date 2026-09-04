import { Check } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { track } from "./analytics";

const SHARE_SOURCES = new Set([
  "class_share",
  "class_rep",
  "onboarding_success",
]);

function acquisitionSource() {
  if (typeof window === "undefined") return "direct";
  const raw = new URLSearchParams(window.location.search).get("src")?.trim();
  return raw && SHARE_SOURCES.has(raw) ? raw : "direct";
}

function usePilotOfferMount() {
  const [target, setTarget] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    let mount: HTMLDivElement | null = null;

    const sync = () => {
      const finalCta = document.querySelector<HTMLElement>(".czw-final-cta");
      const parent = finalCta?.parentElement;
      if (!finalCta || !parent) return;

      if (!mount) {
        mount = document.createElement("div");
        mount.className = "czw-pilot-offer-mount";
      }
      if (!mount.isConnected) parent.insertBefore(mount, finalCta);
      setTarget(mount);
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      mount?.remove();
    };
  }, []);

  return target;
}

function PilotOffer() {
  const sectionRef = useRef<HTMLElement | null>(null);
  const trackedView = useRef(false);
  const source = useMemo(() => acquisitionSource(), []);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section || trackedView.current) return;

    const recordView = () => {
      if (trackedView.current) return;
      trackedView.current = true;
      track("pilot_offer_viewed", { source, path: window.location.pathname });
      track("future_price_viewed", { source, path: window.location.pathname });
    };

    if (!("IntersectionObserver" in window)) {
      recordView();
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          recordView();
          observer.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, [source]);

  return (
    <section
      ref={sectionRef}
      className="czw-section czw-pilot-offer-section"
      aria-labelledby="czw-pilot-offer-title"
    >
      <div className="czw-shell">
        <div className="czw-pilot-offer-card">
          <div className="czw-pilot-offer-copy">
            <span className="czw-kicker">HIT Undergraduate Pilot</span>
            <h2 id="czw-pilot-offer-title">
              Free through 30 September 2026.
            </h2>
            <p>
              We&apos;re piloting CalenderZW with HIT undergraduates. Find your
              class, add it to your calendar and use CalenderZW at no charge
              during the pilot.
            </p>
            <ul className="czw-pilot-benefits">
              <li>
                <Check size={17} aria-hidden="true" />
                <span>View your published class timetable</span>
              </li>
              <li>
                <Check size={17} aria-hidden="true" />
                <span>See tomorrow and your next class quickly</span>
              </li>
              <li>
                <Check size={17} aria-hidden="true" />
                <span>Use supported calendar options and reminders</span>
              </li>
            </ul>
            <a
              className="czw-button czw-button-primary czw-pilot-cta"
              href="/find"
              onClick={() =>
                track("pilot_cta_clicked", {
                  source,
                  path: window.location.pathname,
                })
              }
            >
              Find my timetable — free
            </a>
            <small>No payment method needed during the pilot.</small>
          </div>

          <aside className="czw-pilot-price" aria-label="Pilot pricing">
            <span>HIT pilot price</span>
            <strong>
              US$0 <small>through 30 Sep</small>
            </strong>
            <div className="czw-pilot-price-divider" />
            <span>Planned after pilot</span>
            <h3>US$3 / semester</h3>
            <p>
              Planned founding-student price for paid launch. This is the
              current pricing hypothesis, not a payment request today.
            </p>
            <p className="czw-pilot-payment-note">
              Local payment options planned for paid launch.
            </p>
          </aside>
        </div>
      </div>
    </section>
  );
}

export function PilotOfferEnhancement() {
  const target = usePilotOfferMount();
  return target ? createPortal(<PilotOffer />, target) : null;
}