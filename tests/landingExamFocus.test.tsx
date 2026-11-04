import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { AppV2 } from "../src/AppV2";

describe("DR-179 exam-only homepage presentation", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("promotes published examinations without mixing lectures into its exam preview", () => {
    render(<AppV2 />);

    const spotlight = screen.getByRole("region", {
      name: "Your exams, without the PDF hunt.",
    });
    expect(
      within(spotlight).getByRole("link", {
        name: /Find my exam timetable/i,
      }),
    ).toHaveAttribute("href", "/find");

    const preview = screen.getByLabelText(
      "Illustrative CalenderZW exam-only calendar preview",
    );
    expect(within(preview).getByText("November exams")).toBeInTheDocument();
    expect(within(preview).getAllByText(/Examination/)).toHaveLength(3);
    expect(within(preview).queryByText(/lecture/i)).toBeNull();
  });
});
