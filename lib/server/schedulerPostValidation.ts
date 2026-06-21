import { assertFutureScheduledAt } from "@/lib/schedulerDateUtils";

export function parseScheduledAtInput(value: unknown): Date | null {
  if (value == null || value === "") {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function validateScheduledAtOrError(value: unknown): { ok: true; scheduledAt: Date | null } | { ok: false; error: string } {
  const scheduledAt = parseScheduledAtInput(value);
  if (value != null && value !== "" && scheduledAt == null) {
    return { ok: false, error: "Invalid scheduled date." };
  }
  const futureError = assertFutureScheduledAt(scheduledAt);
  if (futureError) {
    return { ok: false, error: futureError };
  }
  return { ok: true, scheduledAt };
}
