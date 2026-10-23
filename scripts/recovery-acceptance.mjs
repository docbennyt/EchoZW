// CI-only sign-in: never exports a session to disk, logs or workflow outputs.
export async function obtainAcceptanceToken(env, request = fetch) {
  const email = env.CALENDERZW_STAGING_ADMIN_EMAIL;
  const password = env.CALENDERZW_STAGING_ADMIN_PASSWORD;
  if (!email && !password)
    return env.CALENDERZW_STAGING_ADMIN_ACCESS_TOKEN || null;
  let endpoint;
  try {
    endpoint = new URL(env.SUPABASE_URL);
    if (
      !email ||
      !password ||
      !env.VITE_SUPABASE_PUBLISHABLE_KEY ||
      endpoint.protocol !== "https:" ||
      endpoint.username ||
      endpoint.password ||
      endpoint.pathname !== "/" ||
      endpoint.search ||
      endpoint.hash
    )
      throw new Error();
    endpoint.pathname = "/auth/v1/token";
    endpoint.search = "?grant_type=password";
  } catch {
    throw new Error("TEST_ACCOUNT_AUTH_CONFIG_INVALID");
  }
  try {
    const response = await request(endpoint.href, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: {
        "content-type": "application/json",
        apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({ email, password }),
    });
    const session = response.ok ? await response.json() : null;
    if (typeof session?.access_token !== "string" || !session.access_token)
      throw new Error();
    return session.access_token;
  } catch {
    throw new Error("TEST_ACCOUNT_SIGN_IN_FAILED");
  }
}

