/** Studio-local calendar for daily shift grouping and midnight caps. */
export const APP_SHIFT_TIMEZONE = "Europe/Amsterdam";

/** 30 minutes — client idle auto-clock-out. */
export const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

/** 12 hours — server backstop for unclosed / frozen-tab shifts. */
export const ORPHAN_SHIFT_CAP_MINUTES = 720;
export const ORPHAN_SHIFT_CAP_MS = ORPHAN_SHIFT_CAP_MINUTES * 60_000;

export type ShiftCloseResolution = {
  isStale: boolean;
  clockOutAt: Date;
  durationMinutes: number;
};

function durationMinutesBetween(clockInAt: string, clockOutAt: Date): number {
  const inMs = new Date(clockInAt).getTime();
  const outMs = clockOutAt.getTime();
  if (!Number.isFinite(inMs) || !Number.isFinite(outMs) || outMs <= inMs) {
    return 0;
  }
  return Math.round((outMs - inMs) / 60_000);
}

function zonedParts(
  date: Date,
  timeZone: string
): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  });
  const parts = dtf.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((part) => part.type === type)?.value;
    return Number(value);
  };
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** YYYY-MM-DD in the studio timezone. */
export function zonedDateKey(date: Date, timeZone = APP_SHIFT_TIMEZONE): string {
  const parts = zonedParts(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function zonedLocalToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
  timeZone: string
): Date {
  let utc = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  for (let i = 0; i < 3; i += 1) {
    const parts = zonedParts(new Date(utc), timeZone);
    const asUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
      millisecond
    );
    const desired = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
    utc += desired - asUtc;
  }
  return new Date(utc);
}

/** Last millisecond of the studio-local calendar day that contains `date`. */
export function endOfZonedDay(date: Date, timeZone = APP_SHIFT_TIMEZONE): Date {
  const key = zonedDateKey(date, timeZone);
  const [year, month, day] = key.split("-").map(Number);
  const nextUtcDate = new Date(Date.UTC(year, month - 1, day + 1));
  const startOfNext = zonedLocalToUtc(
    nextUtcDate.getUTCFullYear(),
    nextUtcDate.getUTCMonth() + 1,
    nextUtcDate.getUTCDate(),
    0,
    0,
    0,
    0,
    timeZone
  );
  return new Date(startOfNext.getTime() - 1);
}

/**
 * Open shifts are stale when they have run longer than 12 hours or crossed
 * midnight in the studio timezone (typical frozen-tab leftovers).
 */
export function isOpenShiftStale(clockInAt: string, now = new Date()): boolean {
  const clockInMs = new Date(clockInAt).getTime();
  if (!Number.isFinite(clockInMs)) {
    return true;
  }
  if (now.getTime() - clockInMs > ORPHAN_SHIFT_CAP_MS) {
    return true;
  }
  return zonedDateKey(new Date(clockInMs)) < zonedDateKey(now);
}

/**
 * Resolve when an open shift should be closed.
 * Stale shifts are capped at the earlier of: now, clock-in + 12h, end of clock-in day.
 * Active same-day shifts close at `now`.
 */
export function resolveOpenShiftClose(clockInAt: string, now = new Date()): ShiftCloseResolution {
  const clockInMs = new Date(clockInAt).getTime();
  if (!Number.isFinite(clockInMs)) {
    return { isStale: true, clockOutAt: now, durationMinutes: 0 };
  }

  const stale = isOpenShiftStale(clockInAt, now);
  if (!stale) {
    return {
      isStale: false,
      clockOutAt: now,
      durationMinutes: durationMinutesBetween(clockInAt, now),
    };
  }

  const capAt = new Date(clockInMs + ORPHAN_SHIFT_CAP_MS);
  const endOfDay = endOfZonedDay(new Date(clockInMs));
  const clockOutAt = new Date(Math.min(now.getTime(), capAt.getTime(), endOfDay.getTime()));

  return {
    isStale: true,
    clockOutAt,
    durationMinutes: durationMinutesBetween(clockInAt, clockOutAt),
  };
}

/**
 * User-initiated clock-out: keep real overnight work, but still cap runaway timers (>12h).
 */
export function resolveUserClockOut(clockInAt: string, now = new Date()): ShiftCloseResolution {
  const clockInMs = new Date(clockInAt).getTime();
  if (!Number.isFinite(clockInMs)) {
    return { isStale: true, clockOutAt: now, durationMinutes: 0 };
  }

  const elapsedMs = now.getTime() - clockInMs;
  if (elapsedMs <= ORPHAN_SHIFT_CAP_MS) {
    return {
      isStale: false,
      clockOutAt: now,
      durationMinutes: durationMinutesBetween(clockInAt, now),
    };
  }

  const capAt = new Date(clockInMs + ORPHAN_SHIFT_CAP_MS);
  const endOfDay = endOfZonedDay(new Date(clockInMs));
  const clockOutAt = new Date(Math.min(now.getTime(), capAt.getTime(), endOfDay.getTime()));
  return {
    isStale: true,
    clockOutAt,
    durationMinutes: durationMinutesBetween(clockInAt, clockOutAt),
  };
}

export function durationMinutesFromRange(clockInAt: string, clockOutAt: string | Date): number {
  const out = clockOutAt instanceof Date ? clockOutAt : new Date(clockOutAt);
  return durationMinutesBetween(clockInAt, out);
}
