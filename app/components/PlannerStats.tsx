"use client";

import { useMemo, useState } from "react";

export type PlannerStatsTaskInput = {
  completedAt: string | null;
  elapsedSeconds: number;
};

type Timeframe = "week" | "month" | "year";

const MOCK_COMPLETED = 24;
const MOCK_AVG_SECONDS = 95 * 60 + 30;

function startOfTimeframe(now: Date, tf: Timeframe): Date {
  const d = new Date(now);
  if (tf === "week") {
    d.setDate(d.getDate() - 7);
  } else if (tf === "month") {
    d.setMonth(d.getMonth() - 1);
  } else {
    d.setFullYear(d.getFullYear() - 1);
  }
  return d;
}

function filterCompletedInRange(tasks: PlannerStatsTaskInput[], tf: Timeframe): PlannerStatsTaskInput[] {
  const now = new Date();
  const start = startOfTimeframe(now, tf);
  return tasks.filter((t) => {
    if (!t.completedAt) {
      return false;
    }
    const c = new Date(t.completedAt);
    return !Number.isNaN(c.getTime()) && c >= start && c <= now;
  });
}

export default function PlannerStats({ completedTasks }: { completedTasks: PlannerStatsTaskInput[] }) {
  const [timeframe, setTimeframe] = useState<Timeframe>("month");

  const { filtered, useMock, totalCompleted, avgSeconds } = useMemo(() => {
    const filteredIn = filterCompletedInRange(completedTasks, timeframe);
    const tooFew = filteredIn.length < 2;
    if (!tooFew) {
      const totalSecs = filteredIn.reduce((acc, t) => acc + Math.max(0, t.elapsedSeconds), 0);
      return {
        filtered: filteredIn,
        useMock: false,
        totalCompleted: filteredIn.length,
        avgSeconds: totalSecs / filteredIn.length,
      };
    }
    return {
      filtered: filteredIn,
      useMock: true,
      totalCompleted: MOCK_COMPLETED,
      avgSeconds: MOCK_AVG_SECONDS,
    };
  }, [completedTasks, timeframe]);

  const tfButtons: { id: Timeframe; label: string }[] = [
    { id: "week", label: "Week" },
    { id: "month", label: "Month" },
    { id: "year", label: "Year" },
  ];

  const avgMinutes = Math.round(avgSeconds / 60);
  const avgHours = avgSeconds / 3600;

  return (
    <section className="mb-3 rounded-md border border-zinc-200 bg-white p-1.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
        <div className="min-w-0">
          <h2 className="text-[10px] font-semibold leading-tight text-zinc-900 dark:text-zinc-100">
            Business analytics
          </h2>
          <p className="mt-0.5 text-[9px] leading-snug text-zinc-500 dark:text-zinc-400">
            Completed work in your studio planner
          </p>
        </div>
        <div className="inline-flex shrink-0 rounded-md border border-zinc-200 bg-zinc-50 p-0.5 dark:border-zinc-700 dark:bg-zinc-800/80">
          {tfButtons.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setTimeframe(b.id)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold leading-none transition ${
                timeframe === b.id
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-100"
                  : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-1 grid grid-cols-2 gap-1">
        <div className="rounded border border-zinc-100 bg-zinc-50/80 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800">
          <p className="text-[9px] font-medium uppercase leading-tight tracking-wide text-zinc-500 dark:text-zinc-300">
            Tasks completed
          </p>
          <p className="mt-0.5 text-sm font-bold tabular-nums leading-none text-zinc-900 dark:text-zinc-100">
            {totalCompleted}
          </p>
        </div>
        <div className="rounded border border-zinc-100 bg-zinc-50/80 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800">
          <p className="text-[9px] font-medium uppercase leading-tight tracking-wide text-zinc-500 dark:text-zinc-300">
            Avg. time to complete
          </p>
          <p className="mt-0.5 text-sm font-bold tabular-nums leading-none text-zinc-900 dark:text-zinc-100">
            {avgHours >= 1 ? `${avgHours.toFixed(1)}h` : `${avgMinutes}m`}
          </p>
        </div>
      </div>

      {useMock ? (
        <p className="mt-1 rounded border border-dashed border-amber-200/80 bg-amber-50/60 px-1.5 py-1 text-[9px] leading-snug text-amber-900 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-100/90">
          Showing sample benchmarks — only {filtered.length} completed task{filtered.length === 1 ? "" : "s"} in this
          period. Connect more history for live metrics.
        </p>
      ) : null}
    </section>
  );
}
