"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

const btnBase =
  "inline-flex h-10 shrink-0 items-center justify-center rounded-lg border px-3 text-sm font-semibold transition sm:px-4";

const idle = "border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800 dark:border-zinc-600";
const active = "border-zinc-100 bg-zinc-100 text-zinc-900 shadow-sm dark:border-zinc-100";

export default function WorkflowArchiveLink() {
  const searchParams = useSearchParams();
  const archive = searchParams.get("archive") === "1";
  const href = archive ? "/" : "/?archive=1";

  return (
    <Link href={href} className={`${btnBase} ${archive ? active : idle}`} scroll={false}>
      {archive ? "View Active Board" : "View Archive"}
    </Link>
  );
}
