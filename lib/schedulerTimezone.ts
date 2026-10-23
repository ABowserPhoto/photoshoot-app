/** Wall-clock timezone for social scheduler (parsing, rules, due-post checks). */
export const SCHEDULER_TIMEZONE = "Europe/Berlin";

const DATETIME_LOCAL_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/;

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function readZonedParts(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Wall-clock time in `timeZone` → UTC instant (DST-safe). */
export function wallClockInTimeZoneToUtc(
  parts: ZonedParts,
  timeZone: string = SCHEDULER_TIMEZONE
): Date {
  let guess = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  );
  const targetUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const zoned = readZonedParts(guess, timeZone);
    const zonedUtc = Date.UTC(
      zoned.year,
      zoned.month - 1,
      zoned.day,
      zoned.hour,
      zoned.minute,
      zoned.second
    );
    const diff = targetUtc - zonedUtc;
    if (diff === 0) {
      return guess;
    }
    guess = new Date(guess.getTime() + diff);
  }

  return guess;
}

function berlinWallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number
): Date | null {
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    !Number.isFinite(second)
  ) {
    return null;
  }
  const utc = wallClockInTimeZoneToUtc(
    { year, month, day, hour, minute, second },
    SCHEDULER_TIMEZONE
  );
  return Number.isNaN(utc.getTime()) ? null : utc;
}

/**
 * Parse scheduler date/time input as Europe/Berlin wall time when no offset is present.
 * ISO strings with `Z` or a numeric offset are treated as absolute instants.
 */
export function parseScheduledAtInSchedulerTimezone(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const hasExplicitOffset = /(?:[Zz]|[+-]\d{2}:?\d{2})$/.test(trimmed);
  if (hasExplicitOffset) {
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const dateTimeMatch = trimmed.match(DATETIME_LOCAL_RE);
  if (dateTimeMatch) {
    return berlinWallClockToUtc(
      Number(dateTimeMatch[1]),
      Number(dateTimeMatch[2]),
      Number(dateTimeMatch[3]),
      Number(dateTimeMatch[4]),
      Number(dateTimeMatch[5]),
      Number(dateTimeMatch[6] ?? "0")
    );
  }

  const dateOnlyMatch = trimmed.match(DATE_ONLY_RE);
  if (dateOnlyMatch) {
    return berlinWallClockToUtc(
      Number(dateOnlyMatch[1]),
      Number(dateOnlyMatch[2]),
      Number(dateOnlyMatch[3]),
      0,
      0,
      0
    );
  }

  const fallback = new Date(trimmed);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

/** Current instant (same as `Date.now()`). */
export function schedulerNow(): Date {
  return new Date();
}

/** UTC ISO string for comparing against `scheduled_at` stored as timestamptz / ISO UTC. */
export function schedulerDueCutoffIso(now = schedulerNow()): string {
  return now.toISOString();
}

/** Start of today (00:00) in Europe/Berlin, as a UTC instant. */
export function startOfTodayInSchedulerTimezone(now = schedulerNow()): Date {
  const berlin = readZonedParts(now, SCHEDULER_TIMEZONE);
  return berlinWallClockToUtc(berlin.year, berlin.month, berlin.day, 0, 0, 0)!;
}

/** Midnight on a calendar date (YYYY-MM-DD) in Europe/Berlin. */
export function parseDateOnlyInSchedulerTimezone(dateOnly: string): Date | null {
  return parseScheduledAtInSchedulerTimezone(dateOnly);
}

/**
 * Apply `minutesSinceMidnight` on the given calendar day in Berlin and return UTC instant.
 * `dayAnchor` must be a UTC instant; its Berlin calendar date is used.
 */
export function berlinTimeOnDay(dayAnchorUtc: Date, minutesSinceMidnight: number): Date {
  const berlin = readZonedParts(dayAnchorUtc, SCHEDULER_TIMEZONE);
  const hour = Math.floor(minutesSinceMidnight / 60);
  const minute = minutesSinceMidnight % 60;
  return berlinWallClockToUtc(berlin.year, berlin.month, berlin.day, hour, minute, 0)!;
}

/** Monday 00:00 Berlin for the week containing `dayAnchorUtc`. */
export function startOfWeekMondayBerlin(dayAnchorUtc: Date): Date {
  const berlin = readZonedParts(dayAnchorUtc, SCHEDULER_TIMEZONE);
  let cursor = berlinWallClockToUtc(berlin.year, berlin.month, berlin.day, 0, 0, 0)!;
  for (let step = 0; step < 7; step += 1) {
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: SCHEDULER_TIMEZONE,
      weekday: "short",
    }).format(cursor);
    if (weekday === "Mon") {
      return cursor;
    }
    cursor = addDaysBerlin(cursor, -1);
  }
  return cursor;
}

/** Add calendar days in Berlin (preserves wall-clock time where possible). */
export function addDaysBerlin(dayAnchorUtc: Date, days: number): Date {
  const berlin = readZonedParts(dayAnchorUtc, SCHEDULER_TIMEZONE);
  const anchorUtc = Date.UTC(berlin.year, berlin.month - 1, berlin.day);
  const targetUtc = anchorUtc + days * 86_400_000;
  const targetParts = readZonedParts(new Date(targetUtc), SCHEDULER_TIMEZONE);
  return berlinWallClockToUtc(
    targetParts.year,
    targetParts.month,
    targetParts.day,
    berlin.hour,
    berlin.minute,
    berlin.second
  )!;
}
