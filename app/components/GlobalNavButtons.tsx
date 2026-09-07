"use client";

import { Menu, X } from "lucide-react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuthRole } from "@/app/contexts/AuthRoleContext";
import type { AppModule } from "@/lib/appModules";

export type GlobalNavButtonsProps = {
  className?: string;
  /** Rendered between separator and Statistics (typically Jibble clock). */
  secondaryMiddle?: ReactNode;
  /** Rendered after View Archive (e.g. logout). */
  children?: ReactNode;
};

const btnBase =
  "inline-flex h-10 shrink-0 items-center justify-center rounded-lg border px-3 text-sm font-semibold transition sm:px-4";

const mobileBtnBase =
  "flex h-11 w-full items-center justify-center rounded-lg border px-4 text-sm font-semibold transition";

const idle = "border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800 dark:border-zinc-600";
const active = "border-zinc-100 bg-zinc-100 text-zinc-900 shadow-sm dark:border-zinc-100";

export default function GlobalNavButtons({ className, secondaryMiddle, children }: GlobalNavButtonsProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isLoading, isAdmin, canAccess } = useAuthRole();
  const [mobileOpen, setMobileOpen] = useState(false);

  const archive = searchParams.get("archive") === "1";
  const onWorkflowBoard = pathname === "/" || pathname === "/kanban";

  const aiStudioActive = pathname === "/ai-studio" || pathname.startsWith("/ai-studio/");
  const moodboardActive = pathname === "/moodboard" || pathname.startsWith("/moodboard/");
  const notesActive = pathname === "/notes" || pathname.startsWith("/notes/");
  const scriptsActive = pathname === "/scripts" || pathname.startsWith("/scripts/");
  const plannerActive = pathname === "/planner" || pathname.startsWith("/planner/");
  const schedulerActive = pathname === "/scheduler" || pathname.startsWith("/scheduler/");
  const statisticsActive = pathname === "/admin/statistics" || pathname.startsWith("/admin/statistics/");
  const crmActive = pathname === "/admin/crm" || pathname.startsWith("/admin/crm/");
  const workflowActive = pathname === "/kanban" || pathname === "/";
  const bookingActive = onWorkflowBoard && !archive && searchParams.get("booking") === "1";

  const show = (module: AppModule) => !isLoading && (isAdmin || canAccess(module));

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname, searchParams]);

  useEffect(() => {
    if (!mobileOpen) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileOpen]);

  const closeMobile = () => setMobileOpen(false);
  const linkClass = (isActive: boolean, stacked = false) =>
    `${stacked ? mobileBtnBase : btnBase} ${isActive ? active : idle}`;

  const navLinks = (stacked = false) => (
    <>
      {show("planner") ? (
        <Link href="/planner" className={linkClass(plannerActive, stacked)} prefetch onClick={closeMobile}>
          Planner
        </Link>
      ) : null}
      {show("workflow") ? (
        <Link
          href="/kanban"
          className={linkClass(workflowActive && !bookingActive, stacked)}
          prefetch
          onClick={closeMobile}
        >
          Workflow
        </Link>
      ) : null}
      {show("social_scheduler") ? (
        <Link href="/scheduler" className={linkClass(schedulerActive, stacked)} prefetch onClick={closeMobile}>
          Social Scheduler
        </Link>
      ) : null}
      {show("ai_studio") ? (
        <Link href="/ai-studio" className={linkClass(aiStudioActive, stacked)} prefetch onClick={closeMobile}>
          AI Studio
        </Link>
      ) : null}
      {show("moodboard") ? (
        <Link href="/moodboard" className={linkClass(moodboardActive, stacked)} prefetch onClick={closeMobile}>
          Moodboard
        </Link>
      ) : null}
      {show("notes") ? (
        <Link href="/notes" className={linkClass(notesActive, stacked)} prefetch onClick={closeMobile}>
          Notes
        </Link>
      ) : null}
      {show("scripts") ? (
        <Link href="/scripts" className={linkClass(scriptsActive, stacked)} prefetch onClick={closeMobile}>
          Scripts
        </Link>
      ) : null}
      {isLoading ? (
        <span
          className={`${stacked ? mobileBtnBase : btnBase} cursor-wait border-zinc-700 bg-zinc-900 text-zinc-400`}
          aria-hidden
        >
          Booking
        </span>
      ) : show("booking") ? (
        <Link
          href={isAdmin || canAccess("booking") ? "/?booking=1" : "/"}
          className={linkClass(
            bookingActive || (onWorkflowBoard && !archive && !show("workflow")),
            stacked
          )}
          scroll={false}
          onClick={closeMobile}
        >
          Booking
        </Link>
      ) : null}
      <div
        className={`shrink-0 bg-gray-600 ${stacked ? "my-1 h-px w-full" : "mx-2 h-6 w-px self-center"}`}
        aria-hidden
        role="presentation"
      />
      {stacked && secondaryMiddle ? (
        <div className="flex w-full justify-center py-1">{secondaryMiddle}</div>
      ) : (
        secondaryMiddle
      )}
      {show("statistics") ? (
        <Link
          href="/admin/statistics"
          className={linkClass(statisticsActive, stacked)}
          prefetch
          onClick={closeMobile}
        >
          Statistics
        </Link>
      ) : null}
      {show("crm") ? (
        <Link href="/admin/crm" className={linkClass(crmActive, stacked)} prefetch onClick={closeMobile}>
          CRM
        </Link>
      ) : null}
      {show("workflow") ? (
        <Link
          href={archive ? "/" : "/?archive=1"}
          className={linkClass(archive, stacked)}
          scroll={false}
          onClick={closeMobile}
        >
          {archive ? "View Active Board" : "View Archive"}
        </Link>
      ) : null}
      {stacked && children ? <div className="flex w-full justify-center pt-1">{children}</div> : children}
    </>
  );

  return (
    <div className={className ?? "relative flex w-full items-center justify-end gap-2"}>
      <button
        type="button"
        className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-100 transition hover:bg-zinc-800 md:hidden"
        aria-expanded={mobileOpen}
        aria-controls="global-mobile-nav"
        aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
        onClick={() => setMobileOpen((open) => !open)}
      >
        {mobileOpen ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
      </button>

      <nav
        className="hidden flex-wrap items-center justify-end gap-2 md:flex"
        aria-label="Workflow suite"
      >
        {navLinks(false)}
      </nav>

      {mobileOpen ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[95] bg-black/60 md:hidden"
            aria-label="Close navigation menu"
            onClick={closeMobile}
          />
          <nav
            id="global-mobile-nav"
            className="fixed inset-y-0 right-0 z-[96] flex w-[min(100vw-3rem,320px)] flex-col gap-2 overflow-y-auto border-l border-zinc-800 bg-zinc-950 p-4 shadow-2xl md:hidden"
            aria-label="Workflow suite mobile"
          >
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Navigation</p>
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-900"
                aria-label="Close navigation menu"
                onClick={closeMobile}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            {navLinks(true)}
          </nav>
        </>
      ) : null}
    </div>
  );
}
