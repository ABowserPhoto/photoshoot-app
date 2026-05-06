import { startProcessing } from "@/app/services/processingEngine";

/**
 * Invoke when a task’s Supabase `status` becomes **Selection Available**
 * (client selections are in `2_Selects` and the task row is updated).
 * Runs HDR clustering + Enfuse + optional ComfyUI in the background.
 */
export function onTaskReachedSelectionAvailable(taskId: string, shootFolderPath: string): void {
  const id = taskId.trim();
  const folder = shootFolderPath.trim();
  if (!id || !folder) {
    console.warn("[handleStatusChange] Missing taskId or shootFolderPath; processing not started.");
    return;
  }

  void startProcessing(id, folder).catch((err) => {
    console.error("[handleStatusChange] startProcessing failed:", err);
  });
}
