"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import AutoLogout from "@/app/components/AutoLogout";
import ClientPlannerShell from "@/app/ClientPlannerShell";
import GlobalAppHeader from "@/app/components/GlobalAppHeader";
import GlobalMessagePopup from "@/app/components/GlobalMessagePopup";
import ModuleAccessGuard from "@/app/components/ModuleAccessGuard";

function isDesktopWidgetPath(pathname: string | null) {
  return pathname === "/desktop-widget" || Boolean(pathname?.startsWith("/desktop-widget/"));
}

export default function RootAppChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (isDesktopWidgetPath(pathname)) {
    return <>{children}</>;
  }

  return (
    <>
      <AutoLogout />
      <ClientPlannerShell>
        <Suspense fallback={null}>
          <GlobalAppHeader />
        </Suspense>
        <GlobalMessagePopup />
        <div className="flex min-h-0 flex-1 flex-col">
          <Suspense
            fallback={
              <main className="flex min-h-[40vh] items-center justify-center text-sm text-zinc-400">
                Loading…
              </main>
            }
          >
            <ModuleAccessGuard>{children}</ModuleAccessGuard>
          </Suspense>
        </div>
      </ClientPlannerShell>
      <footer className="border-t border-zinc-800 bg-black px-4 py-8">
        <div className="mx-auto flex max-w-[1800px] flex-col items-center justify-center gap-3">
          <Image
            src="/Logo_1024_white.webp"
            alt="Aaron Bowser Photography"
            width={480}
            height={160}
            className="h-32 w-auto opacity-90"
          />
          <p className="text-center text-xs text-zinc-500">powered by Aaron Bowser Photography</p>
        </div>
      </footer>
    </>
  );
}
