"use client";

import { useEffect, useMemo, useState } from "react";

import { formatDurationLong, formatEuro } from "@/lib/adminStatsFormat";

type TimeframeKey = "week" | "month" | "year" | "lastYear";

type StatsMetrics = {
  averageEditTimeMinutes: number;
  averageTotalTimeMinutes: number;
  totalBookings: number;
  totalNetRevenue: number;
  totalTaxes: number;
};

type StatsResponse = {
  generatedAt: string;
  labels: Record<TimeframeKey, string>;
  ranges: Record<
    TimeframeKey,
    {
      start: string;
      end: string;
      subtitle: string;
    }
  >;
  metrics: Record<TimeframeKey, StatsMetrics>;
};

const TIMEFRAME_ORDER: TimeframeKey[] = ["week", "month", "year", "lastYear"];

export default function StatsSidebar() {
  const [activeFrame, setActiveFrame] = useState<TimeframeKey>("week");
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/admin-stats", { cache: "no-store" });
        const payload = (await response.json().catch(() => null)) as
          | StatsResponse
          | {
              error?: string;
            }
          | null;
        if (!response.ok) {
          throw new Error(payload && "error" in payload ? payload.error || "Failed to load business stats." : "");
        }
        if (isMounted) {
          setStats(payload as StatsResponse);
        }
      } catch (fetchError) {
        if (isMounted) {
          setError(fetchError instanceof Error ? fetchError.message : "Failed to load business stats.");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };
    void run();
    return () => {
      isMounted = false;
    };
  }, []);

  const activeMetrics = useMemo<StatsMetrics>(() => {
    if (!stats) {
      return {
        averageEditTimeMinutes: 0,
        averageTotalTimeMinutes: 0,
        totalBookings: 0,
        totalNetRevenue: 0,
        totalTaxes: 0,
      };
    }
    return stats.metrics[activeFrame];
  }, [activeFrame, stats]);

  return (
    <aside className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-900 dark:text-zinc-100">
          Business Statistics
        </h2>
        <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
          Admin view: efficiency and financial health.
        </p>
      </div>

      <div className="mb-3 grid grid-cols-1 gap-1.5">
        {TIMEFRAME_ORDER.map((key) => {
          const label = stats?.labels[key] ?? key;
          const subtitle = stats?.ranges?.[key]?.subtitle ?? "";
          const active = key === activeFrame;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setActiveFrame(key)}
              className={`w-full rounded-md border px-1.5 py-1 text-left text-[11px] transition ${
                active
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              <span className="block font-medium leading-tight">{label}</span>
              <span
                className={`block text-[9px] leading-tight ${
                  active ? "text-zinc-200 dark:text-zinc-700" : "text-zinc-500 dark:text-zinc-400"
                }`}
              >
                {subtitle}
              </span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Loading business statistics...</p>
      ) : error ? (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : (
        <div className="space-y-2">
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-800/50">
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">Average Edit Time</p>
            <p className="mt-0.5 text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              {formatDurationLong(activeMetrics.averageEditTimeMinutes)}
            </p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-800/50">
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">Average Total Time</p>
            <p className="mt-0.5 text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              {formatDurationLong(activeMetrics.averageTotalTimeMinutes)}
            </p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-800/50">
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">Total Number of Bookings</p>
            <p className="mt-0.5 text-xs font-semibold text-zinc-900 dark:text-zinc-100">{activeMetrics.totalBookings}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-800/50">
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">Total Net Revenue</p>
            <p className="mt-0.5 text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              {formatEuro(activeMetrics.totalNetRevenue)}
            </p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-800/50">
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">Total Taxes</p>
            <p className="mt-0.5 text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              {formatEuro(activeMetrics.totalTaxes)}
            </p>
          </div>
        </div>
      )}
    </aside>
  );
}
