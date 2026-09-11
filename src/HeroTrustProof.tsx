import { UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { fetchPublishedTimetables } from "./api/publicDiscovery";

function useHeroTarget() {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const update = () => {
      setTarget(document.querySelector<HTMLElement>(".czw-hero-copy-block"));
    };

    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return target;
}

export function HeroTrustProof() {
  const heroTarget = useHeroTarget();
  const [publishedCount, setPublishedCount] = useState<number | null>(null);

  useEffect(() => {
    let active = true;

    fetchPublishedTimetables()
      .then((result) => {
        if (active) setPublishedCount(result.timetables.length);
      })
      .catch(() => {
        if (active) setPublishedCount(null);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const hideLegacyProof = () => {
      document
        .querySelectorAll<HTMLElement>(".czw-pilot-proof")
        .forEach((node) => node.setAttribute("hidden", ""));
    };

    hideLegacyProof();
    const observer = new MutationObserver(hideLegacyProof);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  if (!heroTarget) return null;

  return createPortal(
    <div
      className="czw-hero-trust-proof"
      aria-label="CalenderZW HIT pilot proof"
    >
      <a
        className="czw-hit-identity"
        href="https://www.hit.ac.zw/"
        target="_blank"
        rel="noreferrer"
        aria-label="Harare Institute of Technology"
      >
        <img
          src="https://portal.hit.ac.zw/img/HITlogo.png"
          alt="Harare Institute of Technology logo"
        />
      </a>

      <div className="czw-community-avatar-stack" aria-hidden="true">
        {["CS", "SE", "IT"].map((label) => (
          <span className="czw-community-avatar" key={label}>
            <UserRound size={14} strokeWidth={2.1} />
            <small>{label}</small>
          </span>
        ))}
      </div>

      <div className="czw-hero-proof-copy">
        <strong>HIT pilot is live</strong>
        <span>
          {publishedCount === null
            ? "Published class timetables available"
            : `${publishedCount} published class ${publishedCount === 1 ? "timetable" : "timetables"} available`}
        </span>
      </div>
    </div>,
    heroTarget,
  );
}
