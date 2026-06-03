"use client";

import { usePathname } from "next/navigation";

import GlobalLogoutControl from "@/app/components/GlobalLogoutControl";
import GlobalNavButtons from "@/app/components/GlobalNavButtons";
import JibbleClockToggle from "@/app/components/JibbleClockToggle";
import { useAuthRole } from "@/app/contexts/AuthRoleContext";

function hideTopSuiteBar(pathname: string | null) {
  if (!pathname) {
    return false;
  }
  if (pathname === "/" || pathname === "/kanban") {
    return true;
  }
  if (pathname === "/planner" || pathname.startsWith("/planner/")) {
    return true;
  }
  if (pathname === "/desktop-widget" || pathname.startsWith("/desktop-widget/")) {
    return true;
  }
  return false;
}

export default function GlobalAppHeader() {
  const pathname = usePathname();
  const { authenticated, isLoading } = useAuthRole();

  if (hideTopSuiteBar(pathname)) {
    return null;
  }

  if (isLoading || !authenticated) {
    return null;
  }

  return (
    <header className="sticky top-0 z-[90] border-b border-zinc-800 bg-black/95 backdrop-blur-md">
      <div className="mx-auto flex min-h-14 max-w-[1800px] flex-wrap items-center justify-end gap-3 px-4 py-2 sm:px-6 lg:px-8">
        <GlobalNavButtons secondaryMiddle={<JibbleClockToggle />}>
          <GlobalLogoutControl />
        </GlobalNavButtons>
      </div>
    </header>
  );
}
