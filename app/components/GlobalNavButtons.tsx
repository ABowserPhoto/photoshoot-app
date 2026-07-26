"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { useAuthRole } from "@/app/contexts/AuthRoleContext";

export type GlobalNavButtonsProps = {
  className?: string;
  /** Rendered between separator and Statistics. */
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
  const { isLoading, isAdmin } = useAuthRole();

  const archive = searchParams.get("archive") === "1";
  const onWorkflowBoard = pathname === "/" || pathname === "/kanban";

  const aiStudioActive = pathname === "/ai-studio" || pathname.startsWith("/ai-studio/");
  const moodboardActive = pathname === "/moodboard" || pathname.startsWith("/moodboard/");
  const notesActive = pathname === "/notes" || pathname.startsWith("/notes/");
  const plannerActive = pathname === "/planner" || pathname.startsWith("/planner/");
  const schedulerActive = pathname === "/scheduler" || pathname.startsWith("/scheduler/");
  const statisticsActive = pathname === "/admin/statistics" || pathname.startsWith("/admin/statistics/");
  const workflowActive = pathname === "/kanban" || pathname === "/";
  const bookingActive = onWorkflowBoard && !archive;

  return (
    <nav
      className={className ?? "flex flex-wrap items-center justify-end gap-2"}
      aria-label="Workflow suite"
    >
      <Link href="/planner" className={`${btnBase} ${plannerActive ? active : idle}`} prefetch>
        Planner
      </Link>
      <Link href="/kanban" className={`${btnBase} ${workflowActive ? active : idle}`} prefetch>
        Workflow
      </Link>
      <Link href="/scheduler" className={`${btnBase} ${schedulerActive ? active : idle}`} prefetch>
        Social Scheduler
      </Link>
      <Link
        href="/ai-studio"
        className={`${btnBase} ${aiStudioActive ? active : idle}`}
        prefetch
      >
        AI Studio
      </Link>
      <Link href="/moodboard" className={`${btnBase} ${moodboardActive ? active : idle}`} prefetch>
        Moodboard
      </Link>
      <Link href="/notes" className={`${btnBase} ${notesActive ? active : idle}`} prefetch>
        Notes
      </Link>
      {isLoading ? (
        <span
          className={`${btnBase} cursor-wait border-zinc-700 bg-zinc-900 text-zinc-400`}
          aria-hidden
        >
          Booking
        </span>
      ) : isAdmin ? (
        <Link
          href="/?booking=1"
          className={`${btnBase} ${bookingActive ? active : idle}`}
          scroll={false}
        >
          Booking
        </Link>
      ) : (
        <Link href="/" className={`${btnBase} ${bookingActive ? active : idle}`}>
          Booking
        </Link>
      )}
      <div
        className="mx-2 h-6 w-px shrink-0 self-center bg-gray-600"
        aria-hidden
        role="presentation"
      />
      {secondaryMiddle}
      {!isLoading && isAdmin ? (
        <Link
          href="/admin/statistics"
          className={`${btnBase} ${statisticsActive ? active : idle}`}
          prefetch
        >
          Statistics
        </Link>
      ) : null}
      <Link href={archive ? "/" : "/?archive=1"} className={`${btnBase} ${archive ? active : idle}`} scroll={false}>
        {archive ? "View Active Board" : "View Archive"}
      </Link>
      {children}
    </nav>
  );
}
