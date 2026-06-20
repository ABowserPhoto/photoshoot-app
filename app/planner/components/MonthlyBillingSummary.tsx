"use client";

import { useEffect, useMemo, useState } from "react";

import { getCreditNoteBillingSummary, type CreditNoteBillingClientGroup } from "@/app/actions/statistics";
import { useAuthRole } from "@/app/contexts/AuthRoleContext";
import { formatReportingPeriodLabel, type ReportingPeriodInput } from "@/lib/reportingPeriod";

function euro(value: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(value);
}

type BillingSummaryProps = ReportingPeriodInput;

export default function MonthlyBillingSummary(props: BillingSummaryProps) {
  const { authenticated, isAdmin, isLoading } = useAuthRole();
  const [groups, setGroups] = useState<CreditNoteBillingClientGroup[]>([]);
  const [totalExpected, setTotalExpected] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const periodLabel = useMemo(() => formatReportingPeriodLabel(props), [props]);
  const periodKey = useMemo(() => JSON.stringify(props), [props]);

  useEffect(() => {
    if (isLoading || !authenticated || !isAdmin) {
      return;
    }

    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await getCreditNoteBillingSummary(props);
        if (!cancelled) {
          if (!result.ok) {
            setError(result.error);
            setGroups([]);
            setTotalExpected(0);
          } else {
            setGroups(result.groups);
            setTotalExpected(result.totalExpected);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load billing summary.");
          setGroups([]);
          setTotalExpected(0);
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
  }, [authenticated, isAdmin, isLoading, periodKey, props]);

  if (isLoading || !authenticated || !isAdmin) {
    return null;
  }

  if (loading) {
    return (
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Billing summary</p>
        <p className="mt-2 text-sm text-zinc-400">Loading credit note revenue for {periodLabel}…</p>
      </section>
    );
  }

  return (
    <section id="monthly-billing" className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Billing summary</p>
      <p className="mt-1 text-sm text-zinc-400">Credit note shoots for {periodLabel}</p>
      <p className="mt-2 text-xl font-semibold text-white">Total expected: {euro(totalExpected)}</p>
      {error ? <p className="mt-2 text-xs text-red-300">{error}</p> : null}
      <div className="mt-4 space-y-4">
        {groups.map((group) => (
          <div key={group.clientName} className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
            <p className="text-sm font-semibold text-zinc-100">
              {group.clientName} — Total expected: {euro(group.totalExpected)}
            </p>
            <ul className="mt-2 space-y-1">
              {group.jobs.map((job) => (
                <li key={job.id} className="text-sm text-zinc-400">
                  <span className="text-zinc-300">{job.jobDateLabel}:</span> {job.jobName} —{" "}
                  <span className="text-zinc-200">{euro(job.expectedRevenue)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {groups.length === 0 && !error ? (
          <p className="text-sm text-zinc-500">No credit note shoots for {periodLabel}.</p>
        ) : null}
      </div>
    </section>
  );
}
