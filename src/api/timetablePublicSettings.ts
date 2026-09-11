export type TimetablePublicDisplaySettings = {
  showVisualPreview: boolean;
  showChangeAlerts: boolean;
};

type ErrorBody = {
  error?: { code?: string; message?: string };
};

async function settingsFetch(
  accessToken: string,
  timetableId: string,
  options: {
    method?: "GET" | "PUT";
    body?: TimetablePublicDisplaySettings;
  } = {},
) {
  const response = await fetch(
    `/api/admin/timetables/${encodeURIComponent(timetableId)}/public-settings`,
    {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    },
  );
  const payload = (await response.json().catch(() => null)) as
    { settings: TimetablePublicDisplaySettings } | ErrorBody | null;
  if (!response.ok) {
    const error = payload as ErrorBody | null;
    throw new Error(
      error?.error?.message ?? "Public timetable settings request failed.",
    );
  }
  return (payload as { settings: TimetablePublicDisplaySettings }).settings;
}

export function getTimetablePublicSettings(
  accessToken: string,
  timetableId: string,
) {
  return settingsFetch(accessToken, timetableId);
}

export function updateTimetablePublicSettings(
  accessToken: string,
  timetableId: string,
  settings: TimetablePublicDisplaySettings,
) {
  return settingsFetch(accessToken, timetableId, {
    method: "PUT",
    body: settings,
  });
}
