"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  aggregateAccounts,
  defaultRange,
  detailMetrics,
  formatMetricValue,
  formatSignedCount,
  platformLabel,
  summaryMetrics,
  type ClientSocialMetrics,
  type SocialAccountMetrics,
  type SocialMetric,
  type SocialPlatform,
  type SocialTopPost,
} from "@/lib/socialMetricsModel";

type SocialMetricsPanelProps = {
  clientId: string;
  clientName: string;
  onManageConnections: () => void;
};

type PresetId = "7" | "28" | "90" | "custom";

const PRESETS: Array<{ id: PresetId; label: string; days: number }> = [
  { id: "7", label: "7 days", days: 7 },
  { id: "28", label: "28 days", days: 28 },
  { id: "90", label: "90 days", days: 90 },
  { id: "custom", label: "Custom", days: 0 },
];

const CHART_SERIES = [
  { key: "followers", name: "Followers", stroke: "#c4b5fd" },
  { key: "reach", name: "Reach", stroke: "#6366f1" },
  { key: "views", name: "Views", stroke: "#22d3ee" },
  { key: "interactions", name: "Interactions", stroke: "#f472b6" },
] as const;

const dateInputClassName =
  "h-10 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none focus:border-violet-500 [color-scheme:dark]";

function initialRange() {
  return defaultRange(28);
}

