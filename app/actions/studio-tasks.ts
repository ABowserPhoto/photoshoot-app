"use server";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { getAuthRole } from "@/lib/server/getAuthRole";

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
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Cookie writes can fail in non-mutable contexts; session read still works.
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user?.id ?? null;
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
  const columnNeedle = column.toLowerCase();
  return message.includes(columnNeedle) && (message.includes("column") || code === "pgrst204");
}

function normalizePlannerFileLocations(value: unknown): string[] | null {
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

function normalizePlannerFileFields(extra: Record<string, unknown>): Record<string, unknown> {
  const next = { ...extra };

  const folderPath =
    typeof next.folder_path === "string"
      ? next.folder_path.trim()
      : typeof next.location === "string"
        ? next.location.trim()
        : "";
  delete next.folder_path;
  delete next.location;

  if (folderPath && next.file_path == null && next.file_locations == null) {
    next.file_locations = [folderPath];
    next.file_path = folderPath;
  }

  if ("file_locations" in next) {
    next.file_locations = normalizePlannerFileLocations(next.file_locations);
    if (next.file_path == null && Array.isArray(next.file_locations) && next.file_locations[0]) {
      next.file_path = next.file_locations[0];
    }
  }

  if ("file_path" in next) {
    const trimmed = typeof next.file_path === "string" ? next.file_path.trim() : "";
    next.file_path = trimmed || null;
  }

  return next;
}

export async function updateStudioTaskStatus(
  taskId: string,
  newStatus: string,
  extra?: Record<string, unknown>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return { ok: false, error: "Unauthorized" };
  }

  const sb = serviceSupabase();
  if (!sb) {
    return { ok: false, error: "Database is not configured." };
  }

  const id = taskId.trim();
  if (!id) {
    return { ok: false, error: "Missing task id." };
  }

  const status = newStatus.trim();
  if (!status) {
    return { ok: false, error: "Missing status." };
  }

  let payload: Record<string, unknown> = {
    status,
    ...normalizePlannerFileFields(extra ?? {}),
  };

  if (status.toLowerCase() === "completed") {
    const editorId = await getSessionUserId();
    if (editorId) {
      payload = { ...payload, editor_id: editorId };
    }
  }

  let { error } = await sb.from("studio_tasks").update(payload).eq("id", id);
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
      const fallbackResult = await sb.from("studio_tasks").update(fallbackPayload).eq("id", id);
      error = fallbackResult.error;
    }
  }
  if (error) {
    console.error("[updateStudioTaskStatus]", error);
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

/**
 * Admin-only: set studio_tasks elapsed duration.
 * If the timer is running (`started_at` set), resets `started_at` to now so the
 * live display continues from the adjusted base without a jump.
 */
export async function adjustStudioTaskDuration(
  taskId: string,
  elapsedSeconds: number
): Promise<
  | { ok: true; elapsedSeconds: number; startedAt: string | null; totalTimeLabel: string | null }
  | { ok: false; error: string }
> {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return { ok: false, error: "Unauthorized" };
  }
  if (!auth.isAdmin) {
    return { ok: false, error: "Only admins can adjust task timers." };
  }

  const sb = serviceSupabase();
  if (!sb) {
    return { ok: false, error: "Database is not configured." };
  }

  const id = taskId.trim();
  if (!id) {
    return { ok: false, error: "Missing task id." };
  }

  const nextElapsed = Math.max(0, Math.floor(Number(elapsedSeconds)));
  if (!Number.isFinite(nextElapsed)) {
    return { ok: false, error: "Invalid duration." };
  }

  const { data: row, error: fetchError } = await sb
    .from("studio_tasks")
    .select("id, status, started_at, elapsed_seconds")
    .eq("id", id)
    .maybeSingle();

  if (fetchError) {
    return { ok: false, error: fetchError.message };
  }
  if (!row) {
    return { ok: false, error: "Task not found." };
  }

  const status = String((row as { status?: string }).status ?? "").toLowerCase();
  const wasRunning = Boolean((row as { started_at?: string | null }).started_at);
  const startedAt = wasRunning ? new Date().toISOString() : null;

  const hours = Math.floor(nextElapsed / 3600);
  const minutes = Math.floor((nextElapsed % 3600) / 60);
  const seconds = nextElapsed % 60;
  const totalTimeLabel =
    status === "completed"
      ? `${hours}h ${minutes}m ${seconds}s`
      : null;

  const payload: Record<string, unknown> = {
    elapsed_seconds: nextElapsed,
    started_at: startedAt,
  };
  if (status === "completed") {
    payload.total_time_label = totalTimeLabel;
  }

  const { error } = await sb.from("studio_tasks").update(payload).eq("id", id);
  if (error) {
    console.error("[adjustStudioTaskDuration]", error);
    return { ok: false, error: error.message };
  }

  return {
    ok: true,
    elapsedSeconds: nextElapsed,
    startedAt,
    totalTimeLabel,
  };
}

