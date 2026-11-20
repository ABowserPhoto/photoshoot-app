"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useAuthRole } from "@/app/contexts/AuthRoleContext";
import {
  canAccessPathname,
  firstAccessibleHref,
  moduleForPathname,
} from "@/lib/appModules";
import { loginHrefWithRedirect, shouldKeepModuleTreeMounted } from "@/lib/authRefresh";

function isUnguardedPath(pathname: string): boolean {
  if (pathname === "/login" || pathname.startsWith("/login/")) return true;
  if (pathname === "/gallery" || pathname.startsWith("/gallery/")) return true;
  if (pathname === "/desktop-widget" || pathname.startsWith("/desktop-widget/")) return true;
  return false;
}

/**
 * Client-side route guard for module permissions.
 * Admins always pass. Staff are redirected to their first allowed module.
 */
export default function ModuleAccessGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { authenticated, isLoading, isAdmin, accessibleModules } = useAuthRole();

  const skip = isUnguardedPath(pathname);
  const search = searchParams.toString();
  const requiredModule = skip ? null : moduleForPathname(pathname, search);
  const allowed =
    skip ||
    isAdmin ||
    !requiredModule ||
    canAccessPathname({
      isAdmin,
      accessibleModules,
      pathname,
      search,
    });
  const [hasShownModule, setHasShownModule] = useState(false);
  if (!authenticated) {
    if (hasShownModule) setHasShownModule(false);
  } else if (!skip && !isLoading && allowed && !hasShownModule) {
    setHasShownModule(true);
  }
  const keepMounted = shouldKeepModuleTreeMounted({
    isLoading,
    authenticated,
    allowed,
    hasShownModule,
  });

  useEffect(() => {
    if (skip || isLoading) {
      return;
    }
    if (!authenticated) {
      router.replace(
        loginHrefWithRedirect(`${window.location.pathname}${window.location.search}`)
      );
      return;
    }
    if (allowed) {
      return;
    }
    // Prefer planner when granted; otherwise fall back to first allowed module.
    const fallback = firstAccessibleHref({
      isAdmin,
      accessibleModules,
    });
    router.replace(
      !isAdmin && accessibleModules.includes("planner") ? "/planner" : fallback
    );
  }, [allowed, authenticated, accessibleModules, isAdmin, isLoading, router, skip]);

  if (skip || keepMounted) {
    return <>{children}</>;
  }

  if (isLoading) {
    return (
      <main className="flex min-h-[40vh] items-center justify-center text-sm text-zinc-400">
        Checking access…
      </main>
    );
  }

  if (!allowed) {
    return (
      <main className="flex min-h-[40vh] items-center justify-center text-sm text-zinc-400">
        Redirecting…
      </main>
    );
  }

  return <>{children}</>;
}
