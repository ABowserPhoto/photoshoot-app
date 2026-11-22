import { canAccessModule } from "@/lib/appModules";
import { isClientProfileRole, isStaffProfileRole } from "@/lib/plannerAssignees";
import { getAuthRole } from "@/lib/server/getAuthRole";
import { createCookieAuthServerClient, createServiceRoleClient } from "@/lib/server/supabaseServer";

/**
 * Social scheduler data is staff-only (private.is_staff(): admin or editor, not archived).
 * Client logins stay out even if getAuthRole collapses their profile role to "editor".
 */
export async function assertSocialStaff(): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return { ok: false, error: "Unauthorized" };
  }

  const session = await createCookieAuthServerClient();
  const user = session ? (await session.auth.getUser()).data.user : null;

  if (!user) {
    if (
      !canAccessModule({
        isAdmin: auth.isAdmin,
        accessibleModules: auth.accessibleModules,
        module: "social_scheduler",
      })
    ) {
      return { ok: false, error: "Unauthorized" };
    }
    return { ok: true };
  }

  const reader = createServiceRoleClient() ?? session;
  if (!reader) {
    return { ok: false, error: "Unauthorized" };
  }

  const { data, error } = await reader
    .from("profiles")
    .select("role, is_archived")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !data || data.is_archived === true) {
    return { ok: false, error: "Unauthorized" };
  }
  if (isClientProfileRole(data.role) || !isStaffProfileRole(data.role)) {
    return { ok: false, error: "Unauthorized" };
  }

  const isAdmin = String(data.role).trim().toLowerCase() === "admin";
  if (
    !canAccessModule({
      isAdmin,
      accessibleModules: auth.accessibleModules,
      module: "social_scheduler",
    })
  ) {
    return { ok: false, error: "Unauthorized" };
  }

  return { ok: true };
}
