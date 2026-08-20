import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import {
  canAccessModule,
  type AppModule,
} from "@/lib/appModules";
import { getAuthRole } from "@/lib/server/getAuthRole";

/**
 * Admin-area auth for layouts/APIs.
 * - `isAdmin` comes from `profiles.role` (via getAuthRole); admins always have full access.
 * - Staff may enter `/admin/crm` or `/admin/statistics` when those modules are granted.
 * - User-management endpoints must still require `isAdmin === true`.
 */
export async function getAdminAreaAuth(): Promise<{
  authenticated: boolean;
  isAdmin: boolean;
  userId: string | null;
  accessibleModules: AppModule[];
}> {
  const auth = await getAuthRole();

  let userId: string | null = null;
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
    userId = user?.id ?? null;
  }

  return {
    authenticated: auth.authenticated,
    isAdmin: auth.isAdmin,
    userId,
    accessibleModules: auth.accessibleModules,
  };
}

/** True if the caller may use a given admin-area module (crm / statistics). */
export function canAccessAdminModule(
  auth: {
    isAdmin: boolean;
    accessibleModules: readonly AppModule[] | null | undefined;
  },
  module: Extract<AppModule, "crm" | "statistics">
): boolean {
  return canAccessModule({
    isAdmin: auth.isAdmin,
    accessibleModules: auth.accessibleModules,
    module,
  });
}
