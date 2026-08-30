const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const vtimezoneCache = new Map<string, string[]>();

function pad(value: number, length = 2) {
  return String(value).padStart(length, "0");
}

export function assertIanaTimeZone(timeZone: string) {
  const normalized = timeZone.trim();
  if (!normalized) {
    throw new Error("Institution timezone is required.");
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized }).format(
      new Date(0),
    );
  } catch {
    throw new Error(`Unsupported institution timezone: ${normalized}`);
  }

  return normalized;
}

function parseOffsetName(value: string) {
  if (/^(?:GMT|UTC)$/i.test(value)) return 0;
  const match = value.match(/^(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?$/i);
  if (!match) {
    throw new Error(`Could not parse timezone offset: ${value}`);
  }
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? 0));
}

export function getTimeZoneOffsetMinutes(instant: Date, timeZone: string) {
  const zone = assertIanaTimeZone(timeZone);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "longOffset",
  });
  const offsetName = formatter
    .formatToParts(instant)
    .find((part) => part.type === "timeZoneName")?.value;
  if (!offsetName) {
    throw new Error(`Could not determine timezone offset for ${zone}.`);
  }
  return parseOffsetName(offsetName);
}

export function getTimeZoneShortName(instant: Date, timeZone: string) {
  const zone = assertIanaTimeZone(timeZone);
  return (
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "short",
    })
      .formatToParts(instant)
      .find((part) => part.type === "timeZoneName")?.value ?? zone
  );
}

export function zonedDateTimeToUtc(
  dateKey: string,
  time: string,
  timeZone: string,
) {
  const zone = assertIanaTimeZone(timeZone);
  const dateMatch = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = time.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!dateMatch || !timeMatch) {
    throw new Error(`Invalid local date/time: ${dateKey} ${time}`);
  }

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);
  const seconds = Number(timeMatch[3] ?? 0);
  const baseUtc = Date.UTC(year, month - 1, day, hours, minutes, seconds);
  let candidate = new Date(baseUtc);

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const offsetMinutes = getTimeZoneOffsetMinutes(candidate, zone);
    const next = new Date(baseUtc - offsetMinutes * MINUTE_MS);
    if (next.getTime() === candidate.getTime()) return next;
    candidate = next;
  }

  return candidate;
}

export function formatIcsUtc(instant: Date) {
  return `${instant.getUTCFullYear()}${pad(instant.getUTCMonth() + 1)}${pad(
    instant.getUTCDate(),
  )}T${pad(instant.getUTCHours())}${pad(instant.getUTCMinutes())}${pad(
    instant.getUTCSeconds(),
  )}Z`;
}

export function formatIcsLocalDateTime(dateKey: string, time: string) {
  const timeMatch = time.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !timeMatch) {
    throw new Error(`Invalid local date/time: ${dateKey} ${time}`);
  }
  return `${dateKey.replace(/-/g, "")}T${pad(Number(timeMatch[1]))}${pad(
    Number(timeMatch[2]),
  )}${pad(Number(timeMatch[3] ?? 0))}`;
}

export function formatOffsetMinutes(offsetMinutes: number) {
  const sign = offsetMinutes < 0 ? "-" : "+";
  const absolute = Math.abs(offsetMinutes);
  return `${sign}${pad(Math.floor(absolute / 60))}${pad(absolute % 60)}`;
}

function formatTransitionLocal(instant: Date, offsetBefore: number) {
  const local = new Date(instant.getTime() + offsetBefore * MINUTE_MS);
  return `${local.getUTCFullYear()}${pad(local.getUTCMonth() + 1)}${pad(
    local.getUTCDate(),
  )}T${pad(local.getUTCHours())}${pad(local.getUTCMinutes())}${pad(
    local.getUTCSeconds(),
  )}`;
}

type OffsetTransition = {
  instant: Date;
  before: number;
  after: number;
  nameAfter: string;
};

