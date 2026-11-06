import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  fetchGoogleConnection: vi.fn(),
  createCalendarSubscription: vi.fn(),
  fetchPublicTimetable: vi.fn(),
}));
vi.mock("../src/api/googleConnection", () => ({
  fetchGoogleConnection: api.fetchGoogleConnection,
}));
vi.mock("../src/api/calendarSubscriptions", () => ({
  createCalendarSubscription: api.createCalendarSubscription,
}));
vi.mock("../src/api/publicTimetable", () => ({
  fetchPublicTimetable: api.fetchPublicTimetable,
}));
vi.mock("../src/analytics", () => ({ track: vi.fn() }));
vi.mock("../src/GoogleCalendarDisconnectEntry", () => ({
  GoogleCalendarDisconnectEntry: () => null,
}));
import { GoogleCalendarConnectionStatus } from "../src/GoogleCalendarConnectionStatus";
import { GoogleCalendarConnectPage } from "../src/GoogleCalendarDirectConnect";
const existing = {
  subscriptionId: "owned-subscription",
  state: "syncing",
  lastSyncedAt: null,
  reconnectAllowed: false,
};
beforeEach(() => {
  vi.clearAllMocks();
  api.fetchGoogleConnection.mockResolvedValue(existing);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ enabled: false, scope: "" }),
    }),
  );
  api.fetchPublicTimetable.mockResolvedValue({
    timetableId: "timetable",
    publicSlug: "class",
    institution: "HIT",
    programme: "Software Engineering",
    classGroup: "1.1",
    academicPeriod: "2026",
    institutionTimezone: "Africa/Harare",
  });
});
describe("Google calendar self-service", () => {
  it("shows saved consent as pending delivery without claiming synchronized calendars", async () => {
    render(
      <GoogleCalendarConnectionStatus timetableId="timetable" slug="class" />,
    );
    expect(
      await screen.findByText(
        "Google authorization is saved. Timetable delivery is still pending.",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/synchronized/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Reconnect Google Calendar" }),
    ).not.toBeInTheDocument();
  });
  it("offers reconnect only for the owner's credential failure and preserves the current subscription", async () => {
    api.fetchGoogleConnection.mockResolvedValue({
      ...existing,
      state: "reconnect_required",
    });
    render(
      <GoogleCalendarConnectionStatus timetableId="timetable" slug="class" />,
    );
    expect(
      await screen.findByRole("link", { name: "Reconnect Google Calendar" }),
    ).toHaveAttribute("href", "/t/class/google");
    expect(api.createCalendarSubscription).not.toHaveBeenCalled();
  });
  it("never creates a duplicate subscription from an existing pending delivery page", async () => {
    render(<GoogleCalendarConnectPage slug="class" />);
    const button = await screen.findByRole("button", {
      name: "Authorize existing Google calendar",
    });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(api.createCalendarSubscription).not.toHaveBeenCalled();
    expect(screen.queryByText("Choose reminders")).not.toBeInTheDocument();
  });
  it("requires a completed owner lookup before offering new subscription creation", async () => {
    api.fetchGoogleConnection.mockRejectedValue(
      new Error("status unavailable"),
    );
    render(<GoogleCalendarConnectPage slug="class" />);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Timetable unavailable" }),
      ).toBeVisible(),
    );
    expect(api.createCalendarSubscription).not.toHaveBeenCalled();
  });
});
