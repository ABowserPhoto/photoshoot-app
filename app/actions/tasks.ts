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
 * Timer auto-management:
 *
 * • Entering an editing-like status ("Editing", "Processing") from a
 *   non-editing status → stamps `editing_started_at = now` unless a timer
 *   is already running. Folder paths are irrelevant.
 *
 * • Leaving an editing-like status → calculates elapsed seconds since
 *   `editing_started_at`, adds them to `total_editing_seconds`, and
 *   resets `editing_started_at` to null.
 *
 * Explicit timer fields in `extra` are used when they contain real values.
 * Passing `editing_started_at: null` on enter no longer skips the start.
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
  // Always stamp/accumulate when entering or leaving editing-like statuses.
  // Callers may pass explicit timer fields; a null/empty `editing_started_at`
  // on enter must NOT skip the start (that used to disable auto-start).
  const extraStartedRaw = extra && "editing_started_at" in extra ? extra.editing_started_at : undefined;
  const extraStarted =
    typeof extraStartedRaw === "string" && extraStartedRaw.trim() ? extraStartedRaw.trim() : null;

  const { data: currentTask } = await sb
    .from("tasks")
    .select("status, editing_started_at, total_editing_seconds")
    .eq("id", id)
    .maybeSingle();

  const currentStatus = typeof currentTask?.status === "string" ? currentTask.status : "";
  const enteringEditing = isEditingLikeStatus(status) && !isEditingLikeStatus(currentStatus);
  const leavingEditing = !isEditingLikeStatus(status) && isEditingLikeStatus(currentStatus);

  if (enteringEditing) {
    const alreadyRunning =
      extraStarted ||
      (typeof currentTask?.editing_started_at === "string" && currentTask.editing_started_at.trim());
    payload.editing_started_at = alreadyRunning || new Date().toISOString();
    if (payload.total_editing_seconds == null) {
      payload.total_editing_seconds = Number(currentTask?.total_editing_seconds ?? 0);
    }
  } else if (leavingEditing) {
    const startedAt =
      extraStarted ||
      (typeof currentTask?.editing_started_at === "string" ? currentTask.editing_started_at : null);
    const startedAtMs = startedAt ? new Date(startedAt).getTime() : NaN;
    const elapsed =
      !Number.isNaN(startedAtMs) ? Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)) : 0;
    const prevTotal = Number(
      extra && typeof extra.total_editing_seconds === "number"
        ? extra.total_editing_seconds
        : (currentTask?.total_editing_seconds ?? 0)
    );
    // If the caller already added elapsed into total_editing_seconds, don't double-count.
    const callerAlreadyAccumulated = extra != null && "total_editing_seconds" in extra && extraStartedRaw === null;
    payload.editing_started_at = null;
    payload.total_editing_seconds = callerAlreadyAccumulated ? prevTotal : prevTotal + elapsed;
  }
  // ── End auto-timer ─────────────────────────────────────────────────────────

  try {
    const { error } = await sb.from("tasks").update(payload).eq("id", id);
    if (error) {
      console.error("[updateTaskStatus]", error);
      return { ok: false, error: error.message };
    }

    return { ok: true };
  } catch (error) {
    console.error("[updateTaskStatus]", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to update task status.",
    };
  }
}
