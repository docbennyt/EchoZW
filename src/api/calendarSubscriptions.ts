import { getAnalyticsIdentity } from "../analytics";
import type {
  CreateSubscriptionInput,
  CreateSubscriptionResponse,
} from "../domain/subscriptions";

export async function createCalendarSubscription(
  input: CreateSubscriptionInput,
) {
  const identity = getAnalyticsIdentity();
  const response = await fetch("/api/calendar/subscriptions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CalenderZW-Anonymous-Id": identity.anonymousId,
      "X-CalenderZW-Session-Id": identity.sessionId,
    },
    body: JSON.stringify(input),
  });

  const body = await response.json();
  if (!response.ok) {
    const message =
      body?.error?.message ?? "We could not prepare your calendar.";
    throw new Error(message);
  }

  return body as CreateSubscriptionResponse;
}
