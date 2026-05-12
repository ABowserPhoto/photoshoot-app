export function formatDurationLong(totalMinutes: number): string {
  const safeMinutes = Math.max(0, Math.floor(Number(totalMinutes) || 0));
  const days = Math.floor(safeMinutes / (24 * 60));
  const hours = Math.floor((safeMinutes % (24 * 60)) / 60);
  const minutes = safeMinutes % 60;
  return `${days} days, ${hours} hours, ${minutes} minutes`;
}

export function formatEuro(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safe);
}