function findOffsetTransitions(timeZone: string, startYear: number, endYear: number) {
  const scanStart = Date.UTC(startYear - 1, 0, 1, 0, 0, 0);
  const scanEnd = Date.UTC(endYear + 1, 11, 31, 23, 59, 0);
  const transitions: OffsetTransition[] = [];
  const observedOffsets = new Set<number>();

  let previousTimestamp = scanStart;
  let previousOffset = getTimeZoneOffsetMinutes(
    new Date(previousTimestamp),
    timeZone,
  );
  observedOffsets.add(previousOffset);

  for (
    let timestamp = scanStart + DAY_MS;
    timestamp <= scanEnd;
    timestamp += DAY_MS
  ) {
    const offset = getTimeZoneOffsetMinutes(new Date(timestamp), timeZone);
    observedOffsets.add(offset);

    if (offset !== previousOffset) {
      let low = previousTimestamp;
      let high = timestamp;
      const offsetBefore = previousOffset;

      while (high - low > MINUTE_MS) {
        const midpoint =
          Math.floor((low + high) / 2 / MINUTE_MS) * MINUTE_MS;
        if (midpoint <= low) break;
        const midpointOffset = getTimeZoneOffsetMinutes(
          new Date(midpoint),
          timeZone,
        );
        if (midpointOffset === offsetBefore) {
          low = midpoint;
        } else {
          high = midpoint;
        }
      }

      const transitionInstant = new Date(high);
      const offsetAfter = getTimeZoneOffsetMinutes(transitionInstant, timeZone);
      observedOffsets.add(offsetAfter);
      transitions.push({
        instant: transitionInstant,
        before: offsetBefore,
        after: offsetAfter,
        nameAfter: getTimeZoneShortName(
          new Date(transitionInstant.getTime() + MINUTE_MS),
          timeZone,
        ),
      });
      previousOffset = offsetAfter;
    } else {
      previousOffset = offset;
    }

    previousTimestamp = timestamp;
  }

  return {
    transitions,
    observedOffsets: [...observedOffsets].sort((left, right) => left - right),
    scanStart: new Date(scanStart),
  };
}

export function buildVTimezoneLines(
  timeZone: string,
  startsOn: string,
  endsOn: string,
) {
  const zone = assertIanaTimeZone(timeZone);
  const startYear = Number(startsOn.slice(0, 4));
  const endYear = Number(endsOn.slice(0, 4));
  if (!Number.isInteger(startYear) || !Number.isInteger(endYear)) {
    throw new Error("Academic period dates must use YYYY-MM-DD.");
  }

  const cacheKey = `${zone}:${startYear}:${endYear}`;
  const cached = vtimezoneCache.get(cacheKey);
  if (cached) return [...cached];

  const { transitions, observedOffsets, scanStart } = findOffsetTransitions(
    zone,
    startYear,
    endYear,
  );
  const standardOffset = Math.min(...observedOffsets);
  const initialOffset = getTimeZoneOffsetMinutes(scanStart, zone);
  const initialName = getTimeZoneShortName(scanStart, zone);
  const initialType =
    observedOffsets.length > 1 && initialOffset !== standardOffset
      ? "DAYLIGHT"
      : "STANDARD";

  const lines = [
    "BEGIN:VTIMEZONE",
    `TZID:${zone}`,
    `X-LIC-LOCATION:${zone}`,
    `BEGIN:${initialType}`,
    `DTSTART:${startYear - 1}0101T000000`,
    `TZOFFSETFROM:${formatOffsetMinutes(initialOffset)}`,
    `TZOFFSETTO:${formatOffsetMinutes(initialOffset)}`,
    `TZNAME:${initialName}`,
    `END:${initialType}`,
  ];

  for (const transition of transitions) {
    const transitionType =
      observedOffsets.length > 1 && transition.after !== standardOffset
        ? "DAYLIGHT"
        : "STANDARD";
    lines.push(`BEGIN:${transitionType}`);
    lines.push(
      `DTSTART:${formatTransitionLocal(transition.instant, transition.before)}`,
    );
    lines.push(`TZOFFSETFROM:${formatOffsetMinutes(transition.before)}`);
    lines.push(`TZOFFSETTO:${formatOffsetMinutes(transition.after)}`);
    lines.push(`TZNAME:${transition.nameAfter}`);
    lines.push(`END:${transitionType}`);
  }

  lines.push("END:VTIMEZONE");
  vtimezoneCache.set(cacheKey, [...lines]);
  return lines;
}

export function foldIcsLineUtf8(line: string, maxOctets = 75) {
  if (maxOctets < 4) {
    throw new Error("ICS line fold limit is too small.");
  }

  const encoder = new TextEncoder();
  const segments: string[] = [];
  let current = "";
  let currentOctets = 0;
  let contentLimit = maxOctets;

  for (const character of line) {
    const characterOctets = encoder.encode(character).length;
    if (current && currentOctets + characterOctets > contentLimit) {
      segments.push(current);
      current = character;
      currentOctets = characterOctets;
      contentLimit = maxOctets - 1;
    } else {
      current += character;
      currentOctets += characterOctets;
    }
  }

  if (current || segments.length === 0) segments.push(current);
  return segments
    .map((segment, index) => (index === 0 ? segment : ` ${segment}`))
    .join("\r\n");
}
