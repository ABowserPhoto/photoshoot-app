import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { getAuthRole } from "@/lib/server/getAuthRole";

export const dynamic = "force-dynamic";

type TimeframeKey = "week" | "month" | "year" | "lastYear";

type TaskRow = Record<string, unknown>;

type Metrics = {
  averageEditTimeMinutes: number;
  averageTotalTimeMinutes: number;
  totalBookings: number;
  totalNetRevenue: number;
  totalTaxes: number;
};

type DateRangePayload = {
  start: string;
  end: string;
  subtitle: string;
};

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfWeek(date: Date): Date {
  const result = new Date(date);
  const day = result.getDay();
  const diffToMonday = (day + 6) % 7;
  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() - diffToMonday);
  return result;
}

function endOfWeek(date: Date): Date {
  const start = startOfWeek(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

function startOfYear(year: number): Date {
  return new Date(year, 0, 1, 0, 0, 0, 0);
}

function endOfYear(year: number): Date {
  return new Date(year, 11, 31, 23, 59, 59, 999);
}

function formatShortRange(start: Date, end: Date, key: TimeframeKey): string {
  if (key === "month") {
    return new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" }).format(start);
  }
  if (key === "year" || key === "lastYear") {
    return `Jan-Dec ${start.getFullYear()}`;
  }

  const sameMonthAndYear =
    start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth();
  if (sameMonthAndYear) {
    const monthLabel = new Intl.DateTimeFormat("en-GB", { month: "short" }).format(start);
    return `${String(start.getDate()).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")} ${monthLabel}`;
  }
  const startLabel = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" }).format(start);
  const endLabel = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" }).format(end);
  return `${startLabel}-${endLabel}`;
}

function buildRangePayload(start: Date, end: Date, key: TimeframeKey): DateRangePayload {
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    subtitle: formatShortRange(start, end, key),
  };
}

function parseMonthYearParams(
  monthParam: string | null,
  yearParam: string | null
): { month: number; year: number } | null {
  const month = Number(monthParam);
  const year = Number(yearParam);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return null;
  }
  return { month, year };
}

function resolveReferenceDate(monthParam: string | null, yearParam: string | null): Date {
  const parsed = parseMonthYearParams(monthParam, yearParam);
  if (parsed) {
    return new Date(parsed.year, parsed.month - 1, 1, 12, 0, 0, 0);
  }
  return new Date();
}

function isInReferenceWeek(shootDate: Date, reference: Date): boolean {
  const weekStart = startOfWeek(reference);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  return shootDate >= weekStart && shootDate < weekEnd;
}

function isInReferenceMonth(shootDate: Date, reference: Date): boolean {
  return (
    shootDate.getFullYear() === reference.getFullYear() && shootDate.getMonth() === reference.getMonth()
  );
}

function isInReferenceYear(shootDate: Date, reference: Date): boolean {
  return shootDate.getFullYear() === reference.getFullYear();
}

function isInYearBeforeReference(shootDate: Date, reference: Date): boolean {
  return shootDate.getFullYear() === reference.getFullYear() - 1;
}

function parseLineItems(value: unknown): Array<{ quantity: number; price: number }> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const row = item as Record<string, unknown>;
      const quantity = toNumber(row.quantity) ?? 0;
      const price = toNumber(row.price) ?? 0;
      return { quantity, price };
    })
    .filter((item): item is { quantity: number; price: number } => item !== null);
}

function sumLineItems(items: Array<{ quantity: number; price: number }>): number {
  return items.reduce((sum, item) => sum + item.quantity * item.price, 0);
}

function deriveFinancials(row: TaskRow): { net: number; tax: number } {
  const explicitNet = toNumber(row.net_revenue);
  const explicitTax = toNumber(row.tax_amount);
  if (explicitNet !== null || explicitTax !== null) {
    return { net: explicitNet ?? 0, tax: explicitTax ?? 0 };
  }

  const services = parseLineItems(row.services);
  const products = parseLineItems(row.products);
  const subtotal = sumLineItems(services) + sumLineItems(products);
  const discount = toNumber(row.discount) ?? 0;
  const taxRate = (toNumber(row.tax_percentage) ?? 0) / 100;
  const amountType = String(row.amount_type ?? "Net").toLowerCase();
  const adjusted = Math.max(0, subtotal - discount);

  if (amountType === "gross") {
    const net = taxRate > 0 ? adjusted / (1 + taxRate) : adjusted;
    return { net, tax: Math.max(0, adjusted - net) };
  }

  const net = adjusted;
  return { net, tax: Math.max(0, net * taxRate) };
}

