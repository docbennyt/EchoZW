import type { AnalyticsOverview } from "../domain/adminAnalytics";
import type { MetricDefinition } from "../domain/analyticsMetrics";

async function adminAnalyticsFetch<T>(path: string, accessToken: string) {
  const response = await fetch(path, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof body?.error?.message === "string"
        ? body.error.message
        : "Analytics request failed.";
    const error = new Error(message);
    error.name = String(body?.error?.code ?? "ANALYTICS_ERROR");
    throw error;
  }
  return body as T;
}

export function fetchAnalyticsOverview(
  accessToken: string,
  params: URLSearchParams,
) {
  return adminAnalyticsFetch<AnalyticsOverview>(
    `/api/admin/analytics/overview?${params.toString()}`,
    accessToken,
  );
}

export function fetchAnalyticsMetricDefinitions(accessToken: string) {
  return adminAnalyticsFetch<{ metrics: MetricDefinition[] }>(
    "/api/admin/analytics/metrics",
    accessToken,
  );
}
