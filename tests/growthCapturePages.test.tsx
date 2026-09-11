import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/components/site/SiteChrome", () => ({
  PublicShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { FeedbackPage, TimetableRequestPage } from "../src/GrowthCapturePages";

const fetchMock = vi.fn();

function response(ok: boolean, payload: unknown = {}): Response {
  return {
    ok,
    json: vi.fn().mockResolvedValue(payload),
  } as unknown as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function feedbackForm() {
  return screen
    .getByRole("button", { name: "Send feedback" })
    .closest("form") as HTMLFormElement;
}

function requestForm() {
  return screen
    .getByRole("button", { name: "Request this timetable" })
    .closest("form") as HTMLFormElement;
}

function fillFeedback(message = "The timetable is useful") {
  fireEvent.change(screen.getByLabelText("Message *"), {
    target: { value: message },
  });
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "student@example.com" },
  });
}

function fillRequest() {
  fireEvent.change(screen.getByLabelText("University / institution *"), {
    target: { value: "Harare Institute of Technology" },
  });
  fireEvent.change(screen.getByLabelText("Programme *"), {
    target: { value: "BTech Software Engineering" },
  });
  fireEvent.change(screen.getByLabelText("Class / part / group *"), {
    target: { value: "4.1" },
  });
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "rep@example.com" },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("growth capture submission reliability", () => {
  it("resets feedback only after a successful form submission", async () => {
    fetchMock.mockResolvedValue(response(true));
    render(<FeedbackPage />);
    fillFeedback();

    const message = screen.getByLabelText("Message *") as HTMLTextAreaElement;
    const form = feedbackForm();

    // A browser-generated submit event is the same path used after Enter-key submit.
    fireEvent.submit(form);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Thanks — your feedback was received.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(message.value).toBe("");
  });

  it("resets timetable requests only after a successful form submission", async () => {
    fetchMock.mockResolvedValue(response(true));
    render(<TimetableRequestPage />);
    fillRequest();

    const institution = screen.getByLabelText(
      "University / institution *",
    ) as HTMLInputElement;
    fireEvent.submit(requestForm());

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Request received.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(institution.value).toBe("");
  });

  it("preserves feedback fields after a 4xx response", async () => {
    fetchMock.mockResolvedValue(
      response(false, { error: { message: "Please check your feedback." } }),
    );
    render(<FeedbackPage />);
    fillFeedback("Keep this text after 400");

    fireEvent.submit(feedbackForm());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Please check your feedback.",
    );
    expect(screen.getByLabelText("Message *")).toHaveValue(
      "Keep this text after 400",
    );
    expect(screen.getByLabelText("Email")).toHaveValue("student@example.com");
  });

  it("preserves timetable request fields after a 4xx response", async () => {
    fetchMock.mockResolvedValue(
      response(false, { error: { message: "Request needs more detail." } }),
    );
    render(<TimetableRequestPage />);
    fillRequest();

    fireEvent.submit(requestForm());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Request needs more detail.",
    );
    expect(screen.getByLabelText("Programme *")).toHaveValue(
      "BTech Software Engineering",
    );
    expect(screen.getByLabelText("Email")).toHaveValue("rep@example.com");
  });

  it("preserves feedback fields after a 5xx response", async () => {
    fetchMock.mockResolvedValue(
      response(false, { error: { message: "Server unavailable." } }),
    );
    render(<FeedbackPage />);
    fillFeedback("Keep this text after 500");

    fireEvent.submit(feedbackForm());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Server unavailable.",
    );
    expect(screen.getByLabelText("Message *")).toHaveValue(
      "Keep this text after 500",
    );
  });

  it("preserves timetable request fields after a 5xx response", async () => {
    fetchMock.mockResolvedValue(
      response(false, { error: { message: "Server unavailable." } }),
    );
    render(<TimetableRequestPage />);
    fillRequest();

    fireEvent.submit(requestForm());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Server unavailable.",
    );
    expect(screen.getByLabelText("Class / part / group *")).toHaveValue("4.1");
  });

  it("preserves feedback fields after a network failure", async () => {
    fetchMock.mockRejectedValue(new Error("Network offline"));
    render(<FeedbackPage />);
    fillFeedback("Keep this text offline");

    fireEvent.submit(feedbackForm());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Network offline",
    );
    expect(screen.getByLabelText("Message *")).toHaveValue(
      "Keep this text offline",
    );
  });

  it("preserves timetable request fields after a network failure", async () => {
    fetchMock.mockRejectedValue(new Error("Network offline"));
    render(<TimetableRequestPage />);
    fillRequest();

    fireEvent.submit(requestForm());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Network offline",
    );
    expect(screen.getByLabelText("University / institution *")).toHaveValue(
      "Harare Institute of Technology",
    );
  });

  it("blocks rapid duplicate feedback submissions before React state commits", async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValue(pending.promise);
    render(<FeedbackPage />);
    fillFeedback();

    const form = feedbackForm();
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled();

    pending.resolve(response(true));
    await screen.findByRole("status");
  });

  it("blocks rapid duplicate timetable-request submissions before React state commits", async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValue(pending.promise);
    render(<TimetableRequestPage />);
    fillRequest();

    const form = requestForm();
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled();

    pending.resolve(response(true));
    await screen.findByRole("status");
  });

  it("releases the synchronous guard after failure so a keyboard/form resubmit can succeed", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("Temporary network error"))
      .mockResolvedValueOnce(response(true));
    render(<FeedbackPage />);
    fillFeedback("Retry me");

    const form = feedbackForm();
    fireEvent.submit(form);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Temporary network error",
    );

    fireEvent.submit(form);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Thanks — your feedback was received.",
    );
  });
});
