"use server";

import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

import { getAuthRole } from "@/lib/server/getAuthRole";
import { SOCIAL_MEDIA_BUCKET, storagePathFromPublicUrl } from "@/lib/socialMediaStorage";

type SchedulerActionResult = { ok: true } | { ok: false; error: string };

export type SchedulerPostStatus =
  | "pending"
  | "scheduled"
  | "scheduled_with_meta"
  | "published"
  | "failed";

function serviceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) {
    return null;
  }
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

export async function updateSchedulerPostPublishStatus(
  postId: string,
  status: SchedulerPostStatus,
  publishError?: string | null
): Promise<SchedulerActionResult> {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return { ok: false, error: "Unauthorized" };
  }

  const id = postId.trim();
  if (!id || id.startsWith("temp-")) {
    return { ok: false, error: "Missing post id." };
  }

  const sb = serviceSupabase();
  if (!sb) {
    return { ok: false, error: "Database is not configured." };
  }

  const { data: updated, error } = await sb
    .from("social_posts")
    .update({
      status,
      publish_error: publishError?.trim() || null,
    })
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message };
  }
  if (!updated?.id) {
    return { ok: false, error: "Post update matched 0 rows (check id / RLS / service role)." };
  }

  revalidatePath("/scheduler");
  return { ok: true };
}

export async function deleteSchedulerPost(postId: string): Promise<SchedulerActionResult> {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return { ok: false, error: "Unauthorized" };
  }

  const id = postId.trim();
  if (!id) {
    return { ok: false, error: "Missing post id." };
  }

  if (id.startsWith("temp-")) {
    return { ok: true };
  }

  const sb = serviceSupabase();
  if (!sb) {
    return {
      ok: false,
      error: "SUPABASE_SERVICE_ROLE_KEY is required to delete social posts under RLS.",
    };
  }

  const { data: row, error: loadError } = await sb
    .from("social_posts")
    .select("id, file_url")
    .eq("id", id)
    .maybeSingle();

  if (loadError) {
    return { ok: false, error: loadError.message };
  }
  if (!row?.id) {
    return { ok: false, error: "Post not found." };
  }

  const fileUrl = typeof row.file_url === "string" ? row.file_url.trim() : "";
  const storagePath = fileUrl ? storagePathFromPublicUrl(fileUrl) : null;

  const { data: deleted, error: deleteError } = await sb
    .from("social_posts")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (deleteError) {
    return { ok: false, error: deleteError.message };
  }
  if (!deleted?.id) {
    return {
      ok: false,
      error: "Post delete matched 0 rows (check id / RLS / service role).",
    };
  }

  if (storagePath) {
    const { error: storageError } = await sb.storage.from(SOCIAL_MEDIA_BUCKET).remove([storagePath]);
    if (storageError) {
      console.warn(
        `[deleteSchedulerPost] DB row ${id} deleted but storage remove failed for ${storagePath}:`,
        storageError.message
      );
    }
  }

  revalidatePath("/scheduler");
  return { ok: true };
}
