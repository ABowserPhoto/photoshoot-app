"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  getProductivityStats,
  getProductivityTeamUsers,
  type ProductivityDailyLog,
  type ProductivityTimeframe,
} from "@/app/actions/statistics";
import { useAuthRole } from "@/app/contexts/AuthRoleContext";
import { formatDurationLong } from "@/lib/adminStatsFormat";

type SortKey =
  | "date"
  | "userName"
  | "clockInAt"
  | "clockOutAt"
  | "shiftDurationMinutes"
  | "tasksCompleted"
  | "studioTasksCompleted"
  | "taskMinutes";

function formatMinutesShort(totalMinutes: number): string {
  const safe = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  if (hours === 0) {
    return `${minutes}m`;
  }
  return `${hours}h ${minutes}m`;
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function KpiCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-gradient-to-br from-zinc-900 to-zinc-950 p-5 shadow-lg shadow-black/20">
      <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-white">{value}</p>
      {hint ? <p className="mt-1 text-xs text-zinc-500">{hint}</p> : null}
    </div>
  );
}

export default function AdminStatisticsPage() {
  const { authenticated, isAdmin, isLoading: authLoading } = useAuthRole();
  const [timeframe, setTimeframe] = useState<ProductivityTimeframe>("week");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [teamUsers, setTeamUsers] = useState<{ id: string; name: string; email: string | null }[]>(
    []
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState({
    totalClockedInMinutes: 0,
    totalTaskMinutes: 0,
    utilizationRate: 0,
    totalTasksCompleted: 0,
    averageTaskDuration: 0,
  });
  const [buckets, setBuckets] = useState<
    Array<{
      label: string;
      totalClockedInMinutes: number;
      totalTaskMinutes: number;
      utilizationRate: number;
      tasksCompleted: number;
      studioTasksCompleted: number;
    }>
  >([]);
  const [dailyLogs, setDailyLogs] = useState<ProductivityDailyLog[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("clockInAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    if (!authenticated || !isAdmin) {
      return;
    }
    void getProductivityTeamUsers().then((res) => {
      if (res.ok) {
        setTeamUsers(res.users);
      }
    });
  }, [authenticated, isAdmin]);

  const loadStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getProductivityStats(timeframe, selectedUserId || undefined);
    if (!res.ok) {
      setError(res.error);
      setLoading(false);
      return;
    }
    setSummary(res.summary);
    setBuckets(
      res.buckets.map((bucket) => ({
        label: bucket.label,
        totalClockedInMinutes: bucket.totalClockedInMinutes,
        totalTaskMinutes: bucket.totalTaskMinutes,
        utilizationRate: bucket.utilizationRate,
        tasksCompleted: bucket.tasksCompleted,
        studioTasksCompleted: bucket.studioTasksCompleted,
      }))
    );
    setDailyLogs(res.dailyLogs);
    setLoading(false);
  }, [selectedUserId, timeframe]);

  useEffect(() => {
    if (authLoading || !authenticated || !isAdmin) {
      return;
    }
    void loadStats();
  }, [authLoading, authenticated, isAdmin, loadStats]);

  const sortedLogs = useMemo(() => {
    const rows = [...dailyLogs];
    rows.sort((a, b) => {
      const pick = (row: ProductivityDailyLog): string | number => {
        switch (sortKey) {
          case "date":
            return row.date;
          case "userName":
            return row.userName.toLowerCase();
          case "clockInAt":
            return row.clockInAt ? new Date(row.clockInAt).getTime() : 0;
          case "clockOutAt":
            return row.clockOutAt ? new Date(row.clockOutAt).getTime() : 0;
          case "shiftDurationMinutes":
            return row.shiftDurationMinutes;
          case "tasksCompleted":
            return row.tasksCompleted;
          case "studioTasksCompleted":
            return row.studioTasksCompleted;
          case "taskMinutes":
            return row.taskMinutes;
          default:
            return 0;
        }
      };
      const av = pick(a);
      const bv = pick(b);
      if (av === bv) {
        return 0;
      }
      if (av < bv) {
        return sortDir === "asc" ? -1 : 1;
      }
      return sortDir === "asc" ? 1 : -1;
    });
    return rows;
  }, [dailyLogs, sortDir, sortKey]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir("desc");
  };

  if (authLoading) {
    return (
      <main className="flex min-h-[50vh] items-center justify-center text-sm text-zinc-400">
        Checking access…
      </main>
    );
  }

  if (!authenticated || !isAdmin) {
    return (
      <main className="flex min-h-[50vh] flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-sm text-zinc-300">Admin access required.</p>
        <Link href="/" className="text-sm font-semibold text-white underline">
          Back to workflow
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100dvh-64px)] bg-zinc-950 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-400">
              Admin analytics
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">
              Productivity dashboard
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-zinc-400">
              Shift time vs completed Kanban tasks and studio planner work, merged across both task
              systems.
            </p>
          </div>
          <Link
            href="/"
            className="inline-flex h-10 items-center rounded-lg border border-zinc-700 bg-zinc-900 px-4 text-sm font-semibold text-zinc-100 hover:bg-zinc-800"
          >
            Back to workflow
          </Link>
        </header>

        <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
          <label className="flex min-w-[160px] flex-col gap-1 text-xs font-medium text-zinc-400">
            Timeframe
            <select
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value as ProductivityTimeframe)}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500"
            >
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
              <option value="year">Year</option>
            </select>
          </label>
          <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs font-medium text-zinc-400">
            Team member
            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500"
            >
              <option value="">Entire team</option>
              {teamUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void loadStats()}
            disabled={loading}
            className="mt-5 inline-flex h-10 items-center rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </section>

        {error ? (
          <div className="rounded-xl border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Total clocked time"
            value={formatDurationLong(summary.totalClockedInMinutes)}
            hint="From user_shifts"
          />
          <KpiCard
            label="Total task time"
            value={formatDurationLong(summary.totalTaskMinutes)}
            hint="Kanban tasks + studio tasks"
          />
          <KpiCard
            label="Utilization rate"
            value={`${summary.utilizationRate.toFixed(1)}%`}
            hint="Task time ÷ clocked time"
          />
          <KpiCard
            label="Total completed"
            value={String(summary.totalTasksCompleted)}
            hint={`Avg ${formatMinutesShort(summary.averageTaskDuration)} per task`}
          />
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
            <h2 className="text-sm font-semibold text-zinc-100">Clocked vs task time</h2>
            <p className="mt-1 text-xs text-zinc-500">Bars show minutes; line shows utilization %</p>
            <div className="mt-4 h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={buckets}>
                  <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fill: "#a1a1aa", fontSize: 11 }} />
                  <YAxis yAxisId="left" tick={{ fill: "#a1a1aa", fontSize: 11 }} />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    domain={[0, 100]}
                    tick={{ fill: "#a1a1aa", fontSize: 11 }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#18181b",
                      border: "1px solid #3f3f46",
                      borderRadius: 12,
                    }}
                    labelStyle={{ color: "#fafafa" }}
                  />
                  <Legend />
                  <Bar
                    yAxisId="left"
                    dataKey="totalClockedInMinutes"
                    name="Clocked (min)"
                    fill="#6366f1"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    yAxisId="left"
                    dataKey="totalTaskMinutes"
                    name="Task (min)"
                    fill="#22d3ee"
                    radius={[4, 4, 0, 0]}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="utilizationRate"
                    name="Utilization %"
                    stroke="#f472b6"
                    strokeWidth={2}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
            <h2 className="text-sm font-semibold text-zinc-100">Tasks completed</h2>
            <p className="mt-1 text-xs text-zinc-500">Kanban tasks vs studio tasks</p>
            <div className="mt-4 h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={buckets}>
                  <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fill: "#a1a1aa", fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fill: "#a1a1aa", fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{
                      background: "#18181b",
                      border: "1px solid #3f3f46",
                      borderRadius: 12,
                    }}
                  />
                  <Legend />
                  <Bar
                    dataKey="tasksCompleted"
                    name="Kanban tasks"
                    stackId="completed"
                    fill="#34d399"
                    radius={[0, 0, 0, 0]}
                  />
                  <Bar
                    dataKey="studioTasksCompleted"
                    name="Studio tasks"
                    stackId="completed"
                    fill="#fbbf24"
                    radius={[4, 4, 0, 0]}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <h2 className="text-sm font-semibold text-zinc-100">Daily shift logs</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Shift records with task completions attributed to each clocked session
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
                  {(
                    [
                      ["date", "Date"],
                      ["userName", "User"],
                      ["clockInAt", "Clock in"],
                      ["clockOutAt", "Clock out"],
                      ["shiftDurationMinutes", "Shift"],
                      ["tasksCompleted", "Tasks"],
                      ["studioTasksCompleted", "Studio"],
                      ["taskMinutes", "Task min"],
                    ] as const
                  ).map(([key, label]) => (
                    <th key={key} className="px-3 py-2 font-semibold">
                      <button
                        type="button"
                        onClick={() => toggleSort(key)}
                        className="inline-flex items-center gap-1 hover:text-zinc-200"
                      >
                        {label}
                        {sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : null}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedLogs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-zinc-500">
                      {loading ? "Loading shift logs…" : "No shift logs in this timeframe."}
                    </td>
                  </tr>
                ) : (
                  sortedLogs.map((row) => (
                    <tr key={row.id} className="border-b border-zinc-800/80 text-zinc-200">
                      <td className="px-3 py-2">{row.date || "—"}</td>
                      <td className="px-3 py-2">{row.userName}</td>
                      <td className="px-3 py-2">{formatDateTime(row.clockInAt)}</td>
                      <td className="px-3 py-2">{formatDateTime(row.clockOutAt)}</td>
                      <td className="px-3 py-2">{formatMinutesShort(row.shiftDurationMinutes)}</td>
                      <td className="px-3 py-2">{row.tasksCompleted}</td>
                      <td className="px-3 py-2">{row.studioTasksCompleted}</td>
                      <td className="px-3 py-2">{formatMinutesShort(row.taskMinutes)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
