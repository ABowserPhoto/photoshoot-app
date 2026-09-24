export const MAX_DURATION_SECONDS = 9_999 * 3600 + 59 * 60 + 59;

/** Format whole seconds as `HH:MM:SS` (e.g. `01:45:30`). */
export function formatDurationHms(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function clampSeconds(value: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.min(MAX_DURATION_SECONDS, Math.round(value));
}

/**
 * Translate human-readable duration text into whole seconds.
 * Accepts `01:45:30`, `12:30`, `1h 12m 30s`, `12m 30s`, `90m`, `45s`, or a bare integer (seconds).
 * Returns `null` when the input cannot be parsed.
 */
export function parseHumanDurationToSeconds(input: string): number | null {
  const raw = input.trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  if (!raw) return null;

  if (/^\d{1,5}:\d{1,2}(:\d{1,2})?$/.test(raw)) {
    const parts = raw.split(":").map((part) => Number.parseInt(part, 10));
    if (parts.some((part) => !Number.isFinite(part) || part < 0)) return null;
    if (parts.length === 3) {
      const [hours, minutes, seconds] = parts as [number, number, number];
      if (minutes > 59 || seconds > 59) return null;
      return clampSeconds(hours * 3600 + minutes * 60 + seconds);
    }
    const [minutes, seconds] = parts as [number, number];
    if (seconds > 59) return null;
    return clampSeconds(minutes * 60 + seconds);
  }

  if (/^\d+$/.test(raw)) {
    return clampSeconds(Number.parseInt(raw, 10));
  }

  const unitRe = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/g;
  const leftover = raw.replace(unitRe, "").trim();
  if (leftover) return null;

  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  let matched = false;
  unitRe.lastIndex = 0;
  for (const match of raw.matchAll(unitRe)) {
    matched = true;
    const value = Number(match[1]);
    const unit = match[2] ?? "";
    if (!Number.isFinite(value) || value < 0) return null;
    if (unit.startsWith("h")) hours += value;
    else if (unit.startsWith("m")) minutes += value;
    else seconds += value;
  }
  if (!matched) return null;
  return clampSeconds(hours * 3600 + minutes * 60 + seconds);
}
