import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import {
  type ReportingTimeframe,
  resolveReportingRange,
} from "@/lib/reportingPeriod";
import { getAdminAreaAuth } from "@/lib/server/getAdminAreaAuth";
import { isTestTaskRow } from "@/lib/testTaskFilter";

export const dynamic = "force-dynamic";

type TaskRow = Record<string, unknown>;

type Metrics = {
  averageEditTimeMinutes: number;
  averageTotalTimeMinutes: number;
  totalBookings: number;
  totalNetRevenue: number;
  totalTaxes: number;
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

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function parseTimeframe(value: string | null): ReportingTimeframe | null {
  if (value === "day" || value === "month" || value === "year" || value === "custom") {
    return value;
  }
  return null;
}

function buildMetrics(rows: TaskRow[]): Metrics {
  const editMinutes = rows.map(deriveEditMinutes).filter((value): value is number => value !== null);
  const totalMinutes = rows.map(deriveTotalMinutes).filter((value): value is number => value !== null);
  const financials = rows.map(deriveFinancials);
  return {
    averageEditTimeMinutes: average(editMinutes),
    averageTotalTimeMinutes: average(totalMinutes),
    totalBookings: rows.length,
    totalNetRevenue: financials.reduce((sum, value) => sum + value.net, 0),
    totalTaxes: financials.reduce((sum, value) => sum + value.tax, 0),
  };
}

export async function GET(request: Request) {
  const auth = await getAdminAreaAuth();
  if (!auth.authenticated || !auth.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const timeframe = parseTimeframe(searchParams.get("timeframe")) ?? "month";
  const monthParam = searchParams.get("month");
  const yearParam = searchParams.get("year");
  const selectedMonthValue =
    monthParam && yearParam && Number.isInteger(Number(monthParam)) && Number.isInteger(Number(yearParam))
      ? `${yearParam}-${String(Number(monthParam)).padStart(2, "0")}`
      : undefined;

  const range = resolveReportingRange({
    timeframe,
    selectedDayDate: searchParams.get("dayDate") ?? undefined,
    selectedMonthValue,
    customStartDate: searchParams.get("customStartDate") ?? undefined,
    customEndDate: searchParams.get("customEndDate") ?? undefined,
  });

  if (!range) {
    return NextResponse.json({ error: "Invalid reporting period parameters." }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) {
    return NextResponse.json({ error: "Supabase credentials are not configured." }, { status: 503 });
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase
    .from("tasks")
    .select("*");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const rows = ((data ?? []) as TaskRow[]).filter((row) => {
    if (isTestTaskRow(row)) {
      return false;
    }
    const shootDate = parseDate(row.photoshoot_date);
    if (!shootDate) {
      return false;
    }
    return shootDate >= range.start && shootDate <= range.end;
  });

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    timeframe,
    range: {
      start: range.start.toISOString(),
      end: range.end.toISOString(),
      subtitle: range.subtitle,
      label: range.label,
    },
    metrics: buildMetrics(rows),
  });
}
