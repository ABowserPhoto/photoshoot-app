import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getAuthRole } from "@/lib/server/getAuthRole";
import { isStudioTaskUnassigned, isUserOnStudioTask } from "@/lib/plannerAssignees";

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

async function getSessionUserId(): Promise<string | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }
  const cookieStore = await cookies();
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {
        // No-op on route reads.
      },
    },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function GET(request: Request) {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = serviceSupabase();
  if (!sb) {
    return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  }

  const userId = await getSessionUserId();
  const url = new URL(request.url);
  const assigneeFilter = url.searchParams.get("assignee")?.trim() || null;

  const { data, error } = await sb.from("studio_tasks").select("*").order("order_index", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let rows = (data ?? []) as Array<Record<string, unknown>>;

  // Non-admins see: their assigned tasks + fully unassigned tasks (+ templates).
  // Admins see all, optionally filtered by ?assignee=<profileId> (unassigned always included).
  if (!auth.isAdmin) {
    if (!userId) {
      rows = rows.filter((row) => {
        if (String(row.status ?? "").toLowerCase() === "template") return true;
        return isStudioTaskUnassigned({
          assignedTo: typeof row.assigned_to === "string" ? row.assigned_to : null,
          assignedUsers: row.assigned_users,
        });
      });
    } else {
      rows = rows.filter((row) => {
        if (String(row.status ?? "").toLowerCase() === "template") return true;
        if (
          isStudioTaskUnassigned({
            assignedTo: typeof row.assigned_to === "string" ? row.assigned_to : null,
            assignedUsers: row.assigned_users,
          })
        ) {
          return true;
        }
        return isUserOnStudioTask({
          userId,
          assignedTo: typeof row.assigned_to === "string" ? row.assigned_to : null,
          assignedUsers: row.assigned_users,
        });
      });
    }
  } else if (assigneeFilter && assigneeFilter !== "all") {
    rows = rows.filter((row) => {
      if (String(row.status ?? "").toLowerCase() === "template") return true;
      if (
        isStudioTaskUnassigned({
          assignedTo: typeof row.assigned_to === "string" ? row.assigned_to : null,
          assignedUsers: row.assigned_users,
        })
      ) {
        return true;
      }
      const matchesFilter = isUserOnStudioTask({
        userId: assigneeFilter,
        assignedTo: typeof row.assigned_to === "string" ? row.assigned_to : null,
        assignedUsers: row.assigned_users,
      });
      // Keep the admin's own tasks visible so their timer widget stays correct.
      const matchesSelf =
        Boolean(userId) &&
        isUserOnStudioTask({
          userId,
          assignedTo: typeof row.assigned_to === "string" ? row.assigned_to : null,
          assignedUsers: row.assigned_users,
        });
      return matchesFilter || matchesSelf;
    });
  }

  return NextResponse.json({ data: rows, userId, isAdmin: auth.isAdmin });
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

type PatchPlannerTaskBody = {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  status?: unknown;
  file_path?: unknown;
  file_locations?: unknown;
  folder_path?: unknown;
  location?: unknown;
  pause_reason?: unknown;
  elapsed_seconds?: unknown;
  started_at?: unknown;
  total_time_label?: unknown;
  completed_at?: unknown;
  due_date?: unknown;
  recurring_type?: unknown;
  subtasks?: unknown;
  assigned_users?: unknown;
  label?: unknown;
  assigned_to?: unknown;
  client_name?: unknown;
  total_fee?: unknown;
};

function normalizeFileLocations(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const normalized = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const entry of normalized) {
    if (seen.has(entry)) {
      continue;
    }
    seen.add(entry);
    unique.push(entry);
  }
  return unique.length > 0 ? unique : null;
}

function isMissingColumnError(
  error: { message?: string | null; code?: string | null } | null,
  column: string
): boolean {
  if (!error) {
    return false;
  }
  const message = String(error.message ?? "").toLowerCase();
  const code = String(error.code ?? "").toLowerCase();
  return message.includes(column.toLowerCase()) && (message.includes("column") || code === "pgrst204");
}

export async function PATCH(request: Request) {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = serviceSupabase();
  if (!sb) {
    return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  }

  let body: PatchPlannerTaskBody;
  try {
    body = (await request.json()) as PatchPlannerTaskBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const taskId = typeof body.id === "string" ? body.id.trim() : "";
  if (!taskId) {
    return NextResponse.json({ error: "Task id is required." }, { status: 400 });
  }

  const payload: Record<string, unknown> = {};

  if (body.title !== undefined) {
    payload.title = toNullableString(body.title) ?? "Untitled Task";
  }
  if (body.description !== undefined) {
    payload.description = toNullableString(body.description) ?? "";
  }
  if (body.status !== undefined) {
    payload.status = toNullableString(body.status) ?? "master";
  }
  if (body.pause_reason !== undefined) {
    payload.pause_reason = toNullableString(body.pause_reason);
  }
  if (body.started_at !== undefined) {
    payload.started_at = toNullableString(body.started_at);
  }
  if (body.total_time_label !== undefined) {
    payload.total_time_label = toNullableString(body.total_time_label);
  }
  if (body.completed_at !== undefined) {
    payload.completed_at = body.completed_at === null ? null : toNullableString(body.completed_at);
  }
  if (body.due_date !== undefined) {
    payload.due_date = body.due_date === null ? null : toNullableString(body.due_date);
  }
  if (body.recurring_type !== undefined) {
    payload.recurring_type = toNullableString(body.recurring_type) ?? "none";
  }
  if (body.label !== undefined) {
    payload.label = toNullableString(body.label);
  }
  if (body.assigned_to !== undefined) {
    payload.assigned_to = toNullableString(body.assigned_to);
  }
  if (body.client_name !== undefined) {
    payload.client_name = toNullableString(body.client_name);
  }
  if (body.total_fee !== undefined) {
    payload.total_fee = toNullableNumber(body.total_fee);
  }
  if (body.elapsed_seconds !== undefined) {
    payload.elapsed_seconds = toNullableNumber(body.elapsed_seconds) ?? 0;
  }
  if (body.subtasks !== undefined) {
    payload.subtasks = Array.isArray(body.subtasks) ? body.subtasks : [];
  }
  if (body.assigned_users !== undefined) {
    payload.assigned_users = Array.isArray(body.assigned_users) ? body.assigned_users : [];
  }

  const folderPath =
    typeof body.folder_path === "string"
      ? body.folder_path.trim()
      : typeof body.location === "string"
        ? body.location.trim()
        : "";
  if (body.file_locations !== undefined) {
    payload.file_locations = normalizeFileLocations(body.file_locations);
  } else if (folderPath) {
    payload.file_locations = [folderPath];
  }
  if (body.file_path !== undefined) {
    payload.file_path = toNullableString(body.file_path);
  } else if (folderPath) {
    payload.file_path = folderPath;
  } else if (payload.file_locations && Array.isArray(payload.file_locations) && payload.file_locations[0]) {
    payload.file_path = payload.file_locations[0];
  }

  if (Object.keys(payload).length === 0) {
    return NextResponse.json({ error: "No fields to update." }, { status: 400 });
  }

  let { data, error } = await sb.from("studio_tasks").update(payload).eq("id", taskId).select("*").single();
  if (error) {
    const fallbackPayload = { ...payload };
    let changed = false;
    for (const column of ["file_locations", "editor_id"] as const) {
      if (column in fallbackPayload && isMissingColumnError(error, column)) {
        delete fallbackPayload[column];
        changed = true;
      }
    }
    if (changed) {
      const fallbackResult = await sb
        .from("studio_tasks")
        .update(fallbackPayload)
        .eq("id", taskId)
        .select("*")
        .single();
      data = fallbackResult.data;
      error = fallbackResult.error;
    }
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, data });
}
