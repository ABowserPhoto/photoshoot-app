"use client";

import { useEffect, useMemo, useState } from "react";

import { useAuthRole } from "@/app/contexts/AuthRoleContext";

type BillingTaskRow = {
  id: string;
  client_name: string | null;
  total_fee: number | null;
  completed_at: string | null;
  status: string | null;
};

const PINNED_CLIENTS = ["Wolt", "Real Estate"];

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}`;
}

function euro(value: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(value);
}

function isCompletedLikeStatus(status: string | null | undefined): boolean {
  const raw = (status ?? "").trim().toLowerCase().replace(/\s+/g, "-");
  return (
    raw === "completed" ||
    raw === "ready-for-review" ||
    raw === "ready_for_review" ||
    raw === "send-email" ||
    raw === "send_email"
  );
}

export default function MonthlyBillingSummary() {
  const { authenticated, isAdmin, isLoading } = useAuthRole();
  const [rows, setRows] = useState<BillingTaskRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isLoading || !authenticated || !isAdmin) {
      return;
    }

    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/planner/tasks", { cache: "no-store", credentials: "include" });
        const json = (await response.json().catch(() => null)) as { data?: BillingTaskRow[]; error?: string } | null;
        if (!response.ok) {
          throw new Error(json?.error ?? `Failed to load billing tasks (${response.status})`);
        }
        if (!cancelled) {
          setRows(json?.data ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load billing tasks.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [authenticated, isAdmin, isLoading]);

  const { entries, total } = useMemo(() => {
    const now = new Date();
    const currentMonthKey = monthKey(now);
    const grouped = new Map<string, number>();

    for (const row of rows) {
      if (!isCompletedLikeStatus(row.status) || !row.completed_at) {
        continue;
      }
      const completedDate = new Date(row.completed_at);
      if (Number.isNaN(completedDate.getTime())) {
        continue;
      }
      if (monthKey(completedDate) !== currentMonthKey) {
        continue;
      }
      const fee = typeof row.total_fee === "number" && Number.isFinite(row.total_fee) ? row.total_fee : 0;
      const client = row.client_name?.trim() || "Unknown";
      grouped.set(client, (grouped.get(client) ?? 0) + fee);
    }

    for (const pinnedClient of PINNED_CLIENTS) {
      if (!grouped.has(pinnedClient)) {
        grouped.set(pinnedClient, 0);
      }
    }

    const sortedEntries = [...grouped.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const totalRevenue = sortedEntries.reduce((acc, [, value]) => acc + value, 0);
    return { entries: sortedEntries, total: totalRevenue };
  }, [rows]);

  if (isLoading || !authenticated || !isAdmin) {
    return null;
  }

  if (loading) {
    return (
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Monthly Billing Summary</p>
        <p className="mt-2 text-sm text-zinc-400">Loading monthly revenue…</p>
      </section>
    );
  }

  const now = new Date();

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Monthly Billing Summary
      </p>
      <p className="mt-1 text-sm text-zinc-400">
        {new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(now)}
      </p>
      <p className="mt-2 text-xl font-semibold text-white">Current Month Revenue: {euro(total)}</p>
      {error ? (
        <p className="mt-2 text-xs text-red-300">{error}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {entries.map(([client, amount]) => (
          <span
            key={client}
            className="inline-flex rounded-full border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-100"
          >
            {client}: {euro(amount)}
          </span>
        ))}
        {entries.length === 0 ? (
          <span className="inline-flex rounded-full border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-400">
            No completed billing tasks this month.
          </span>
        ) : null}
      </div>
    </section>
  );
}
