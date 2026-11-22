import {
  accountKey,
  dateToUnixEndExclusive,
  dateToUnixStart,
  eachDateWindow,
  emptyAccount,
  mapInsightSeries,
  mapInsightTotals,
  mergeSeries,
  metricsFromRecord,
  parseGraphInsights,
  withDerivedMetrics,
  type SocialAccountMetrics,
  type SocialSeriesPoint,
} from "@/lib/socialMetricsModel";

import { graphGet, isFatalProviderError } from "@/lib/server/metrics/graphJson";

const PAGE_METRICS = [
  "page_media_view",
  "page_total_media_view_unique",
  "page_post_engagements",
  "page_views_total",
  "page_follows",
  "page_impressions",
  "page_impressions_unique",
  "page_daily_follows",
];

function numberField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

type PageInsightBundle = {
  totals: Record<string, number>;
  series: SocialSeriesPoint[];
  error: string | null;
  fatal: boolean;
};

async function pageInsights(
  pageId: string,
  accessToken: string,
  names: string[],
  params: Record<string, string>
): Promise<PageInsightBundle> {
  if (names.length === 0) return { totals: {}, series: [], error: null, fatal: false };
  const batch = await graphGet(`/${pageId}/insights`, accessToken, {
    metric: names.join(","),
    ...params,
  });
  if (batch.ok) {
    const parsed = parseGraphInsights(batch.json);
    return { totals: parsed.totals, series: parsed.series, error: null, fatal: false };
  }
  if (isFatalProviderError(batch.error) || names.length === 1) {
    return { totals: {}, series: [], error: batch.error, fatal: isFatalProviderError(batch.error) };
  }
  const mid = Math.ceil(names.length / 2);
  const left = await pageInsights(pageId, accessToken, names.slice(0, mid), params);
  if (left.fatal) return left;
  const right = await pageInsights(pageId, accessToken, names.slice(mid), params);
  return {
    totals: { ...left.totals, ...right.totals },
    series: [...left.series, ...right.series],
    error: left.error ?? right.error,
    fatal: right.fatal,
  };
}

export async function fetchFacebookPageMetrics(input: {
  profileId: string;
  /** Stable id for cache and the account filter. The Instagram account id, not the page id. */
  accountExternalId: string;
  pageId: string | null;
  pageName: string | null;
  accessToken: string;
  rangeStart: string;
  rangeEnd: string;
}): Promise<{ account: SocialAccountMetrics; pageId: string | null }> {
  const pageLookup = input.pageId
    ? await graphGet(`/${input.pageId}`, input.accessToken, {
        fields: "id,name,username,followers_count,fan_count",
      })
    : await graphGet("/me", input.accessToken, {
        fields: "id,name,username,followers_count,fan_count",
      });

  const page = (pageLookup.json ?? {}) as Record<string, unknown>;
  const resolvedPageId =
    (typeof page.id === "string" && /^\d+$/.test(page.id.trim()) && page.id.trim()) ||
    (input.pageId && /^\d+$/.test(input.pageId) ? input.pageId : null);
  const pageName =
    (typeof page.name === "string" && page.name.trim()) || input.pageName?.trim() || "Facebook Page";
  const username = typeof page.username === "string" ? page.username : null;
  const key = accountKey("facebook", input.profileId, input.accountExternalId);
  const base = {
    accountKey: key,
    platform: "facebook" as const,
    profileId: input.profileId,
    label: pageName,
    handle: username,
  };

  if (!pageLookup.ok && isFatalProviderError(pageLookup.error)) {
    return {
      pageId: input.pageId,
      account: emptyAccount({
        ...base,
        status: "error",
        statusMessage: pageLookup.error ?? "Facebook rejected the saved page token.",
      }),
    };
  }

  const totals: Record<string, number> = {};
  const followers = numberField(page, "followers_count") ?? numberField(page, "fan_count");
  if (followers !== null) totals.followers = followers;

  const seriesParts: SocialSeriesPoint[][] = [];
  let insightError: string | null = null;
  const windows = eachDateWindow(input.rangeStart, input.rangeEnd, 28);

  for (const window of windows) {
    if (!resolvedPageId) break;
    const bundle = await pageInsights(resolvedPageId, input.accessToken, PAGE_METRICS, {
      period: "day",
      since: String(dateToUnixStart(window.start)),
      until: String(dateToUnixEndExclusive(window.end)),
    });
    Object.assign(totals, mapInsightTotals(bundle.totals));
    seriesParts.push(mapInsightSeries(bundle.series));
    if (bundle.error) insightError = insightError ?? bundle.error;
    if (bundle.fatal) break;
  }

  if (followers !== null) totals.followers = followers;
  const series = mergeSeries(seriesParts);
  const metrics = withDerivedMetrics(metricsFromRecord(totals), series);
  const note =
    insightError && metrics.length > 0
      ? "Some Facebook Page insights are unavailable for this token. Reconnect Meta and approve read_insights if the missing charts matter."
      : insightError;

  return {
    pageId: resolvedPageId,
    account: {
      ...base,
      status: metrics.length > 0 ? "ok" : "error",
      statusMessage: metrics.length > 0 ? note : note ?? "No Facebook Page metrics were returned.",
      metrics,
      series,
      topPosts: [],
      capturedAt: new Date().toISOString(),
      fromCache: false,
    },
  };
}
