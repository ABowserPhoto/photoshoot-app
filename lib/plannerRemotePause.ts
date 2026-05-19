import { supabase } from "@/lib/supabaseClient";

type StudioTaskPauseRow = {
  id: string;
  elapsed_seconds: number | null;
  started_at: string | null;
  file_path: string | null;
};

/**
 * Pause a studio task when the planner page is not mounted (global widget).
 * Mirrors planner page pause behavior (prompt for path, persist elapsed).
 */
export async function pauseStudioTaskFromRemote(taskId: string): Promise<void> {
  if (!supabase || taskId.startsWith("temp-")) {
    throw new Error("Cannot pause this task right now.");
  }
  const { data: row, error: fetchError } = await supabase
    .from("studio_tasks")
    .select("id, elapsed_seconds, started_at, file_path, status")
    .eq("id", taskId)
    .maybeSingle();

  if (fetchError || !row) {
    throw new Error(fetchError?.message ?? "Task not found.");
  }
  const status = String((row as { status?: string }).status ?? "").toLowerCase();
  if (status !== "processing") {
    throw new Error("Only processing tasks can be paused.");
  }

  const r = row as StudioTaskPauseRow;
  const nowSec = Math.floor(Date.now() / 1000);
  const startedAtMs = r.started_at ? new Date(r.started_at).getTime() : Number.NaN;
  const startedAtSec = Number.isFinite(startedAtMs) ? Math.floor(startedAtMs / 1000) : null;
  const baseElapsed = Math.max(0, r.elapsed_seconds ?? 0);
  const elapsed =
    startedAtSec !== null ? baseElapsed + Math.max(0, nowSec - startedAtSec) : baseElapsed;

  const pathInput = typeof window !== "undefined"
    ? window.prompt("Paste local file path for current working files:")?.trim() ?? ""
    : "";

  const { error: updateError } = await supabase
    .from("studio_tasks")
    .update({
      started_at: null,
      elapsed_seconds: elapsed,
      file_path: pathInput || r.file_path || null,
    })
    .eq("id", taskId);

  if (updateError) {
    throw new Error(updateError.message);
  }
}
