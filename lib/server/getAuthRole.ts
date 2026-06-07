import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import type { UserRole } from "@/lib/authRole";
import { normalizeRole } from "@/lib/authRole";
import { deriveGateToken, timingSafeEqualHex } from "@/lib/gateToken";

const GATE_COOKIE = "workflow_gate";

function roleFromSupabaseUser(user: User): UserRole {
  const meta = user.user_metadata as Record<string, unknown> | undefined;
  const appMeta = user.app_metadata as Record<string, unknown> | undefined;
  const raw =
    meta?.role ?? appMeta?.role ?? meta?.app_role ?? appMeta?.app_role ?? meta?.user_role;
  return normalizeRole(raw);
}

function createServiceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) {
    return null;
  }
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

async function roleFromProfilesTable(userId: string, fallbackUser: User): Promise<UserRole> {
  const sb = createServiceSupabase();
  if (!sb) {
    return roleFromSupabaseUser(fallbackUser);
  }

  const { data, error } = await sb.from("profiles").select("role").eq("id", userId).maybeSingle();
  if (error || !data || typeof data !== "object") {
    return roleFromSupabaseUser(fallbackUser);
  }

  const rawRole = (data as { role?: unknown }).role;
  if (rawRole === null || rawRole === undefined || String(rawRole).trim() === "") {
    return roleFromSupabaseUser(fallbackUser);
  }

  return normalizeRole(rawRole);
}

/**
 * Resolves current request auth:
 * - Supabase session (role from `profiles.role`, then user metadata), OR
 * - Gatekeeper cookie matching APP_ADMIN_PASSWORD / APP_EDITOR_PASSWORD.
 */
export async function getAuthRole(): Promise<{
  authenticated: boolean;
  role: UserRole;
  isAdmin: boolean;
}> {
  const cookieStore = await cookies();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (supabaseUrl && supabaseAnonKey) {
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

    if (user) {
      const role = await roleFromProfilesTable(user.id, user);
      return { authenticated: true, role, isAdmin: role === "admin" };
    }
  }

  const secret = process.env.APP_AUTH_SECRET?.trim();
  const adminPassword = process.env.APP_ADMIN_PASSWORD?.trim();
  const editorPassword = process.env.APP_EDITOR_PASSWORD?.trim();
  const cookieVal = cookieStore.get(GATE_COOKIE)?.value;

  if (secret && adminPassword && editorPassword && cookieVal) {
    const adminExpected = await deriveGateToken(secret, adminPassword);
    if (timingSafeEqualHex(cookieVal, adminExpected)) {
      return { authenticated: true, role: "admin", isAdmin: true };
    }

    const editorExpected = await deriveGateToken(secret, editorPassword);
    if (timingSafeEqualHex(cookieVal, editorExpected)) {
      return { authenticated: true, role: "editor", isAdmin: false };
    }
  }

  return { authenticated: false, role: "editor", isAdmin: false };
}
