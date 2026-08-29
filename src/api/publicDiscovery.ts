export type PublishedTimetableSummary = {
  publicSlug: string;
  institutionName: string;
  programmeName: string;
  classGroupLabel: string;
  academicPeriodName: string;
  lastUpdated: string;
};

export async function fetchPublishedTimetables() {
  const response = await fetch("/api/public/timetables", {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error("Could not load published timetables.");
  }
  return (await response.json()) as {
    timetables: PublishedTimetableSummary[];
  };
}
