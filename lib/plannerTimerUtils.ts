export function getPlannerElapsedSeconds(
  elapsedSeconds: number,
  startedAtSec: number | null,
  nowSec: number
): number {
  if (!startedAtSec) {
    return Math.max(0, elapsedSeconds);
  }
  return Math.max(0, elapsedSeconds + Math.max(0, nowSec - startedAtSec));
}

export function formatPlannerDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  return `${hours}h ${minutes}m`;
}
