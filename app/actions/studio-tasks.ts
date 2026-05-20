"use server";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { getAuthRole } from "@/lib/server/getAuthRole";

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

async function getSessionUserId(): Promise<string | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Cookie writes can fail in non-mutable contexts; session read still works.
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user?.id ?? null;
}

export async function updateStudioTaskStatus(
  taskId: string,
  newStatus: string,
  extra?: Record<string, unknown>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return { ok: false, error: "Unauthorized" };
  }

  const sb = serviceSupabase();
  if (!sb) {
    return { ok: false, error: "Database is not configured." };
  }

  const id = taskId.trim();
  if (!id) {
    return { ok: false, error: "Missing task id." };
  }

  const status = newStatus.trim();
  if (!status) {
    return { ok: false, error: "Missing status." };
  }

  let payload: Record<string, unknown> = {
    status,
    ...(extra ?? {}),
  };

  if (status.toLowerCase() === "completed") {
    const editorId = await getSessionUserId();
    if (editorId) {
      payload = { ...payload, editor_id: editorId };
    }
  }

  const { error } = await sb.from("studio_tasks").update(payload).eq("id", id);
  if (error) {
    console.error("[updateStudioTaskStatus]", error);
    return { ok: false, error: error.message };
  }

  return { ok: true };
}
