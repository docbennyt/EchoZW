import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublishedTimetableSummary } from "../src/api/publicDiscovery";

const mocks = vi.hoisted(() => ({
  fetchPublishedTimetables: vi.fn(),
}));

vi.mock("../src/api/publicDiscovery", () => ({
  fetchPublishedTimetables: mocks.fetchPublishedTimetables,
}));

import { FinderDiscovery } from "../src/FinderDiscovery";

const timetables: PublishedTimetableSummary[] = [
  {
    publicSlug: "hit-cs-1-1-august-2026",
    institutionName: "Harare Institute of Technology",
    timezone: "Africa/Harare",
    programmeName: "BTech Computer Science",
    classGroupLabel: "1.1",
    academicPeriodName: "August Semester 2026",
    startsOn: "2026-08-10",
    endsOn: "2026-12-10",
    lastUpdated: "2026-09-11T08:00:00.000Z",
  },
];

function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(min-width: 1024px)" ? width >= 1024 : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

beforeEach(() => {
  mocks.fetchPublishedTimetables.mockReset();
  mocks.fetchPublishedTimetables.mockResolvedValue({ timetables });
});

afterEach(() => cleanup());

describe("DR-66 FinderDiscovery responsive hierarchy", () => {
  it.each([320, 360, 390, 900])(
    "keeps %ipx focused on the exact finder only",
    async (width) => {
      setViewport(width);
      render(<FinderDiscovery />);
      expect(
        await screen.findByRole("heading", { name: "Find your exact class" }),
      ).toBeInTheDocument();
      await waitFor(() =>
        expect(mocks.fetchPublishedTimetables).toHaveBeenCalledTimes(1),
      );
      expect(
        screen.queryByLabelText("Search published timetables"),
      ).toBeNull();
      expect(screen.queryByText(/Timetable link or slug/i)).toBeNull();
    },
  );

  it.each([1366, 1440, 1920])(
    "uses a desktop filter rail and results workspace at %ipx",
    async (width) => {
      setViewport(width);
      render(<FinderDiscovery />);

      expect(
        await screen.findByLabelText("Search published timetables"),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("heading", { name: "Find your exact class" }),
      ).toBeNull();
      expect(screen.getByText("Filter & refine")).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: "1 published timetable" }),
      ).toBeInTheDocument();
      expect(screen.getByText("BTech Computer Science")).toBeInTheDocument();
      expect(screen.getByText("All published timetables")).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Directory" })).toBeNull();
    },
  );
});
