import { describe, expect, it } from "vitest";
import {
  MARKETING_STUDENT_PLANS,
  MARKETING_YEAR_MONTHS,
  marketingAmountMinor,
  marketingDemoCheckoutHref,
  marketingPrice,
  readMarketingDemoSelection,
} from "../src/domain/marketingPricing";

describe("CZW marketing price catalogue", () => {
  it("sets the agreed monthly tiers and distinguishes exam updates", () => {
    expect(MARKETING_STUDENT_PLANS.essentials.monthlyAmountMinor).toBe(50);
    expect(MARKETING_STUDENT_PLANS.complete.monthlyAmountMinor).toBe(100);
    expect(MARKETING_STUDENT_PLANS.essentials.examUpdates).toBe(false);
    expect(MARKETING_STUDENT_PLANS.complete.examUpdates).toBe(true);
  });

  it("uses 12 monthly equivalents for each two-semester yearly quote", () => {
    expect(MARKETING_YEAR_MONTHS).toBe(12);
    expect(marketingAmountMinor("essentials", "yearly")).toBe(600);
    expect(marketingAmountMinor("complete", "yearly")).toBe(1200);
    expect(marketingPrice(marketingAmountMinor("essentials", "monthly"))).toBe("US$0.50");
    expect(marketingPrice(marketingAmountMinor("complete", "monthly"))).toBe("US$1");
  });

  it("keeps demo URLs local and rejects unknown or forged selections", () => {
    expect(marketingDemoCheckoutHref("complete", "yearly")).toBe(
      "/paynow-demo?plan=complete&billing=yearly",
    );
    expect(readMarketingDemoSelection("?plan=complete&billing=yearly")).toEqual({
      plan: "complete",
      billing: "yearly",
    });
    expect(readMarketingDemoSelection("?plan=institution&billing=yearly")).toBeNull();
    expect(readMarketingDemoSelection("?plan=complete&billing=weekly")).toBeNull();
  });
});
