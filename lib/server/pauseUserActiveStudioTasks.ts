import { createClient } from "@supabase/supabase-js";

import { isUserOnStudioTask } from "@/lib/plannerAssignees";

export type PausedStudioTaskSummary = {
  id: string;
  title: string | null;
  elapsed_seconds: number;
};

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

/**
 * Pause every running Processing timer belonging to `userId`.
 * Other users' timers are left untouched.
 */
export async function pauseUserActiveStudioTasks(userId: string | null | undefined): Promise<{
  ok: boolean;
  pausedTasks: PausedStudioTaskSummary[];
  error?: string;
}> {
  const uid = typeof userId === "string" ? userId.trim() : "";
  if (!uid) {
    return { ok: true, pausedTasks: [] };
  }

  const sb = serviceSupabase();
  if (!sb) {
    return { ok: false, pausedTasks: [], error: "Database is not configured." };
  }

  const { data, error } = await sb
    .from("studio_tasks")
    .select("id, title, status, started_at, elapsed_seconds, assigned_to, assigned_users")
    .eq("status", "processing")
    .not("started_at", "is", null);

  if (error) {
    return { ok: false, pausedTasks: [], error: error.message };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const pausedTasks: PausedStudioTaskSummary[] = [];

  for (const row of data ?? []) {
    const task = row as {
      id: string;
      title: string | null;
      started_at: string | null;
      elapsed_seconds: number | null;
      assigned_to: string | null;
      assigned_users?: unknown;
    };

    if (
      !isUserOnStudioTask({
        userId: uid,
        assignedTo: task.assigned_to,
        assignedUsers: task.assigned_users,
      })
    ) {
      continue;
    }

    const startedAtMs = task.started_at ? new Date(task.started_at).getTime() : Number.NaN;
    const startedAtSec = Number.isFinite(startedAtMs) ? Math.floor(startedAtMs / 1000) : null;
    const baseElapsed = Math.max(0, task.elapsed_seconds ?? 0);
    const elapsed =
      startedAtSec !== null ? baseElapsed + Math.max(0, nowSec - startedAtSec) : baseElapsed;

    const { error: updateError } = await sb
      .from("studio_tasks")
      .update({
        status: "planning",
        started_at: null,
        elapsed_seconds: elapsed,
        pause_reason: "Paused automatically — Jibble break started",
      })
      .eq("id", task.id);

    if (updateError) {
      console.error("[pauseUserActiveStudioTasks]", task.id, updateError.message);
      continue;
    }

    pausedTasks.push({
      id: task.id,
      title: task.title,
      elapsed_seconds: elapsed,
    });
  }

  return { ok: true, pausedTasks };
}