export default function SocialMetricsPanel({
  clientId,
  clientName,
  onManageConnections,
}: SocialMetricsPanelProps) {
  const initial = initialRange();
  const [preset, setPreset] = useState<PresetId>("28");
  const [rangeStart, setRangeStart] = useState(initial.start);
  const [rangeEnd, setRangeEnd] = useState(initial.end);
  const [accountFilter, setAccountFilter] = useState("all");
  const [data, setData] = useState<ClientSocialMetrics | null>(null);
  const [loading, setLoading] = useState(Boolean(clientId));
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const forceRefreshRef = useRef(false);

  useEffect(() => {
    if (!clientId) return;
    const controller = new AbortController();
    let cancelled = false;
    const refresh = forceRefreshRef.current;
    forceRefreshRef.current = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/social/metrics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId, rangeStart, rangeEnd, refresh }),
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => null)) as { error?: string } | ClientSocialMetrics | null;
        if (!response.ok) {
          throw new Error(payload && "error" in payload && payload.error ? payload.error : "Could not load metrics.");
        }
        if (!cancelled) setData(payload as ClientSocialMetrics);
      } catch (caught) {
        if (cancelled || (caught instanceof DOMException && caught.name === "AbortError")) return;
        setError(caught instanceof Error ? caught.message : "Could not load metrics.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [clientId, rangeStart, rangeEnd, reloadKey]);

  const accounts = useMemo(() => data?.accounts ?? [], [data]);
  const selected = accountFilter === "all" ? null : accounts.find((account) => account.accountKey === accountFilter) ?? null;
  const aggregate = useMemo(() => aggregateAccounts(selected ? [selected] : accounts), [accounts, selected]);
  const cards = summaryMetrics(aggregate.metrics);
  const extras = selected ? detailMetrics(selected.metrics) : [];
  const chartRows = chartData(aggregate.series);
  const chartKeys = CHART_SERIES.filter((series) => chartRows.some((row) => typeof row[series.key] === "number"));

  const applyPreset = (next: PresetId) => {
    setPreset(next);
    const match = PRESETS.find((item) => item.id === next);
    if (!match || match.days < 1) return;
    const range = defaultRange(match.days);
    setRangeStart(range.start);
    setRangeEnd(range.end);
  };

  return (
    <div className="w-full space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-zinc-100">{clientName} metrics</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Followers, reach, and interactions for every connected account. Filter to one account, including Instagram.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onManageConnections}
            className="inline-flex h-10 items-center rounded-lg border border-violet-500/45 bg-violet-500/10 px-3 text-xs font-semibold text-violet-100 hover:bg-violet-500/15"
          >
            Manage connections
          </button>
          <button
            type="button"
            onClick={() => {
              forceRefreshRef.current = true;
              setReloadKey((value) => value + 1);
            }}
            disabled={loading}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-violet-600 px-3 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="flex flex-wrap gap-1" role="group" aria-label="Date range">
            {PRESETS.map((item) => {
              const active = preset === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => applyPreset(item.id)}
                  className={`rounded-md border px-3 py-2 text-xs font-semibold ${
                    active
                      ? "border-zinc-200 bg-zinc-100 text-zinc-900"
                      : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
          <label className="min-w-[140px] flex-1 text-[11px] uppercase tracking-wide text-zinc-500">
            Start
            <input
              type="date"
              value={rangeStart}
              max={rangeEnd}
              onChange={(event) => {
                setPreset("custom");
                setRangeStart(event.target.value);
              }}
              className={`mt-1 ${dateInputClassName}`}
            />
          </label>
          <label className="min-w-[140px] flex-1 text-[11px] uppercase tracking-wide text-zinc-500">
            End
            <input
              type="date"
              value={rangeEnd}
              min={rangeStart}
              onChange={(event) => {
                setPreset("custom");
                setRangeEnd(event.target.value);
              }}
              className={`mt-1 ${dateInputClassName}`}
            />
          </label>
          <label className="min-w-[180px] flex-[1.4] text-[11px] uppercase tracking-wide text-zinc-500">
            Account
            <select
              value={accountFilter}
              onChange={(event) => setAccountFilter(event.target.value)}
              className={`mt-1 ${dateInputClassName}`}
            >
              <option value="all">All accounts</option>
              {accounts.map((account) => (
                <option key={account.accountKey} value={account.accountKey}>
                  {platformLabel(account.platform)} · {account.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {data ? (
          <p className="mt-3 text-[11px] text-zinc-500">
            {data.historyAvailable
              ? "Snapshots are cached for 6 hours so repeated views stay inside platform rate limits. Follower growth builds from daily snapshots."
              : "Live metrics are showing. History caching is waiting on the social metrics migration."}
            {accounts.some((account) => account.fromCache) ? " Some accounts are from the latest snapshot." : ""}
          </p>
        ) : null}
      </div>

      {data ? <PlatformStrip platforms={data.platforms} /> : null}

      {error ? (
        <div className="rounded-xl border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">{error}</div>
      ) : null}

      {!clientId ? (
        <p className="text-sm text-zinc-400">Select a client to view metrics.</p>
      ) : null}

      {clientId && loading && !data ? (
        <p className="text-sm text-zinc-400">Loading metrics…</p>
      ) : null}

      {data && accounts.length === 0 ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 px-4 py-8 text-center">
          <p className="text-sm font-semibold text-zinc-100">No connected accounts for {clientName}</p>
          <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-zinc-400">
            Connect Instagram, Facebook (via the Meta login), TikTok, or a LinkedIn organization page. Personal LinkedIn
            profiles do not expose analytics.
          </p>
        </div>
      ) : null}

      {cards.length > 0 ? (
        <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {cards.map((item) => (
            <MetricCard key={item.key} metric={item} />
          ))}
        </section>
      ) : null}

      {data && accounts.length > 0 && cards.length === 0 && !loading ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          Connected accounts did not return numbers for this range. Check the account notes below, or reconnect and approve
          the analytics permissions.
        </div>
      ) : null}

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <h3 className="text-sm font-semibold text-zinc-100">
          {selected ? `${platformLabel(selected.platform)} · ${selected.label}` : "All accounts"}
        </h3>
        <p className="mt-1 text-xs text-zinc-500">
          {selected
            ? selected.statusMessage || "Daily values for the selected range."
            : "Counts are added together. Engagement rate is recalculated from the combined reach."}
        </p>
        {chartKeys.length > 0 ? (
          <div className="mt-4 h-64 w-full md:h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartRows}>
                <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fill: "#a1a1aa", fontSize: 11 }} />
                <YAxis tick={{ fill: "#a1a1aa", fontSize: 11 }} width={40} />
                <Tooltip
                  contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 12 }}
                  labelStyle={{ color: "#fafafa" }}
                />
                <Legend />
                {chartKeys.map((series) => (
                  <Line
                    key={series.key}
                    type="monotone"
                    dataKey={series.key}
                    name={series.name}
                    stroke={series.stroke}
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="mt-4 text-xs leading-relaxed text-zinc-500">
            No daily series for this range yet. Follower growth appears after the next daily snapshot, and reach charts
            appear when the platform returns day-by-day insights.
          </p>
        )}
      </section>

      {accounts.length > 1 ? (
        <AccountBreakdown
          accounts={accounts}
          selectedKey={accountFilter}
          onSelect={setAccountFilter}
        />
      ) : null}

      {extras.length > 0 ? (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <h3 className="text-sm font-semibold text-zinc-100">More from this account</h3>
          <dl className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
            {extras.map((item) => (
              <div key={item.key} className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-3">
                <dt className="text-[11px] uppercase tracking-wide text-zinc-500">{item.label}</dt>
                <dd className="mt-1 text-lg font-semibold text-white">{formatMetricValue(item.value, item.style)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {aggregate.topPosts.length > 0 ? (
        <section>
          <h3 className="text-sm font-semibold text-zinc-100">Top posts</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {aggregate.topPosts.map((post) => (
              <TopPostCard key={`${post.accountKey}:${post.id}`} post={post} />
            ))}
          </div>
        </section>
      ) : null}

      {accounts.some((account) => account.statusMessage) ? (
        <ul className="space-y-2">
          {accounts
            .filter((account) => account.statusMessage && (selected ? account.accountKey === selected.accountKey : true))
            .map((account) => (
              <li
                key={`${account.accountKey}-note`}
                className={`rounded-xl border px-3 py-2 text-xs leading-relaxed ${
                  account.status === "error"
                    ? "border-amber-500/30 bg-amber-500/10 text-amber-100"
                    : "border-zinc-800 bg-zinc-900/60 text-zinc-400"
                }`}
              >
                <span className="font-semibold text-zinc-200">
                  {platformLabel(account.platform)} · {account.label}:
                </span>{" "}
                {account.statusMessage}
              </li>
            ))}
        </ul>
      ) : null}
    </div>
  );
}

function MetricCard({ metric }: { metric: SocialMetric }) {
  const growth = metric.key === "follower_growth";
  const value = growth ? formatSignedCount(metric.value) : formatMetricValue(metric.value, metric.style);
  const tone =
    !growth || metric.value === null
      ? "text-white"
      : metric.value > 0
        ? "text-emerald-300"
        : metric.value < 0
          ? "text-red-300"
          : "text-white";
  return (
    <div className="rounded-2xl border border-zinc-800 bg-gradient-to-br from-zinc-900 to-zinc-950 p-4 shadow-lg shadow-black/20">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{metric.label}</p>
      <p className={`mt-2 text-2xl font-semibold tracking-tight sm:text-3xl ${tone}`}>{value}</p>
    </div>
  );
}

function PlatformStrip({ platforms }: { platforms: ClientSocialMetrics["platforms"] }) {
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {platforms.map((platform) => (
        <div key={platform.platform} className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-3">
          <div className="flex items-center gap-2">
            <PlatformMark platform={platform.platform} />
            <p className="text-xs font-semibold text-zinc-100">{platform.label}</p>
          </div>
          <p className={`mt-2 text-[11px] leading-relaxed ${platform.connected ? "text-emerald-300/90" : "text-zinc-400"}`}>
            {platform.connected ? "Connected" : platform.message}
          </p>
        </div>
      ))}
    </div>
  );
}

function AccountBreakdown({
  accounts,
  selectedKey,
  onSelect,
}: {
  accounts: SocialAccountMetrics[];
  selectedKey: string;
  onSelect: (accountKey: string) => void;
}) {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
      <h3 className="text-sm font-semibold text-zinc-100">By account</h3>
      <div className="mt-3 grid gap-2">
        <button
          type="button"
          onClick={() => onSelect("all")}
          className={`rounded-lg border px-3 py-2 text-left text-xs font-semibold ${
            selectedKey === "all"
              ? "border-zinc-200 bg-zinc-100 text-zinc-900"
              : "border-zinc-700 bg-zinc-950 text-zinc-200"
          }`}
        >
          All accounts
        </button>
        {accounts.map((account) => {
          const followers = account.metrics.find((item) => item.key === "followers")?.value ?? null;
          const reach = account.metrics.find((item) => item.key === "reach")?.value ?? null;
          const interactions = account.metrics.find((item) => item.key === "interactions")?.value ?? null;
          const active = selectedKey === account.accountKey;
          return (
            <button
              key={account.accountKey}
              type="button"
              onClick={() => onSelect(account.accountKey)}
              className={`grid grid-cols-2 gap-2 rounded-lg border px-3 py-3 text-left sm:grid-cols-4 ${
                active ? "border-zinc-200 bg-zinc-100 text-zinc-900" : "border-zinc-700 bg-zinc-950 text-zinc-200"
              }`}
            >
              <span className="col-span-2 sm:col-span-1">
                <span className="block text-[10px] uppercase tracking-wide opacity-70">{platformLabel(account.platform)}</span>
                <span className="mt-0.5 block truncate text-sm font-semibold">{account.label}</span>
              </span>
              <MetricPair label="Followers" value={formatMetricValue(followers, "count")} active={active} />
              <MetricPair label="Reach" value={formatMetricValue(reach, "count")} active={active} />
              <MetricPair label="Interactions" value={formatMetricValue(interactions, "count")} active={active} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

function MetricPair({ label, value, active }: { label: string; value: string; active: boolean }) {
  return (
    <span>
      <span className={`block text-[10px] uppercase tracking-wide ${active ? "text-zinc-600" : "text-zinc-500"}`}>
        {label}
      </span>
      <span className="mt-0.5 block text-sm font-semibold">{value}</span>
    </span>
  );
}

function PlatformThumbnail({ src, onError }: { src: string; onError: () => void }) {
  return (
    // Platform CDN thumbnails expire and are not in next/image remotePatterns.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" onError={onError} className="h-16 w-16 shrink-0 rounded-md object-cover" />
  );
}

function TopPostCard({ post }: { post: SocialTopPost }) {
  const [hidden, setHidden] = useState(false);
  const chips = summaryMetrics(post.metrics).slice(0, 4);
  const body = (
    <div className="flex gap-3">
      {post.thumbnailUrl && !hidden ? (
        <PlatformThumbnail src={post.thumbnailUrl} onError={() => setHidden(true)} />
      ) : (
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950 text-[10px] text-zinc-500">
          {platformLabel(post.platform)}
        </div>
      )}
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wide text-zinc-500">{platformLabel(post.platform)}</p>
        <p className="mt-0.5 line-clamp-2 text-sm font-semibold text-zinc-100">{post.title}</p>
        <p className="mt-1 text-[11px] text-zinc-400">
          {chips.map((item) => `${item.label} ${formatMetricValue(item.value, item.style)}`).join(" · ")}
        </p>
      </div>
    </div>
  );
  if (!post.permalink) {
    return <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">{body}</div>;
  }
  return (
    <a
      href={post.permalink}
      target="_blank"
      rel="noreferrer"
      className="block rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 hover:border-zinc-600"
    >
      {body}
    </a>
  );
}

function PlatformMark({ platform }: { platform: SocialPlatform }) {
  const className = "h-3.5 w-3.5";
  switch (platform) {
    case "instagram":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
          <circle cx="12" cy="12" r="4.2" />
          <circle cx="17.3" cy="6.8" r="1.1" fill="currentColor" stroke="none" />
        </svg>
      );
    case "facebook":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
          <path d="M14 9h3V6h-3c-2.2 0-4 1.8-4 4v2H8v3h2v7h3v-7h2.6l.4-3H13v-2c0-.6.4-1 1-1z" />
        </svg>
      );
    case "tiktok":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <path d="M14 4v8.5a3.5 3.5 0 1 1-3.5-3.5" />
          <path d="M14 7a5 5 0 0 0 4 2" />
        </svg>
      );
    case "linkedin":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
          <path d="M6.5 9H4v11h2.5V9zM5.2 4C4.4 4 3.8 4.6 3.8 5.4s.6 1.4 1.4 1.4 1.5-.6 1.5-1.4S6 4 5.2 4zM20 20h-2.5v-5.6c0-1.6-.6-2.6-2-2.6-1 0-1.6.7-1.9 1.4-.1.2-.1.6-.1.9V20H11V9h2.4v1.5c.4-.7 1.3-1.8 3.2-1.8 2.3 0 4 1.5 4 4.8V20z" />
        </svg>
      );
    default: {
      const exhaustive: never = platform;
      return exhaustive;
    }
  }
}

function chartData(series: ClientSocialMetrics["accounts"][number]["series"]): Array<Record<string, string | number>> {
  return series.map((point) => {
    const row: Record<string, string | number> = { label: point.date.slice(5) };
    for (const [key, value] of Object.entries(point.values)) {
      row[key] = value;
    }
    return row;
  });
}
