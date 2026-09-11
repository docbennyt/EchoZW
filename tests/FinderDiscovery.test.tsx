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
      matches: query === "(min-width: 900px)" ? width >= 900 : false,
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
  it.each([320, 360, 390])(
    "keeps %ipx mobile focused on the exact finder only",
    async (width) => {
      setViewport(width);
      render(<FinderDiscovery />);
      expect(
        await screen.findByRole("heading", { name: "Find your exact class" }),
      ).toBeInTheDocument();
      await waitFor(() =>
        expect(mocks.fetchPublishedTimetables).toHaveBeenCalledTimes(1),
      );
      expect(screen.queryByRole("heading", { name: "Directory" })).toBeNull();
      expect(screen.queryByText(/Timetable link or slug/i)).toBeNull();
      expect(
        screen.queryByRole("heading", { name: "Published timetables" }),
      ).toBeNull();
    },
  );

  it.each([1366, 1440])(
    "keeps the exact finder above the subordinate directory at %ipx desktop",
    async (width) => {
      setViewport(width);
      render(<FinderDiscovery />);
      const exact = await screen.findByRole("heading", {
        name: "Find your exact class",
      });
      const directory = await screen.findByRole("heading", {
        name: "Directory",
      });
      expect(
        exact.compareDocumentPosition(directory) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).not.toBe(0);
      expect(screen.queryByText(/Timetable link or slug/i)).toBeNull();
    },
  );
});
