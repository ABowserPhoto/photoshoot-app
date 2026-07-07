"use server";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { getAuthRole } from "@/lib/server/getAuthRole";

const KANBAN_COMPLETION_STATUSES = new Set(["edited", "send email", "invoice sent", "completed"]);

/**
 * DB statuses that count as "actively editing" for timer purposes.
 * "Editing" = manually dragged to the editing column.
 * "Processing" = background worker claimed the task for HDR/Comfy merging.
 * Both render in the same "editing" Kanban column.
 */
const EDITING_LIKE_STATUSES = new Set(["editing", "processing"]);

function isEditingLikeStatus(status: string): boolean {
  return EDITING_LIKE_STATUSES.has(status.trim().toLowerCase());
}

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

function isKanbanCompletionStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return KANBAN_COMPLETION_STATUSES.has(normalized) || normalized === "send-email";
}

/**
 * Central status-update action.
 *
 * Timer auto-management (only when the caller does NOT provide explicit
 * `editing_started_at` or `total_editing_seconds` in `extra`):
 *
 * • Entering an editing-like status ("Editing", "Processing") from a
 *   non-editing status → stamps `editing_started_at = now`.
 *
 * • Leaving an editing-like status → calculates elapsed seconds since
 *   `editing_started_at`, adds them to `total_editing_seconds`, and
 *   resets `editing_started_at` to null.
 *
 * The frontend always passes explicit timer values in `extra`, so the
 * auto-logic is effectively a server-side fallback for programmatic
 * callers (background workers, API routes) that do not supply them.
 */
export async function updateTaskStatus(
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
    ...(extra ?? {}),
  };

  if (isKanbanCompletionStatus(status)) {
    const editorId = await getSessionUserId();
    if (editorId) {
      payload = { ...payload, editor_id: editorId };
    }
  }

  const normalizedStatus = status.trim().toLowerCase();
  if (normalizedStatus === "completed" && payload.completed_at == null) {
    payload.completed_at = new Date().toISOString();
  }

  // ── Auto-timer management ──────────────────────────────────────────────────
  // Skip when the caller already provided explicit timer fields.
  const callerProvidesTimer =
    extra != null &&
    ("editing_started_at" in extra || "total_editing_seconds" in extra);

  if (!callerProvidesTimer) {
    const { data: currentTask } = await sb
      .from("tasks")
      .select("status, editing_started_at, total_editing_seconds")
      .eq("id", id)
      .maybeSingle();

    const currentStatus = typeof currentTask?.status === "string" ? currentTask.status : "";
    const enteringEditing = isEditingLikeStatus(status) && !isEditingLikeStatus(currentStatus);
    const leavingEditing = !isEditingLikeStatus(status) && isEditingLikeStatus(currentStatus);

    if (enteringEditing) {
      payload.editing_started_at = new Date().toISOString();
      // Preserve whatever total was already accumulated; don't overwrite it.
      if (payload.total_editing_seconds == null) {
        payload.total_editing_seconds = Number(currentTask?.total_editing_seconds ?? 0);
      }
    } else if (leavingEditing) {
      const startedAt = typeof currentTask?.editing_started_at === "string"
        ? currentTask.editing_started_at
        : null;
      const startedAtMs = startedAt ? new Date(startedAt).getTime() : NaN;
      const elapsed =
        !Number.isNaN(startedAtMs) ? Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)) : 0;
      const prevTotal = Number(currentTask?.total_editing_seconds ?? 0);
      payload.editing_started_at = null;
      payload.total_editing_seconds = prevTotal + elapsed;
    }
  }
  // ── End auto-timer ─────────────────────────────────────────────────────────

  const { error } = await sb.from("tasks").update(payload).eq("id", id);
  if (error) {
    console.error("[updateTaskStatus]", error);
    return { ok: false, error: error.message };
  }

  return { ok: true };
}
