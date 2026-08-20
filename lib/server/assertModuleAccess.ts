import { canAccessModule, type AppModule } from "@/lib/appModules";
import { getAuthRole, type AuthRoleResult } from "@/lib/server/getAuthRole";

export async function assertModuleAccess(
  module: AppModule
): Promise<{ ok: true; auth: AuthRoleResult } | { ok: false; status: number; error: string }> {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  if (
    !canAccessModule({
      isAdmin: auth.isAdmin,
      accessibleModules: auth.accessibleModules,
      module,
    })
  ) {
    return { ok: false, status: 403, error: "Forbidden" };
  }
  return { ok: true, auth };
}
