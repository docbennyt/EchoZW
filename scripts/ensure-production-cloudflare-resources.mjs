const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
const token = process.env.CLOUDFLARE_API_TOKEN ?? "";
if (!/^[a-f0-9]{32}$/.test(accountId) || !token)
  throw new Error("PRODUCTION_CLOUDFLARE_CREDENTIALS_REQUIRED");

const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}`;
async function request(path, init = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success === false)
    throw new Error(
      `PRODUCTION_RESOURCE_REQUEST_FAILED_HTTP_${response.status}`,
    );
  return body?.result ?? body;
}

const queues = [
  "calenderzw-source-processing-production",
  "calenderzw-source-processing-dlq-production",
  "calenderzw-push-production",
  "calenderzw-push-dlq-production",
];
const buckets = [
  "calenderzw-source-production",
  "calenderzw-calendar-artifacts-production",
];

const listedQueues = await request("/queues");
const existingQueues = new Set(
  (Array.isArray(listedQueues) ? listedQueues : []).map(
    (queue) => queue.queue_name ?? queue.name,
  ),
);
for (const queue of queues) {
  if (!existingQueues.has(queue))
    await request("/queues", {
      method: "POST",
      body: JSON.stringify({ queue_name: queue }),
    });
}

const listedBuckets = await request("/r2/buckets?per_page=1000");
const existingBuckets = new Set(
  (listedBuckets?.buckets ?? listedBuckets ?? []).map((bucket) => bucket.name),
);
for (const bucket of buckets) {
  if (!existingBuckets.has(bucket))
    await request("/r2/buckets", {
      method: "POST",
      body: JSON.stringify({ name: bucket }),
    });
}

console.log(
  `Verified isolated production resources: ${queues.length} queues, ${buckets.length} buckets.`,
);
