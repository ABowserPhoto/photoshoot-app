import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { getAuthRole } from "@/lib/server/getAuthRole";

export const dynamic = "force-dynamic";

function serviceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const key = serviceKey || anonKey;
  if (!url || !key) {
    return null;
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET() {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = serviceSupabase();
  if (!sb) {
    return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  }

  const { data, error } = await sb.from("studio_tasks").select("*").order("order_index", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? [] });
}

type CreatePlannerTaskBody = {
  title?: unknown;
  description?: unknown;
  status?: unknown;
  assigned_to?: unknown;
  due_date?: unknown;
  label?: unknown;
  recurring_type?: unknown;
  client_name?: unknown;
  total_fee?: unknown;
};

function toNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().replace(",", ".");
    if (!normalized) {
      return null;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export async function POST(request: Request) {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = serviceSupabase();
  if (!sb) {
    return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  }

  let body: CreatePlannerTaskBody;
  try {
    body = (await request.json()) as CreatePlannerTaskBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const title = toNullableString(body.title) ?? "Untitled Task";
  const description = toNullableString(body.description) ?? "";
  const status = toNullableString(body.status) ?? "master";
  const assignedTo = toNullableString(body.assigned_to);
  const dueDate = toNullableString(body.due_date);
  const label = toNullableString(body.label);
  const recurringType = toNullableString(body.recurring_type) ?? "none";
  const clientName = toNullableString(body.client_name);
  const totalFee = toNullableNumber(body.total_fee);

  const { data, error } = await sb
    .from("studio_tasks")
    .insert({
      title,
      description,
      status,
      assigned_to: assignedTo,
      due_date: dueDate,
      label,
      recurring_type: recurringType,
      client_name: clientName,
      total_fee: totalFee,
      elapsed_seconds: 0,
      started_at: null,
      total_time_label: null,
      completed_at: null,
      order_index: 999999,
      is_auto_generated: false,
      photoshoot_id: null,
      subtasks: [],
      assigned_users: [],
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, data });
}
