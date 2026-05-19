"use server";

import { getAuthRole } from "@/lib/server/getAuthRole";
import { triggerTextToPhotoWorkflow, waitForTextToPhotoPreview } from "@/lib/comfy/textToPhoto";

export type GenerateMoodboardImageResult =
  | { ok: true; imageUrl: string }
  | { ok: false; error: string };

/**
 * Generates a moodboard image from a text prompt via the ComfyUI text-to-photo workflow.
 */
export async function generateMoodboardImage(prompt: string): Promise<GenerateMoodboardImageResult> {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return { ok: false, error: "Unauthorized" };
  }

  const p = prompt.trim();
  if (!p) {
    return { ok: false, error: "Prompt is empty." };
  }

  const triggered = await triggerTextToPhotoWorkflow(p);
  if (!triggered.ok) {
    return { ok: false, error: triggered.error };
  }

  const completed = await waitForTextToPhotoPreview(triggered.promptId);
  if (!completed.ok) {
    return { ok: false, error: completed.error };
  }

  return { ok: true, imageUrl: completed.previewUrl };
}
