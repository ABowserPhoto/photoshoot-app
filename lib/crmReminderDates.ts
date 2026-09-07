export function normalizeReminderDates(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const dates: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !entry.trim()) {
      continue;
    }
    const parsed = new Date(entry);
    if (Number.isNaN(parsed.getTime())) {
      continue;
    }
    dates.push(parsed.toISOString());
  }

  dates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
  return dates;
}

export function formatReminderDateLabel(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

export function formatReminderDatesTooltip(dates: string[]): string {
  const labels = normalizeReminderDates(dates).map(formatReminderDateLabel);
  if (labels.length === 0) {
    return "";
  }
  return `Reminders drafted: ${labels.join(", ")}`;
}
