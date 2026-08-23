import { NextResponse } from "next/server";

import { getAuthRole } from "@/lib/server/getAuthRole";
import { createRouteSupabaseClient } from "@/lib/server/supabaseServer";
import { redactTaskRowForRole } from "@/lib/tasksRedact";
import type { TaskRow } from "@/lib/tasksRedact";

export const dynamic = "force-dynamic";
const TASKS_FETCH_TIMEOUT_MS = Number(process.env.TASKS_FETCH_TIMEOUT_MS ?? "8000");
let cachedRows: TaskRow[] = [];

const TASK_SELECT_COLUMNS =
  "id, title, company_name, lexoffice_contact_id, contact_first_name, contact_last_name, email, email_cc, phone, street, zip_code, city, country, address_supplement, services, products, tax_percentage, amount_type, discount, photoshoot_type, shoot_location, photoshoot_date, preview_preference, due_date, editing_started_at, total_editing_seconds, status, is_archived, local_folder_name, bracket_size, cover_image_url, completed_at, updated_at, skip_invoice, generate_gallery, is_credit_note, expected_revenue, is_paid, credit_note_paid, credit_note_file_url, has_separate_invoice_email, invoice_email_address, linked_item_id, local_open_path, gallery_link, contact_id";

export async function GET() {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const routeClient = await createRouteSupabaseClient(TASKS_FETCH_TIMEOUT_MS);
  if (!routeClient) {
    return NextResponse.json(
      {
        error:
          "Supabase client is not configured. Check NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY on Vercel.",
      },
      { status: 503 }
    );
  }

  if (routeClient.mode === "session") {
    console.warn(
      "[api/tasks] SUPABASE_SERVICE_ROLE_KEY missing — using cookie session client (RLS applies). Set service role on Vercel for consistent reads."
    );
  }

  const supabase = routeClient.client;

  try {
    const { data, error } = await supabase
      .from("tasks")
      .select(TASK_SELECT_COLUMNS)
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
      meta: {
        role: auth.role,
        isAdmin: auth.isAdmin,
        stale: false,
        supabaseMode: routeClient.mode,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown tasks fetch error.";
    console.error(`[api/tasks] Supabase fetch failed (timeout=${TASKS_FETCH_TIMEOUT_MS}ms):`, message);
    const fallbackRows = cachedRows;
    const visibleFallback = auth.isAdmin
      ? fallbackRows
      : fallbackRows.map((row) => redactTaskRowForRole(row, auth.role));

    if (fallbackRows.length === 0) {
      return NextResponse.json(
        {
          error: `Supabase tasks fetch failed: ${message}`,
          data: [],
          meta: { role: auth.role, isAdmin: auth.isAdmin, stale: true, supabaseMode: routeClient.mode },
          warning: "Supabase temporarily unavailable; returning empty task list.",
        },
        { status: 503 }
      );
    }

    return NextResponse.json({
      data: visibleFallback,
      meta: { role: auth.role, isAdmin: auth.isAdmin, stale: true, supabaseMode: routeClient.mode },
      warning: "Supabase temporarily unavailable; serving cached tasks.",
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

  const { purgeTaskStorage } = await import("@/lib/server/purgeTaskStorage");

  const purgeResult = await purgeTaskStorage(taskId);
  if (!purgeResult.ok) {
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

  const routeClient = await createRouteSupabaseClient(TASKS_FETCH_TIMEOUT_MS);
  if (!routeClient) {
    return NextResponse.json({ error: "Supabase is not configured for deletion." }, { status: 503 });
  }

  const { error: deleteError } = await routeClient.client.from("tasks").delete().eq("id", taskId);
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