function deriveEditMinutes(row: TaskRow): number | null {
  const fromAccumulator = toNumber(row.total_editing_seconds);
  if (fromAccumulator !== null && fromAccumulator > 0) {
    return fromAccumulator / 60;
  }

  const startedAt = parseDate(row.editing_started_at);
  const readyForReviewAt = parseDate(row.ready_for_review_at);
  const completedAt = parseDate(row.completed_at);
  const updatedAt = parseDate(row.updated_at);
  const end = readyForReviewAt ?? completedAt ?? updatedAt;
  if (!startedAt || !end || end.getTime() < startedAt.getTime()) {
    return null;
  }
  return (end.getTime() - startedAt.getTime()) / 60000;
}

function deriveTotalMinutes(row: TaskRow): number | null {
  const startedAt = parseDate(row.created_at);
  const completedAt = parseDate(row.completed_at) ?? parseDate(row.updated_at);
  const status = String(row.status ?? "").trim().toLowerCase();
  if (!startedAt || !completedAt || completedAt.getTime() < startedAt.getTime()) {
    return null;
  }
  if (status !== "completed" && status !== "send email" && status !== "send-email") {
    return null;
  }
  return (completedAt.getTime() - startedAt.getTime()) / 60000;
}

function emptyMetrics(): Metrics {
  return {
    averageEditTimeMinutes: 0,
    averageTotalTimeMinutes: 0,
    totalBookings: 0,
    totalNetRevenue: 0,
    totalTaxes: 0,
  };
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export async function GET(request: Request) {
  const auth = await getAuthRole();
  if (!auth.authenticated || !auth.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const monthParam = searchParams.get("month");
  const yearParam = searchParams.get("year");
  const selectedPeriod = parseMonthYearParams(monthParam, yearParam);
  const referenceDate = resolveReferenceDate(monthParam, yearParam);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) {
    return NextResponse.json({ error: "Supabase credentials are not configured." }, { status: 503 });
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .not("title", "ilike", "%test%")
    .not("company_name", "ilike", "%test%")
    .not("client", "ilike", "%test%");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const rows = (data ?? []) as TaskRow[];
  const referenceYear = referenceDate.getFullYear();
  const ranges: Record<TimeframeKey, DateRangePayload> = {
    week: buildRangePayload(startOfWeek(referenceDate), endOfWeek(referenceDate), "week"),
    month: buildRangePayload(startOfMonth(referenceDate), endOfMonth(referenceDate), "month"),
    year: buildRangePayload(startOfYear(referenceYear), endOfYear(referenceYear), "year"),
    lastYear: buildRangePayload(
      startOfYear(referenceYear - 1),
      endOfYear(referenceYear - 1),
      "lastYear"
    ),
  };
  const buckets: Record<TimeframeKey, TaskRow[]> = {
    week: [],
    month: [],
    year: [],
    lastYear: [],
  };

  for (const row of rows) {
    const shootDate = parseDate(row.photoshoot_date);
    if (!shootDate) {
      continue;
    }
    if (isInReferenceWeek(shootDate, referenceDate)) buckets.week.push(row);
    if (isInReferenceMonth(shootDate, referenceDate)) buckets.month.push(row);
    if (isInReferenceYear(shootDate, referenceDate)) buckets.year.push(row);
    if (isInYearBeforeReference(shootDate, referenceDate)) buckets.lastYear.push(row);
  }

  const metricsByBucket = (Object.keys(buckets) as TimeframeKey[]).reduce<Record<TimeframeKey, Metrics>>(
    (acc, key) => {
      const bucketRows = buckets[key];
      const editMinutes = bucketRows.map(deriveEditMinutes).filter((value): value is number => value !== null);
      const totalMinutes = bucketRows.map(deriveTotalMinutes).filter((value): value is number => value !== null);
      const financials = bucketRows.map(deriveFinancials);
      acc[key] = {
        averageEditTimeMinutes: average(editMinutes),
        averageTotalTimeMinutes: average(totalMinutes),
        totalBookings: bucketRows.length,
        totalNetRevenue: financials.reduce((sum, value) => sum + value.net, 0),
        totalTaxes: financials.reduce((sum, value) => sum + value.tax, 0),
      };
      return acc;
    },
    {
      week: emptyMetrics(),
      month: emptyMetrics(),
      year: emptyMetrics(),
      lastYear: emptyMetrics(),
    }
  );

  const monthLabel = new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
  }).format(referenceDate);
  const isCurrentMonth =
    referenceDate.getFullYear() === new Date().getFullYear() &&
    referenceDate.getMonth() === new Date().getMonth();

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    selectedMonth: selectedPeriod?.month ?? referenceDate.getMonth() + 1,
    selectedYear: selectedPeriod?.year ?? referenceYear,
    labels: {
      week: isCurrentMonth ? "This Week" : `Week of ${ranges.week.subtitle}`,
      month: isCurrentMonth ? "This Month" : monthLabel,
      year: String(referenceYear),
      lastYear: String(referenceYear - 1),
    },
    ranges,
    metrics: metricsByBucket,
  });
}
