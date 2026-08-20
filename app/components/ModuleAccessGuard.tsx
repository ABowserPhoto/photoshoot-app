"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useAuthRole } from "@/app/contexts/AuthRoleContext";
import {
  canAccessPathname,
  firstAccessibleHref,
  moduleForPathname,
} from "@/lib/appModules";

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

  useEffect(() => {
    if (skip || isLoading || !authenticated) {
      return;
    }
    if (allowed) {
      return;
    }
    router.replace(
      firstAccessibleHref({
        isAdmin,
        accessibleModules,
      })
    );
  }, [allowed, authenticated, accessibleModules, isAdmin, isLoading, router, skip]);

  if (skip) {
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
