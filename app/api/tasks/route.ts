import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { getAuthRole } from "@/lib/server/getAuthRole";
import { fetchWithTimeout } from "@/lib/server/fetchWithTimeout";
import { purgeTaskStorage } from "@/lib/server/purgeTaskStorage";
import { redactTaskRowForRole } from "@/lib/tasksRedact";
import type { TaskRow } from "@/lib/tasksRedact";

export const dynamic = "force-dynamic";
const TASKS_FETCH_TIMEOUT_MS = Number(process.env.TASKS_FETCH_TIMEOUT_MS ?? "8000");
let cachedRows: TaskRow[] = [];

function getDeleteClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const key = supabaseServiceRoleKey || supabaseAnonKey;
  if (!supabaseUrl || !key) {
    return null;
  }
  return createClient(supabaseUrl, key, {
    auth: { persistSession: false },
    global: {
      fetch: (input, init) => fetchWithTimeout(input, init, TASKS_FETCH_TIMEOUT_MS),
    },
  });
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
      fetch: (input, init) => fetchWithTimeout(input, init, TASKS_FETCH_TIMEOUT_MS),
    },
  });

  try {
    const { data, error } = await supabase
      .from("tasks")
      .select(
        "id, title, company_name, lexoffice_contact_id, contact_first_name, contact_last_name, email, email_cc, phone, street, zip_code, city, country, address_supplement, services, products, tax_percentage, amount_type, discount, photoshoot_type, shoot_location, photoshoot_date, preview_preference, due_date, editing_started_at, total_editing_seconds, status, is_archived, local_folder_name, bracket_size, cover_image_url, completed_at, updated_at, skip_invoice, is_credit_note, expected_revenue, is_paid, linked_item_id, local_open_path, gallery_link, contact_id"
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

export async function DELETE(request: Request) {
  const auth = await getAuthRole();
  if (!auth.authenticated || !auth.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const fromQuery = url.searchParams.get("taskId")?.trim() ?? "";
  const body = (await request.json().catch(() => null)) as { taskId?: unknown } | null;
  const fromBody = typeof body?.taskId === "string" ? body.taskId.trim() : "";
  const taskId = fromBody || fromQuery;

  if (!taskId) {
    return NextResponse.json({ error: "taskId is required." }, { status: 400 });
  }

  // Best-effort storage purge — orphaned files are logged but never block deletion.
  const purgeResult = await purgeTaskStorage(taskId);
  if (!purgeResult.ok) {
    // purgeTaskStorage only returns ok:false when Supabase credentials are missing entirely.
    return NextResponse.json(
      { error: purgeResult.error || "Supabase storage is not configured." },
      { status: 503 }
    );
  }

  if ((purgeResult.remainingCount ?? 0) > 0) {
    console.warn(
      `[DELETE /api/tasks] Task ${taskId}: storage purge left ${purgeResult.remainingCount} orphaned file(s). Proceeding with DB deletion.`,
      purgeResult.remainingPaths
    );
  }

  const supabase = getDeleteClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured for deletion." }, { status: 503 });
  }

  const { error: deleteError } = await supabase.from("tasks").delete().eq("id", taskId);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    taskId,
    removedCount: purgeResult.removedCount,
    buckets: purgeResult.buckets,
    ...(purgeResult.remainingCount ? { orphanedFiles: purgeResult.remainingCount } : {}),
  });
}
