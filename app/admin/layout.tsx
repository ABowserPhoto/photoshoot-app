"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useAuthRole } from "@/app/contexts/AuthRoleContext";
import { permissionDeniedRedirectPath } from "@/lib/permissionDenied";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { authenticated, isAdmin, isLoading } = useAuthRole();

  useEffect(() => {
    if (isLoading) {
      return;
    }
    if (!authenticated) {
      router.replace("/login");
      return;
    }
    if (!isAdmin) {
      router.replace(permissionDeniedRedirectPath());
    }
  }, [authenticated, isAdmin, isLoading, router]);

  if (isLoading || !authenticated || !isAdmin) {
    return (
      <main className="flex min-h-[50vh] items-center justify-center text-sm text-zinc-400">
        Checking access…
      </main>
    );
  }

  return children;
}
