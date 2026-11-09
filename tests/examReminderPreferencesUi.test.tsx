import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ExamReminderPreferences } from "../src/ExamReminderPreferences";

afterEach(() => vi.unstubAllGlobals());
describe("student examination reminder consent", () => {
  it("leaves alarms off until an explicit action and supports removal", async () => {
    const request = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        const input = JSON.parse(String(init.body));
        return Response.json({ offsets: input.offsets });
      }
      return Response.json({
        subscriptions: [
          {
            id: "owned-subscription",
            provider: "apple_subscription",
            offsets: [],
          },
        ],
      });
    });
    vi.stubGlobal("fetch", request);
    render(<ExamReminderPreferences timetableId="published-class" />);
    const enable = await screen.findByRole("button", {
      name: "Enable 60 and 30 minute exam reminders",
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Exam reminders off/)).toBeInTheDocument();
    fireEvent.click(enable);
    await screen.findByRole("button", { name: "Turn off exam reminders" });
    expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toEqual({
      subscriptionId: "owned-subscription",
      offsets: [60, 30],
      consent: true,
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Turn off exam reminders" }),
    );
    await screen.findByRole("button", {
      name: "Enable 60 and 30 minute exam reminders",
    });
    expect(JSON.parse(String(request.mock.calls[2][1]?.body))).toEqual({
      subscriptionId: "owned-subscription",
      offsets: [],
      consent: false,
    });
  });

  it("keeps the persisted setting visible when a save fails", async () => {
    const request = vi.fn(async (_url: unknown, init?: RequestInit) =>
      init?.method === "PATCH"
        ? Response.json(
            { error: { message: "Settings unavailable." } },
            { status: 503 },
          )
        : Response.json({
            subscriptions: [
              { id: "owned-subscription", provider: "google_api", offsets: [] },
            ],
          }),
    );
    vi.stubGlobal("fetch", request);
    render(<ExamReminderPreferences timetableId="published-class" />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Enable 60 and 30 minute exam reminders",
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Settings unavailable.",
      ),
    );
    expect(
      screen.getByRole("button", {
        name: "Enable 60 and 30 minute exam reminders",
      }),
    ).toBeEnabled();
    expect(
      screen.queryByText(/Examination reminders saved/),
    ).not.toBeInTheDocument();
  });
});
