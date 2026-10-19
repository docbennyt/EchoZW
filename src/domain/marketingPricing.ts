/**
 * Marketing-only pricing data. No value here grants an entitlement, creates a
 * payment, or changes the existing Pesepay-backed billing contract.
 */
export type MarketingBillingPeriod = "monthly" | "yearly";
export type MarketingStudentPlan = "essentials" | "complete";

export const MARKETING_YEAR_MONTHS = 12;

export const MARKETING_STUDENT_PLANS = {
  essentials: {
    title: "Essentials",
    description: "Stay on top of your classes.",
    monthlyAmountMinor: 50,
    examUpdates: false,
  },
  complete: {
    title: "Complete",
    description: "Classes and exams in one place.",
    monthlyAmountMinor: 100,
    examUpdates: true,
  },
} as const;

export function marketingAmountMinor(
  plan: MarketingStudentPlan,
  billing: MarketingBillingPeriod,
): number {
  const monthly = MARKETING_STUDENT_PLANS[plan].monthlyAmountMinor;
  return billing === "yearly" ? monthly * MARKETING_YEAR_MONTHS : monthly;
}

export function marketingPrice(amountMinor: number): string {
  return "US$" + (amountMinor / 100).toFixed(2).replace(/\.00$/, "");
}

export function marketingDemoCheckoutHref(
  plan: MarketingStudentPlan,
  billing: MarketingBillingPeriod,
): string {
  return "/paynow-demo?plan=" + plan + "&billing=" + billing;
}

export function readMarketingDemoSelection(search: string): {
  plan: MarketingStudentPlan;
  billing: MarketingBillingPeriod;
} | null {
  const query = new URLSearchParams(search);
  const plan = query.get("plan");
  const billing = query.get("billing");
  if (
    (plan !== "essentials" && plan !== "complete") ||
    (billing !== "monthly" && billing !== "yearly")
  ) {
    return null;
  }
  return { plan, billing };
}
