import type { User } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import {
  DEFAULT_STAFF_MODULES,
  normalizeAccessibleModules,
  type AppModule,
} from "@/lib/appModules";
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

async function profileAuthState(
  userId: string,
  fallbackUser: User
): Promise<{ role: UserRole; isArchived: boolean; accessibleModules: AppModule[] }> {
  const sb = createServiceSupabase();
  if (!sb) {
    return {
      role: roleFromSupabaseUser(fallbackUser),
      isArchived: false,
      accessibleModules: [],
    };
  }

  const { data, error } = await sb
    .from("profiles")
    .select("role, is_archived, accessible_modules")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data || typeof data !== "object") {
    // Older DBs without new columns: degrade gracefully.
    if (error && /accessible_modules|is_archived|column|schema|Could not find/i.test(error.message)) {
      const retry = await sb
        .from("profiles")
        .select("role, is_archived")
        .eq("id", userId)
        .maybeSingle();
      if (retry.error || !retry.data) {
        const roleOnly = await sb.from("profiles").select("role").eq("id", userId).maybeSingle();
        if (roleOnly.error || !roleOnly.data) {
          return {
            role: roleFromSupabaseUser(fallbackUser),
            isArchived: false,
            accessibleModules: [],
          };
        }
        const rawRole = (roleOnly.data as { role?: unknown }).role;
        return {
          role:
            rawRole === null || rawRole === undefined || String(rawRole).trim() === ""
              ? roleFromSupabaseUser(fallbackUser)
              : normalizeRole(rawRole),
          isArchived: false,
          accessibleModules: [...DEFAULT_STAFF_MODULES],
        };
      }
      const row = retry.data as { role?: unknown; is_archived?: unknown };
      const role =
        row.role === null || row.role === undefined || String(row.role).trim() === ""
          ? roleFromSupabaseUser(fallbackUser)
          : normalizeRole(row.role);
      return {
        role,
        isArchived: row.is_archived === true,
        accessibleModules: role === "admin" ? [] : [...DEFAULT_STAFF_MODULES],
      };
    }
    return {
      role: roleFromSupabaseUser(fallbackUser),
      isArchived: false,
      accessibleModules: [],
    };
  }

  const row = data as {
    role?: unknown;
    is_archived?: unknown;
    accessible_modules?: unknown;
  };
  const isArchived = row.is_archived === true;
  const rawRole = row.role;
  const role =
    rawRole === null || rawRole === undefined || String(rawRole).trim() === ""
      ? roleFromSupabaseUser(fallbackUser)
      : normalizeRole(rawRole);

  return {
    role,
    isArchived,
    accessibleModules: normalizeAccessibleModules(row.accessible_modules),
  };
}

export type AuthRoleResult = {
  authenticated: boolean;
  role: UserRole;
  isAdmin: boolean;
  /** Staff module grants. Empty for admins (they bypass checks). */
  accessibleModules: AppModule[];
};

/**
 * Resolves current request auth:
 * - Supabase session (role + modules from `profiles`), OR
 * - Gatekeeper cookie matching APP_ADMIN_PASSWORD / APP_EDITOR_PASSWORD.
 */
export async function getAuthRole(): Promise<AuthRoleResult> {
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
      const { role, isArchived, accessibleModules } = await profileAuthState(user.id, user);
      if (isArchived) {
        return {
          authenticated: false,
          role: "editor",
          isAdmin: false,
          accessibleModules: [],
        };
      }
      const isAdmin = role === "admin";
      return {
        authenticated: true,
        role,
        isAdmin,
        accessibleModules: isAdmin ? [] : accessibleModules,
      };
    }
  }

  const secret = process.env.APP_AUTH_SECRET?.trim();
  const adminPassword = process.env.APP_ADMIN_PASSWORD?.trim();
  const editorPassword = process.env.APP_EDITOR_PASSWORD?.trim();
  const cookieVal = cookieStore.get(GATE_COOKIE)?.value;

  if (secret && adminPassword && editorPassword && cookieVal) {
    const adminExpected = await deriveGateToken(secret, adminPassword);
    if (timingSafeEqualHex(cookieVal, adminExpected)) {
      return { authenticated: true, role: "admin", isAdmin: true, accessibleModules: [] };
    }

    const editorExpected = await deriveGateToken(secret, editorPassword);
    if (timingSafeEqualHex(cookieVal, editorExpected)) {
      return {
        authenticated: true,
        role: "editor",
        isAdmin: false,
        accessibleModules: [...DEFAULT_STAFF_MODULES],
      };
    }
  }

  return {
    authenticated: false,
    role: "editor",
    isAdmin: false,
    accessibleModules: [],
  };
}
