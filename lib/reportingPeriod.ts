export type ReportingTimeframe = "day" | "month" | "year" | "custom";

export type ReportingPeriodInput = {
  timeframe: ReportingTimeframe;
  selectedDayDate?: string;
  selectedMonthValue?: string;
  customStartDate?: string;
  customEndDate?: string;
};

export type ResolvedReportingRange = {
  start: Date;
  end: Date;
  subtitle: string;
  label: string;
};

function parseDateInput(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const [year, month, day] = value.split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  const parsed = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }
  return parsed;
}

function parseMonthValue(value: string): { month: number; year: number } | null {
  if (!/^\d{4}-\d{2}$/.test(value)) {
    return null;
  }
  const [year, month] = value.split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }
  return { month, year };
}

function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function endOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

function formatDateLabel(value: string): string {
  const parsed = parseDateInput(value);
  if (!parsed) {
    return "";
  }
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

function formatShortRange(start: Date, end: Date): string {
  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();
  if (sameDay) {
    return formatDateLabel(
      `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`
    );
  }

  const sameMonthAndYear =
    start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth();
  if (sameMonthAndYear) {
    const monthLabel = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" }).format(start);
    return `${String(start.getDate()).padStart(2, "0")}–${String(end.getDate()).padStart(2, "0")} ${monthLabel}`;
  }

  const startLabel = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(start);
  const endLabel = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(end);
  return `${startLabel} – ${endLabel}`;
}

export function resolveReportingRange(input: ReportingPeriodInput): ResolvedReportingRange | null {
  const { timeframe } = input;

  if (timeframe === "day") {
    const dayAnchor = parseDateInput(input.selectedDayDate?.trim() ?? "");
    if (!dayAnchor) {
      return null;
    }
    const start = startOfDay(dayAnchor);
    const end = endOfDay(dayAnchor);
    const label = formatDateLabel(input.selectedDayDate!.trim());
    return { start, end, subtitle: label, label };
  }

  if (timeframe === "month") {
    const parsed =
      parseMonthValue(input.selectedMonthValue?.trim() ?? "") ?? {
        month: new Date().getMonth() + 1,
        year: new Date().getFullYear(),
      };
    const start = new Date(parsed.year, parsed.month - 1, 1, 0, 0, 0, 0);
    const end = new Date(parsed.year, parsed.month, 0, 23, 59, 59, 999);
    const label = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(
      new Date(parsed.year, parsed.month - 1, 1)
    );
    return { start, end, subtitle: label, label };
  }

  if (timeframe === "year") {
    const parsed =
      parseMonthValue(input.selectedMonthValue?.trim() ?? "") ?? {
        month: new Date().getMonth() + 1,
        year: new Date().getFullYear(),
      };
    const start = new Date(parsed.year, 0, 1, 0, 0, 0, 0);
    const end = new Date(parsed.year, 11, 31, 23, 59, 59, 999);
    const label = String(parsed.year);
    return { start, end, subtitle: `Jan–Dec ${parsed.year}`, label };
  }

  const startAnchor = parseDateInput(input.customStartDate?.trim() ?? "");
  const endAnchor = parseDateInput(input.customEndDate?.trim() ?? "");
  if (!startAnchor || !endAnchor) {
    return null;
  }
  const start = startOfDay(startAnchor);
  const end = endOfDay(endAnchor);
  if (start.getTime() > end.getTime()) {
    return null;
  }
  const label = formatShortRange(start, end);
  return { start, end, subtitle: label, label };
}

export function formatReportingPeriodLabel(input: ReportingPeriodInput): string {
  const resolved = resolveReportingRange(input);
  return resolved?.label ?? "selected period";
}

export function isDateWithinReportingRange(
  value: string | Date | null | undefined,
  range: ResolvedReportingRange
): boolean {
  if (!value) {
    return false;
  }

  let date: Date;
  if (value instanceof Date) {
    date = value;
  } else {
    const fromDateInput = parseDateInput(value);
    date = fromDateInput ?? new Date(value);
  }

  if (Number.isNaN(date.getTime())) {
    return false;
  }
  return date >= range.start && date <= range.end;
}

export function buildAdminStatsQuery(input: ReportingPeriodInput): string {
  const params = new URLSearchParams();
  params.set("timeframe", input.timeframe);

  if (input.timeframe === "day" && input.selectedDayDate?.trim()) {
    params.set("dayDate", input.selectedDayDate.trim());
  }

  if ((input.timeframe === "month" || input.timeframe === "year") && input.selectedMonthValue?.trim()) {
    const parsed = parseMonthValue(input.selectedMonthValue.trim());
    if (parsed) {
      params.set("month", String(parsed.month));
      params.set("year", String(parsed.year));
    }
  }

  if (input.timeframe === "custom") {
    if (input.customStartDate?.trim()) {
      params.set("customStartDate", input.customStartDate.trim());
    }
    if (input.customEndDate?.trim()) {
      params.set("customEndDate", input.customEndDate.trim());
    }
  }

  const query = params.toString();
  return query ? `?${query}` : "";
}
