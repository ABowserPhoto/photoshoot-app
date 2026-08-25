import { SOCIAL_MEDIA_BUCKET } from "@/lib/socialMediaStorage";
import { supabase } from "@/lib/supabaseClient";

/**
 * Upload selected social JPEGs directly to Supabase Storage from the browser.
 * Avoids sending multi-MB file buffers through Vercel serverless API routes.
 */
export async function uploadSocialDeliverableFiles(
  files: File[],
  taskId: string
): Promise<string[]> {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  const trimmedTaskId = taskId.trim();
  if (!trimmedTaskId) {
    throw new Error("taskId is required for social uploads.");
  }
  if (files.length === 0) {
    return [];
  }

  const urls: string[] = [];

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const extension = file.name.includes(".") ? file.name.split(".").pop() : "jpg";
    const objectPath = `queue/${trimmedTaskId}/${Date.now()}-${i}-${Math.random()
      .toString(36)
      .slice(2, 8)}.${extension ?? "jpg"}`;

    const upload = await supabase.storage.from(SOCIAL_MEDIA_BUCKET).upload(objectPath, file, {
      upsert: false,
      contentType: file.type || "image/jpeg",
    });

    if (upload.error) {
      throw new Error(`Social upload failed for ${file.name}: ${upload.error.message}`);
    }

    const { data: publicData } = supabase.storage.from(SOCIAL_MEDIA_BUCKET).getPublicUrl(objectPath);
    urls.push(publicData.publicUrl);
  }

  return urls;
}
