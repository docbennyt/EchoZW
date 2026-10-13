import { Check, ArrowRight, Minus, GraduationCap, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { BRAND } from "./config/brand";
import {
  MARKETING_STUDENT_PLANS,
  marketingAmountMinor,
  marketingDemoCheckoutHref,
  marketingPrice,
  readMarketingDemoSelection,
  type MarketingBillingPeriod,
  type MarketingStudentPlan,
} from "./domain/marketingPricing";

const SALES_PHONE = "+263777318411";
const SALES_HREF = "tel:" + SALES_PHONE;

function usePricingMount() {
  const [target, setTarget] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    let mount: HTMLDivElement | null = null;
    const sync = () => {
      const finalCta = document.querySelector<HTMLElement>(".czw-final-cta");
      const parent = finalCta?.parentElement;
      if (!finalCta || !parent) return;
      if (!mount) {
        mount = document.createElement("div");
        mount.className = "czw-pricing-mount";
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

function Feature({
  children,
  included = true,
}: {
  children: React.ReactNode;
  included?: boolean;
}) {
  return (
    <li className={included ? "czw-pricing-feature" : "czw-pricing-feature is-off"}>
      {included ? <Check size={17} aria-hidden="true" /> : <Minus size={17} aria-hidden="true" />}
      <span>{children}</span>
    </li>
  );
}

function StudentPlanCard({
  plan,
  billing,
}: {
  plan: MarketingStudentPlan;
  billing: MarketingBillingPeriod;
}) {
  const detail = MARKETING_STUDENT_PLANS[plan];
  const featured = plan === "complete";
  return (
    <article className={featured ? "czw-pricing-card is-popular" : "czw-pricing-card"}>
      {featured ? <div className="czw-pricing-ribbon">Most popular</div> : null}
      <div className="czw-pricing-card-intro">
        <h3>{detail.title}</h3>
        <p>{detail.description}</p>
      </div>
      <div className="czw-pricing-amount">
        <strong>{marketingPrice(marketingAmountMinor(plan, billing))}</strong>
        <span>{billing === "monthly" ? "/ month" : "/ academic year"}</span>
      </div>
      <p className="czw-pricing-billed">
        {billing === "monthly"
          ? "Monthly billing"
          : "Billed once for 2 semesters"}
      </p>
      <a
        className={featured ? "czw-pricing-action is-primary" : "czw-pricing-action"}
        href={marketingDemoCheckoutHref(plan, billing)}
      >
        View Paynow demo <ArrowRight size={17} aria-hidden="true" />
      </a>
      <div className="czw-pricing-card-divider" />
      <p className="czw-pricing-includes">What is included</p>
      <ul className="czw-pricing-features">
        <Feature>View your published class timetable</Feature>
        <Feature>Add classes to your existing calendar</Feature>
        <Feature>Published class timetable changes</Feature>
        <Feature included={detail.examUpdates}>
          {detail.examUpdates
            ? "Exam timetable and exam updates"
            : "Exam timetable and updates not included"}
        </Feature>
      </ul>
    </article>
  );
}

function InstitutionCard() {
  return (
    <article className="czw-pricing-card czw-pricing-institution">
      <div className="czw-pricing-card-intro">
        <h3>Institution</h3>
        <p>Bring coordinated timetables to your campus.</p>
      </div>
      <div className="czw-pricing-amount">
        <strong className="czw-pricing-custom">Custom</strong>
      </div>
      <p className="czw-pricing-billed">Pricing tailored to your institution</p>
      <a className="czw-pricing-action" href={SALES_HREF}>
        Contact Sales <ArrowRight size={17} aria-hidden="true" />
      </a>
      <div className="czw-pricing-card-divider" />
      <p className="czw-pricing-includes">Built for campus teams</p>
      <ul className="czw-pricing-features">
        <Feature>Institution-wide timetable rollout</Feature>
        <Feature>Student calendar subscriptions</Feature>
        <Feature>Class timetable updates</Feature>
        <Feature>Exam timetable support</Feature>
      </ul>
    </article>
  );
}

function MarketingPricingSection() {
  const [billing, setBilling] = useState<MarketingBillingPeriod>("monthly");

  return (
    <section className="czw-section czw-pricing-section" aria-labelledby="czw-pricing-title">
      <div className="czw-shell">
        <div className="czw-pricing-heading">
          <div>
            <span className="czw-kicker">Simple, student-first pricing</span>
            <h2 id="czw-pricing-title">One less thing to worry about.</h2>
            <p>Stay organised with your classes. Add exams when you need them.</p>
          </div>
          <div className="czw-pricing-switch-wrap">
            <div className="czw-pricing-switch" role="group" aria-label="Billing period">
              <button
                type="button"
                aria-pressed={billing === "monthly"}
                className={billing === "monthly" ? "is-active" : ""}
                onClick={() => setBilling("monthly")}
              >
                Monthly
              </button>
              <button
                type="button"
                aria-pressed={billing === "yearly"}
                className={billing === "yearly" ? "is-active" : ""}
                onClick={() => setBilling("yearly")}
              >
                Yearly <small>2 semesters</small>
              </button>
            </div>
            <span className="czw-pricing-announcement" role="status">
              {billing === "monthly" ? "Monthly prices shown." : "Academic-year prices shown; billed once for two semesters."}
            </span>
          </div>
        </div>

        <div className="czw-pricing-grid">
          <StudentPlanCard plan="essentials" billing={billing} />
          <StudentPlanCard plan="complete" billing={billing} />
          <InstitutionCard />
        </div>
        <p className="czw-pricing-demo-disclaimer">
          Payment links open a demonstration only. No money is collected or access activated.
          Yearly student prices equal 12 monthly payments, covering 2 semesters.
        </p>

        <aside className="czw-timely-offer" aria-label="Timely student offer">
          <div className="czw-timely-orbit" aria-hidden="true"><GraduationCap size={32} /></div>
          <div className="czw-timely-copy">
            <span className="czw-timely-eyebrow">More than a timetable</span>
            <h3>Meet Timely. Your university years, organised.</h3>
            <p>
              One student. Parts 1–4. Personalised Timely features, plus Nicolas,
              your human study coach for original writing guidance, research
              structure and responsible referencing.
            </p>
          </div>
          <div className="czw-timely-purchase">
            <strong>US$25 <span>one-time</span></strong>
            <span className="czw-timely-scope">Single-student Parts 1–4 offer · Enquire about availability</span>
            <a href={SALES_HREF} className="czw-timely-contact">
              Contact Sales <ArrowRight size={17} aria-hidden="true" />
            </a>
          </div>
        </aside>
      </div>
    </section>
  );
}

/** Kept as an export for existing entry-point compatibility. */
export function PilotOfferEnhancement() {
  const target = usePricingMount();
  return target ? createPortal(<MarketingPricingSection />, target) : null;
}

/**
 * Local, deliberately non-transactional preview. Paynow test mode is
 * merchant-only; this page does NOT represent a hosted Paynow checkout.
 */
export function PaynowDemoPage() {
  const selection = readMarketingDemoSelection(window.location.search);

  useEffect(() => {
    document.title = "Payment demonstration | CalenderZW";
  }, []);

  return (
    <main className="czw-paynow-demo-page">
      <div className="czw-paynow-demo-shell">
        <a href="/" className="czw-paynow-demo-brand" aria-label="CalenderZW home">
          <img src={BRAND.wordmarkPath} alt="CalenderZW" />
        </a>
        <div className="czw-paynow-demo-card">
          <div className="czw-paynow-demo-icon"><ShieldCheck size={27} aria-hidden="true" /></div>
          <span className="czw-kicker">Paynow checkout demonstration</span>
          <h1>Preview only. No payment will be taken.</h1>
          <p>
            This is a CalenderZW demonstration page, not a Paynow-hosted checkout.
            No real or test transaction will be created and no subscription is activated.
          </p>
          {selection ? (
            <div className="czw-paynow-demo-summary" aria-label="Selected plan">
              <div>
                <span>Selected plan</span>
                <strong>{MARKETING_STUDENT_PLANS[selection.plan].title}</strong>
              </div>
              <div>
                <span>Billing</span>
                <strong>{selection.billing === "monthly" ? "Monthly" : "Yearly · 2 semesters"}</strong>
              </div>
              <div>
                <span>Illustrative total</span>
                <strong>{marketingPrice(marketingAmountMinor(selection.plan, selection.billing))}</strong>
              </div>
            </div>
          ) : (
            <p className="czw-paynow-demo-error">No valid pricing plan was selected.</p>
          )}
          <a className="czw-pricing-action is-primary" href="/#pricing">
            Back to pricing <ArrowRight size={17} aria-hidden="true" />
          </a>
        </div>
      </div>
    </main>
  );
}
