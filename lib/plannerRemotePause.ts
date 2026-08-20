import { isUserOnStudioTask } from "@/lib/plannerAssignees";
import { supabase } from "@/lib/supabaseClient";

type StudioTaskPauseRow = {
  id: string;
  elapsed_seconds: number | null;
  started_at: string | null;
  status?: string;
  assigned_to?: string | null;
  assigned_users?: unknown;
};

/**
 * Pause a studio task when the planner page is not mounted (global widget).
 * Moves the task to Planning and clears the running timer (Jibble is not involved).
 * Only tasks assigned to the signed-in user can be paused this way.
 */
export async function pauseStudioTaskFromRemote(taskId: string): Promise<void> {
  if (!supabase || taskId.startsWith("temp-")) {
    throw new Error("Cannot pause this task right now.");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    throw new Error("You must be signed in to pause a task.");
  }

  const { data: row, error: fetchError } = await supabase
    .from("studio_tasks")
    .select("id, elapsed_seconds, started_at, status, assigned_to, assigned_users")
    .eq("id", taskId)
    .maybeSingle();

  if (fetchError || !row) {
    throw new Error(fetchError?.message ?? "Task not found.");
  }

  const r = row as StudioTaskPauseRow;

  if (
    !isUserOnStudioTask({
      userId: user.id,
      assignedTo: r.assigned_to,
      assignedUsers: r.assigned_users,
    })
  ) {
    throw new Error("You can only pause tasks assigned to you.");
  }

  const status = String(r.status ?? "").toLowerCase();
  if (status !== "processing") {
    throw new Error("Only processing tasks can be paused.");
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const startedAtMs = r.started_at ? new Date(r.started_at).getTime() : Number.NaN;
  const startedAtSec = Number.isFinite(startedAtMs) ? Math.floor(startedAtMs / 1000) : null;
  const baseElapsed = Math.max(0, r.elapsed_seconds ?? 0);
  const elapsed =
    startedAtSec !== null ? baseElapsed + Math.max(0, nowSec - startedAtSec) : baseElapsed;

  const { error: updateError } = await supabase
    .from("studio_tasks")
    .update({
      status: "planning",
      started_at: null,
      elapsed_seconds: elapsed,
      pause_reason: "Paused from timer widget",
    })
    .eq("id", taskId);

  if (updateError) {
    throw new Error(updateError.message);
  }
}
