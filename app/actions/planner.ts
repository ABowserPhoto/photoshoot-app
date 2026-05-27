"use server";

import { createClient } from "@supabase/supabase-js";

import { getAuthRole } from "@/lib/server/getAuthRole";

type PlannerActionResult = { ok: true } | { ok: false; error: string };

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

export async function deletePlannerPost(taskId: string): Promise<PlannerActionResult> {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return { ok: false, error: "Unauthorized" };
  }

  const id = taskId.trim();
  if (!id) {
    return { ok: false, error: "Missing task id." };
  }

  if (id.startsWith("temp-")) {
    return { ok: true };
  }

  const sb = serviceSupabase();
  if (!sb) {
    return { ok: false, error: "Database is not configured." };
  }

  const { error } = await sb.from("studio_tasks").delete().eq("id", id);
  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}
