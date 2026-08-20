"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { useAuthRole } from "@/app/contexts/AuthRoleContext";
import {
  canAccessModule,
  firstAccessibleHref,
  moduleForPathname,
  type AppModule,
} from "@/lib/appModules";
import { permissionDeniedRedirectPath } from "@/lib/permissionDenied";

/**
 * Admin shell: full admins always allowed.
 * Staff may enter only when they were granted `statistics` or `crm`
 * for the matching route. User Management APIs remain admin-only.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { authenticated, isLoading, isAdmin, accessibleModules } = useAuthRole();
  const [checked, setChecked] = useState(false);

  const requiredModule = useMemo(
    () => moduleForPathname(pathname) as AppModule | null,
    [pathname]
  );

  const allowed = useMemo(() => {
    if (isAdmin) {
      return true;
    }
    if (requiredModule === "statistics" || requiredModule === "crm") {
      return canAccessModule({
        isAdmin: false,
        accessibleModules,
        module: requiredModule,
      });
    }
    // Unknown /admin/* routes stay admin-only.
    return false;
  }, [accessibleModules, isAdmin, requiredModule]);

  useEffect(() => {
    if (isLoading) {
      return;
    }
    if (!authenticated) {
      router.replace("/login");
      return;
    }
    if (!allowed) {
      router.replace(
        !isAdmin && accessibleModules.includes("planner")
          ? "/planner"
          : firstAccessibleHref({ isAdmin: false, accessibleModules }) === "/login"
            ? permissionDeniedRedirectPath()
            : firstAccessibleHref({ isAdmin: false, accessibleModules })
      );
      return;
    }
    setChecked(true);
  }, [allowed, authenticated, accessibleModules, isAdmin, isLoading, router]);

  if (isLoading || !authenticated || !checked || !allowed) {
    return (
      <main className="flex min-h-[50vh] items-center justify-center text-sm text-zinc-400">
        Checking access…
      </main>
    );
  }

  return children;
}
