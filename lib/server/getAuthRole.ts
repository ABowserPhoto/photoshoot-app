import type { User } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { GATE_COOKIE } from "@/lib/authCookies";
import {
  DEFAULT_STAFF_MODULES,
  normalizeAccessibleModules,
  type AppModule,
} from "@/lib/appModules";
import type { UserRole } from "@/lib/authRole";
import { normalizeRole } from "@/lib/authRole";
import { deriveGateToken, timingSafeEqualHex } from "@/lib/gateToken";
import {
  createCookieAuthServerClient,
  createServiceRoleClient,
} from "@/lib/server/supabaseServer";

function roleFromSupabaseUser(user: User): UserRole {
  const meta = user.user_metadata as Record<string, unknown> | undefined;
  const appMeta = user.app_metadata as Record<string, unknown> | undefined;
  const raw =
    meta?.role ?? appMeta?.role ?? meta?.app_role ?? appMeta?.app_role ?? meta?.user_role;
  return normalizeRole(raw);
}

type ProfileRow = {
  role?: unknown;
  is_archived?: unknown;
  accessible_modules?: unknown;
};

async function readProfileRow(
  sb: SupabaseClient,
  userId: string
): Promise<{ data: ProfileRow | null; error: { message: string } | null }> {
  const { data, error } = await sb
    .from("profiles")
    .select("role, is_archived, accessible_modules")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    if (/accessible_modules|is_archived|column|schema|Could not find/i.test(error.message)) {
      const retry = await sb.from("profiles").select("role, is_archived").eq("id", userId).maybeSingle();
      if (retry.error) {
        const roleOnly = await sb.from("profiles").select("role").eq("id", userId).maybeSingle();
        if (roleOnly.error || !roleOnly.data) {
          return { data: null, error: roleOnly.error ?? retry.error };
        }
        return { data: roleOnly.data as ProfileRow, error: null };
      }
      return { data: retry.data as ProfileRow, error: null };
    }
    return { data: null, error };
  }

  return { data: (data as ProfileRow | null) ?? null, error: null };
}

function profileStateFromRow(
  row: ProfileRow,
  fallbackUser: User
): { role: UserRole; isArchived: boolean; accessibleModules: AppModule[] } {
  const isArchived = row.is_archived === true;
  const rawRole = row.role;
  const role =
    rawRole === null || rawRole === undefined || String(rawRole).trim() === ""
      ? roleFromSupabaseUser(fallbackUser)
      : normalizeRole(rawRole);

  return {
    role,
    isArchived,
    accessibleModules:
      role === "admin" ? [] : normalizeAccessibleModules(row.accessible_modules),
  };
}

function metadataFallbackProfileState(fallbackUser: User) {
  const role = roleFromSupabaseUser(fallbackUser);
  return {
    role,
    isArchived: false,
    accessibleModules: role === "admin" ? [] : [...DEFAULT_STAFF_MODULES],
  };
}

async function profileAuthState(
  userId: string,
  fallbackUser: User
): Promise<{ role: UserRole; isArchived: boolean; accessibleModules: AppModule[] }> {
  const clients: SupabaseClient[] = [];
  const serviceClient = createServiceRoleClient();
  if (serviceClient) {
    clients.push(serviceClient);
  }
  const sessionClient = await createCookieAuthServerClient();
  if (sessionClient) {
    clients.push(sessionClient);
  }

  for (const sb of clients) {
    const { data, error } = await readProfileRow(sb, userId);
    if (data && typeof data === "object") {
      return profileStateFromRow(data, fallbackUser);
    }
    if (error) {
      console.warn("[getAuthRole] profiles lookup failed:", error.message);
    }
  }

  return metadataFallbackProfileState(fallbackUser);
}

async function resolveGateAuth(cookieVal: string | undefined): Promise<AuthRoleResult | null> {
  const secret = process.env.APP_AUTH_SECRET?.trim();
  const adminPassword = process.env.APP_ADMIN_PASSWORD?.trim();
  const editorPassword = process.env.APP_EDITOR_PASSWORD?.trim();

  if (!secret || !adminPassword || !editorPassword || !cookieVal) {
    return null;
  }

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

  return null;
}

export type AuthRoleResult = {
  authenticated: boolean;
  role: UserRole;
  isAdmin: boolean;
  /** Staff module grants. Empty for admins (they bypass checks). */
  accessibleModules: AppModule[];
};

type GetAuthRoleOptions = {
  /** Reuse a route-handler Supabase client (avoids duplicate session refresh). */
  supabaseClient?: SupabaseClient | null;
  /** User already resolved via supabase.auth.getUser() on the same client. */
  prefetchUser?: User | null;
};

/**
 * Resolves current request auth:
 * - Supabase session (role + modules from `profiles`), OR
 * - Gatekeeper cookie matching APP_ADMIN_PASSWORD / APP_EDITOR_PASSWORD.
 */
export async function getAuthRole(options?: GetAuthRoleOptions): Promise<AuthRoleResult> {
  const cookieStore = await cookies();
  const supabase = options?.supabaseClient ?? (await createCookieAuthServerClient());

  let user = options?.prefetchUser ?? null;
  if (!user && supabase) {
    const {
      data: { user: resolvedUser },
    } = await supabase.auth.getUser();
    user = resolvedUser ?? null;
  }

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

  const gateAuth = await resolveGateAuth(cookieStore.get(GATE_COOKIE)?.value);
  if (gateAuth) {
    return gateAuth;
  }

  return {
    authenticated: false,
    role: "editor",
    isAdmin: false,
    accessibleModules: [],
  };
}
