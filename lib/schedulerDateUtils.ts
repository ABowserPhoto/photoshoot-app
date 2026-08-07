export const PAST_SCHEDULE_ERROR = "Cannot schedule posts in the past.";
export const INVALID_SCHEDULE_ERROR = "Invalid scheduled date.";

export function formatScheduledDateTime(date: Date): string {
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  const weekday = date.toLocaleDateString("en-US", { weekday: "long" });
  const day = `${date.getDate()}`.padStart(2, "0");
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const year = date.getFullYear();
  return `${hours}:${minutes} ${weekday} ${day}-${month}-${year}`;
}

export function isScheduledInPast(scheduledAt: Date | null | undefined): boolean {
  if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) {
    return false;
  }
  return scheduledAt.getTime() < Date.now();
}

export function assertFutureScheduledAt(scheduledAt: Date | null | undefined): string | null {
  if (scheduledAt == null) {
    return null;
  }
  if (Number.isNaN(scheduledAt.getTime())) {
    return INVALID_SCHEDULE_ERROR;
  }
  if (isScheduledInPast(scheduledAt)) {
    return PAST_SCHEDULE_ERROR;
  }
  return null;
}

export function getTodayDateInput(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = `${now.getMonth() + 1}`.padStart(2, "0");
  const d = `${now.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Value for `<input type="datetime-local" min={...} />`. */
export function minDateTimeLocalValue(date = new Date()): string {
  const copy = new Date(date);
  copy.setSeconds(0, 0);
  const y = copy.getFullYear();
  const m = `${copy.getMonth() + 1}`.padStart(2, "0");
  const d = `${copy.getDate()}`.padStart(2, "0");
  const h = `${copy.getHours()}`.padStart(2, "0");
  const min = `${copy.getMinutes()}`.padStart(2, "0");
  return `${y}-${m}-${d}T${h}:${min}`;
}

export function dateToDateTimeLocalValue(date: Date): string {
  return minDateTimeLocalValue(date);
}

/**
 * Parse `<input type="datetime-local">` values as local wall-clock time.
 * Avoids `new Date("YYYY-MM-DDTHH:mm")` engine quirks (UTC vs local).
 */
export function dateTimeLocalValueToDate(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const match = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/
  );
  if (!match) {
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? "0");
  const parsed = new Date(year, month - 1, day, hour, minute, second, 0);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
