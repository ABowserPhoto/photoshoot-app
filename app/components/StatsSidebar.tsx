"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { formatDurationLong, formatEuro } from "@/lib/adminStatsFormat";
import { buildAdminStatsQuery } from "@/lib/reportingPeriod";
import { supabase } from "@/lib/supabaseClient";

type StatsMetrics = {
  averageEditTimeMinutes: number;
  averageTotalTimeMinutes: number;
  totalBookings: number;
  totalNetRevenue: number;
  totalTaxes: number;
};

type StatsResponse = {
  generatedAt: string;
  range: {
    start: string;
    end: string;
    subtitle: string;
    label: string;
  };
  metrics: StatsMetrics;
};

type StatsSidebarProps = {
  refreshSignal?: number;
};

export default function StatsSidebar({ refreshSignal = 0 }: StatsSidebarProps) {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  const realtimeRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentMonthQuery = useMemo(() => {
    const now = new Date();
    return buildAdminStatsQuery({
      timeframe: "month",
      selectedMonthValue: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
    });
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      if (realtimeRefreshTimeoutRef.current) {
        clearTimeout(realtimeRefreshTimeoutRef.current);
        realtimeRefreshTimeoutRef.current = null;
      }
      isMountedRef.current = false;
    };
  }, []);

  const fetchStats = useCallback(async (showLoading = true) => {
    if (showLoading && isMountedRef.current) {
      setLoading(true);
    }
    if (isMountedRef.current) {
      setError(null);
    }
    try {
      const response = await fetch(`/api/admin-stats${currentMonthQuery}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as
        | StatsResponse
        | {
            error?: string;
          }
        | null;
      if (!response.ok) {
        throw new Error(payload && "error" in payload ? payload.error || "Failed to load business stats." : "");
      }
      if (isMountedRef.current) {
        setStats(payload as StatsResponse);
      }
    } catch (fetchError) {
      if (isMountedRef.current) {
        setError(fetchError instanceof Error ? fetchError.message : "Failed to load business stats.");
      }
    } finally {
      if (showLoading && isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [currentMonthQuery]);

  const scheduleRealtimeRefresh = useCallback(() => {
    if (realtimeRefreshTimeoutRef.current) {
      clearTimeout(realtimeRefreshTimeoutRef.current);
    }
    realtimeRefreshTimeoutRef.current = setTimeout(() => {
      realtimeRefreshTimeoutRef.current = null;
      void fetchStats(false);
    }, 400);
  }, [fetchStats]);

  useEffect(() => {
    if (realtimeRefreshTimeoutRef.current) {
      clearTimeout(realtimeRefreshTimeoutRef.current);
      realtimeRefreshTimeoutRef.current = null;
    }
    void fetchStats();
  }, [fetchStats, refreshSignal]);

  useEffect(() => {
    if (!supabase) {
      return;
    }

    const channel = supabase
      .channel("admin-stats-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "tasks" }, () => {
        scheduleRealtimeRefresh();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "tasks" }, () => {
        scheduleRealtimeRefresh();
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "tasks" }, () => {
        scheduleRealtimeRefresh();
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [scheduleRealtimeRefresh]);

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
    return stats.metrics;
  }, [stats]);

  return (
    <aside className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-900 dark:text-zinc-100">
          Business Statistics
        </h2>
        <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
          {stats?.range.label ? `Current month: ${stats.range.label}` : "Current month overview"}
        </p>
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
