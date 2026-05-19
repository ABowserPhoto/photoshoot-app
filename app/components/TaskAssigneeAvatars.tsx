"use client";

import type { PlannerAssignee } from "@/lib/plannerAssignees";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function TaskAssigneeAvatars({
  assignees,
  className = "",
}: {
  assignees: PlannerAssignee[];
  className?: string;
}) {
  if (!assignees.length) {
    return null;
  }

  const max = 4;
  const shown = assignees.slice(0, max);
  const extra = assignees.length - max;

  return (
    <div className={`flex items-center ${className}`}>
      <div className="flex -space-x-1.5">
        {shown.map((u, i) => (
          <div
            key={u.id}
            title={u.name}
            className="relative flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-gradient-to-br from-zinc-300 to-zinc-400 text-[8px] font-bold text-zinc-900 shadow-sm dark:border-zinc-800 dark:from-zinc-600 dark:to-zinc-700 dark:text-zinc-100"
            style={{ zIndex: shown.length - i }}
          >
            {u.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element -- avatar URLs may be external
              <img src={u.avatar} alt="" className="h-full w-full object-cover" />
            ) : (
              initials(u.name)
            )}
          </div>
        ))}
        {extra > 0 ? (
          <div className="relative z-0 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-white bg-zinc-500 text-[8px] font-semibold text-white dark:border-zinc-800">
            +{extra}
          </div>
        ) : null}
      </div>
    </div>
  );
}
