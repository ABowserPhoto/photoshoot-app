"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

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

const idle = "border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800 dark:border-zinc-600";
const active = "border-zinc-100 bg-zinc-100 text-zinc-900 shadow-sm dark:border-zinc-100";

export default function GlobalNavButtons({ className, secondaryMiddle, children }: GlobalNavButtonsProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isLoading, isAdmin, canAccess } = useAuthRole();

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

  return (
    <nav
      className={className ?? "flex flex-wrap items-center justify-end gap-2"}
      aria-label="Workflow suite"
    >
      {show("planner") ? (
        <Link href="/planner" className={`${btnBase} ${plannerActive ? active : idle}`} prefetch>
          Planner
        </Link>
      ) : null}
      {show("workflow") ? (
        <Link href="/kanban" className={`${btnBase} ${workflowActive && !bookingActive ? active : idle}`} prefetch>
          Workflow
        </Link>
      ) : null}
      {show("social_scheduler") ? (
        <Link href="/scheduler" className={`${btnBase} ${schedulerActive ? active : idle}`} prefetch>
          Social Scheduler
        </Link>
      ) : null}
      {show("ai_studio") ? (
        <Link
          href="/ai-studio"
          className={`${btnBase} ${aiStudioActive ? active : idle}`}
          prefetch
        >
          AI Studio
        </Link>
      ) : null}
      {show("moodboard") ? (
        <Link href="/moodboard" className={`${btnBase} ${moodboardActive ? active : idle}`} prefetch>
          Moodboard
        </Link>
      ) : null}
      {show("notes") ? (
        <Link href="/notes" className={`${btnBase} ${notesActive ? active : idle}`} prefetch>
          Notes
        </Link>
      ) : null}
      {show("scripts") ? (
        <Link href="/scripts" className={`${btnBase} ${scriptsActive ? active : idle}`} prefetch>
          Scripts
        </Link>
      ) : null}
      {isLoading ? (
        <span
          className={`${btnBase} cursor-wait border-zinc-700 bg-zinc-900 text-zinc-400`}
          aria-hidden
        >
          Booking
        </span>
      ) : show("booking") ? (
        <Link
          href={isAdmin || canAccess("booking") ? "/?booking=1" : "/"}
          className={`${btnBase} ${bookingActive || (onWorkflowBoard && !archive && !show("workflow")) ? active : idle}`}
          scroll={false}
        >
          Booking
        </Link>
      ) : null}
      <div
        className="mx-2 h-6 w-px shrink-0 self-center bg-gray-600"
        aria-hidden
        role="presentation"
      />
      {secondaryMiddle}
      {show("statistics") ? (
        <Link
          href="/admin/statistics"
          className={`${btnBase} ${statisticsActive ? active : idle}`}
          prefetch
        >
          Statistics
        </Link>
      ) : null}
      {show("crm") ? (
        <Link href="/admin/crm" className={`${btnBase} ${crmActive ? active : idle}`} prefetch>
          CRM
        </Link>
      ) : null}
      {show("workflow") ? (
        <Link href={archive ? "/" : "/?archive=1"} className={`${btnBase} ${archive ? active : idle}`} scroll={false}>
          {archive ? "View Active Board" : "View Archive"}
        </Link>
      ) : null}
      {children}
    </nav>
  );
}