export function validateRecoveryCalendar(
  text,
  onFailure = () => {},
  expectedCalendar,
) {
  const fail = (code, count) => {
    if (count === undefined) onFailure(code);
    else onFailure(code, count);
    return false;
  };
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const expectedEvents = expectedCalendar
    ?.replace(/\r?\n[ \t]/g, "")
    .match(/BEGIN:VEVENT\r?\n[\s\S]*?\r?\nEND:VEVENT/g);
  const expectedCount =
    expectedCalendar === undefined ? 15 : expectedEvents?.length;
  if (!expectedCount) return fail("EXPECTED_CALENDAR_EMPTY");
  if (
    !/^BEGIN:VCALENDAR\r?\n/.test(unfolded) ||
    !/\r?\nEND:VCALENDAR\s*$/.test(unfolded) ||
    !/^VERSION:2\.0\r?$/m.test(unfolded)
  )
    return fail("CALENDAR_ENVELOPE");
  const stack = [];
  let eventCount = 0;
  for (const line of unfolded.trimEnd().split(/\r?\n/)) {
    if (line.startsWith("BEGIN:")) {
      const component = line.slice(6);
      if (component === "VEVENT") {
        if (stack.length !== 1 || stack[0] !== "VCALENDAR")
          return fail("COMPONENT_NESTING");
        eventCount += 1;
      }
      if (component === "VCALENDAR" && stack.length)
        return fail("COMPONENT_NESTING");
      stack.push(component);
    } else if (line.startsWith("END:")) {
      if (stack.pop() !== line.slice(4)) return fail("COMPONENT_BALANCE");
    } else if (!stack.length) return fail("COMPONENT_BALANCE");
  }
  if (stack.length) return fail("COMPONENT_BALANCE");
  if (eventCount !== expectedCount) return fail("EVENT_COUNT", eventCount);
  const events = [
    ...unfolded.matchAll(/BEGIN:VEVENT\r?\n([\s\S]*?)\r?\nEND:VEVENT/g),
  ].map((match) => match[1]);
  if (events.length !== expectedCount)
    return fail("EVENT_COUNT", events.length);
  const uids = events.map((event) => /^UID:(.+)\r?$/m.exec(event)?.[1]?.trim());
  if (uids.some((uid) => !uid) || new Set(uids).size !== expectedCount)
    return fail("EVENT_UIDS");
  const validLocalDate = (value) => {
    if (!/^\d{8}T\d{6}$/.test(value ?? "")) return false;
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6));
    const day = Number(value.slice(6, 8));
    const hour = Number(value.slice(9, 11));
    const minute = Number(value.slice(11, 13));
    const second = Number(value.slice(13, 15));
    const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    return (
      year >= 1900 &&
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day &&
      hour < 24 &&
      minute < 60 &&
      second < 60
    );
  };
  for (const event of events) {
    const start = /^DTSTART;TZID=Africa\/Harare:(.+)\r?$/m
      .exec(event)?.[1]
      ?.trim();
    const end = /^DTEND;TZID=Africa\/Harare:(.+)\r?$/m.exec(event)?.[1]?.trim();
    const rule = /^RRULE:(.+)\r?$/m.exec(event)?.[1]?.trim();
    if (
      !validLocalDate(start) ||
      !validLocalDate(end) ||
      end <= start ||
      !/^SUMMARY:.+\r?$/m.test(event) ||
      /^STATUS:CANCELLED\r?$/m.test(event)
    )
      return fail("EVENT_DATE_OR_RECURRENCE");
    // Existing date-specific exceptions have no RRULE; only the matching
    // canonical baseline can authorize that distinction in acceptance.
    if (!rule && expectedCalendar !== undefined) continue;
    const parts = rule?.split(";").map((part) => part.split("="));
    if (
      !parts ||
      parts.some((part) => part.length !== 2) ||
      new Set(parts.map(([key]) => key)).size !== parts.length
    )
      return fail("RECURRENCE_PROPERTIES");
    const recurrence = Object.fromEntries(parts);
    if (
      recurrence.FREQ !== "WEEKLY" ||
      recurrence.COUNT !== undefined ||
      (recurrence.INTERVAL ?? "1") !== "1" ||
      !/^(MO|TU|WE|TH|FR|SA|SU)$/.test(recurrence.BYDAY ?? "")
    )
      return fail("EVENT_DATE_OR_RECURRENCE");
    const startDay = new Date(
      Date.UTC(
        Number(start.slice(0, 4)),
        Number(start.slice(4, 6)) - 1,
        Number(start.slice(6, 8)),
      ),
    ).getUTCDay();
    if (
      recurrence.BYDAY !== ["SU", "MO", "TU", "WE", "TH", "FR", "SA"][startDay]
    )
      return fail("DTSTART_WEEKDAY");
  }
  if (expectedCalendar !== undefined) {
    // Compare canonical event truth, not subscriber alarms or revision metadata.
    const signature = (event) =>
      event
        .replace(/BEGIN:VALARM\r?\n[\s\S]*?END:VALARM\r?\n/g, "")
        .split(/\r?\n/)
        .filter((line) =>
          /^(UID|DTSTART|DTEND|SUMMARY|LOCATION|RRULE|EXDATE|RECURRENCE-ID|STATUS)[:;]/.test(
            line,
          ),
        )
        .sort()
        .join("\n");
    const actual = events.map(signature).sort();
    const expected = expectedEvents.map(signature).sort();
    return (
      JSON.stringify(actual) === JSON.stringify(expected) ||
      fail("CANONICAL_CLASS_MISMATCH")
    );
  }
  const ise = events.filter((event) => /^SUMMARY:ISE4105\b/m.test(event));
  const matches = (event, day, time, venue) =>
    new RegExp(`^RRULE:.*(?:;|:)BYDAY=${day}(?:;|\\r?$)`, "m").test(event) &&
    new RegExp(`^DTSTART;TZID=Africa/Harare:\\d{8}T${time}00\\r?$`, "m").test(
      event,
    ) &&
    new RegExp(`^LOCATION:${venue}\\r?$`, "m").test(event) &&
    !/^STATUS:CANCELLED\r?$/m.test(event);
  const correct =
    ise.length === 2 &&
    ise.filter((event) => matches(event, "TU", "1215", "N109")).length === 1 &&
    ise.filter((event) => matches(event, "TH", "0800", "S107")).length === 1;
  return correct || fail("ISE4105_EFFECTIVE_TRUTH", ise.length);
}
