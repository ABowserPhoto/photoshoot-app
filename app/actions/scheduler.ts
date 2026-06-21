"use server";

import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

import { getAuthRole } from "@/lib/server/getAuthRole";

type SchedulerActionResult = { ok: true } | { ok: false; error: string };

export type SchedulerPostStatus = "pending" | "scheduled" | "published" | "failed";

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

  const { error } = await sb
    .from("social_posts")
    .update({
      status,
      publish_error: publishError?.trim() || null,
    })
    .eq("id", id);

  if (error) {
    return { ok: false, error: error.message };
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
    return { ok: false, error: "Database is not configured." };
  }

  const { error } = await sb.from("social_posts").delete().eq("id", id);
  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}
