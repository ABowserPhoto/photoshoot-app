"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useAuthRole } from "@/app/contexts/AuthRoleContext";
import { permissionDeniedRedirectPath } from "@/lib/permissionDenied";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { authenticated, isLoading } = useAuthRole();
  const [adminAllowed, setAdminAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    if (isLoading) {
      return;
    }
    if (!authenticated) {
      router.replace("/login");
      return;
    }

    let cancelled = false;

    async function verifyAdminAccess() {
      try {
        const response = await fetch("/api/auth/admin-access", { cache: "no-store", credentials: "include" });
        const json = (await response.json().catch(() => null)) as { allowed?: boolean } | null;
        if (cancelled) {
          return;
        }
        if (response.ok && json?.allowed) {
          setAdminAllowed(true);
          return;
        }
        setAdminAllowed(false);
        router.replace(permissionDeniedRedirectPath());
      } catch {
        if (!cancelled) {
          setAdminAllowed(false);
          router.replace(permissionDeniedRedirectPath());
        }
      }
    }

    void verifyAdminAccess();

    return () => {
      cancelled = true;
    };
  }, [authenticated, isLoading, router]);

  if (isLoading || !authenticated || adminAllowed !== true) {
    return (
      <main className="flex min-h-[50vh] items-center justify-center text-sm text-zinc-400">
        Checking access…
      </main>
    );
  }

  return children;
}
