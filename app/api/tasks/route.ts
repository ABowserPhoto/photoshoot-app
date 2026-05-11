import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { getAuthRole } from "@/lib/server/getAuthRole";
import { redactTaskRowForRole } from "@/lib/tasksRedact";
import type { TaskRow } from "@/lib/tasksRedact";

export const dynamic = "force-dynamic";
const TASKS_FETCH_TIMEOUT_MS = Number(process.env.TASKS_FETCH_TIMEOUT_MS ?? "8000");
let cachedRows: TaskRow[] = [];

function withTimeoutFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const signal = init?.signal ?? AbortSignal.timeout(TASKS_FETCH_TIMEOUT_MS);
  return fetch(input, { ...init, signal });
}

export async function GET() {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      {
        error:
          "Supabase client is not configured. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      },
      { status: 503 }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      fetch: withTimeoutFetch,
    },
  });

  try {
    const { data, error } = await supabase
      .from("tasks")
      .select(
        "id, title, company_name, lexoffice_contact_id, contact_first_name, contact_last_name, email, phone, street, zip_code, city, country, services, products, tax_percentage, amount_type, discount, photoshoot_type, shoot_location, photoshoot_date, due_date, editing_started_at, total_editing_seconds, status, is_archived, local_folder_name, bracket_size, cover_image_url"
      )
      .order("id", { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    const rows = (data ?? []) as TaskRow[];
    cachedRows = rows;
    const visible = auth.isAdmin
      ? rows
      : rows.map((row) => redactTaskRowForRole(row, auth.role));

    return NextResponse.json({
      data: visible,
      meta: { role: auth.role, isAdmin: auth.isAdmin, stale: false },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown tasks fetch error.";
    console.error(`[api/tasks] Supabase fetch failed (timeout=${TASKS_FETCH_TIMEOUT_MS}ms):`, message);
    const fallbackRows = cachedRows;
    const visibleFallback = auth.isAdmin
      ? fallbackRows
      : fallbackRows.map((row) => redactTaskRowForRole(row, auth.role));
    return NextResponse.json({
      data: visibleFallback,
      meta: { role: auth.role, isAdmin: auth.isAdmin, stale: true },
      warning:
        fallbackRows.length > 0
          ? "Supabase temporarily unavailable; serving cached tasks."
          : "Supabase temporarily unavailable; returning empty task list.",
    });
  }
}
