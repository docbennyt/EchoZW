// @vitest-environment node
import { describe, expect, it } from "vitest";
import { academicPauseDeliveryNotice } from "../src/domain/academicPauseDeliveryNotice";

describe("academic pause subscriber delivery feedback", () => {
  it("does not promise Google delivery when the backend skipped it", () => {
    expect(
      academicPauseDeliveryNotice({
        attempted: 0,
        succeeded: 0,
        failed: 0,
        skipped: true,
      }),
    ).toBe(
      "Google Calendar delivery is paused. Subscriber updates have not been confirmed.",
    );
  });
  it("distinguishes queued work from completed delivery", () => {
    expect(academicPauseDeliveryNotice({ queued: true })).toBe(
      "Google Calendar updates are queued. Delivery is pending.",
    );
    expect(
      academicPauseDeliveryNotice({ attempted: 2, succeeded: 2, failed: 0 }),
    ).toBe(
      "Google Calendar updated. Subscribed feeds refresh on their own schedule.",
    );
  });
  it("reports partial failure and does not turn zero or missing results into success", () => {
    expect(
      academicPauseDeliveryNotice({ attempted: 2, succeeded: 1, failed: 1 }),
    ).toBe(
      "Some Google Calendar updates failed. Subscriber updates are not complete.",
    );
    expect(
      academicPauseDeliveryNotice({ attempted: 0, succeeded: 0, failed: 0 }),
    ).toBe("Subscriber delivery has not been confirmed.");
    expect(academicPauseDeliveryNotice()).toBe(
      "Subscriber delivery has not been confirmed.",
    );
  });
});
