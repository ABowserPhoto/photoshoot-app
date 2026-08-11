"use server";

import {
  createPreviewEmailDraft,
  type TriggerPreviewEmailResult,
} from "@/lib/server/previewEmailDraft";

export type { TriggerPreviewEmailResult };

/**
 * Loads task contact info, builds the preview gallery email HTML, and creates a Gmail draft.
 * Prefer POST /api/workflows/preview-email from the Kanban board (Electron-safe fetch).
 */
export async function triggerPreviewEmail(taskId: string): Promise<TriggerPreviewEmailResult> {
  return createPreviewEmailDraft(taskId);
}
