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
  sanitizeProviderError,
  withDerivedMetrics,
  type SocialAccountMetrics,
  type SocialSeriesPoint,
  type SocialTopPost,
} from "@/lib/socialMetricsModel";

import { graphGet, isFatalProviderError } from "@/lib/server/metrics/graphJson";

const TOTAL_METRICS = [
  "reach",
  "views",
  "accounts_engaged",
  "total_interactions",
  "likes",
  "comments",
  "shares",
  "saves",
  "replies",
  "profile_links_taps",
  "follows_and_unfollows",
  "website_clicks",
  "profile_views",
];

const MEDIA_METRICS = ["reach", "views", "saved", "shares", "total_interactions"];

type InsightBundle = {
  totals: Record<string, number>;
  series: SocialSeriesPoint[];
  error: string | null;
};

async function insightsFor(
  igAccountId: string,
  accessToken: string,
  names: string[],
  params: Record<string, string>
): Promise<InsightBundle> {
  const request = (metricNames: string[]) =>
    graphGet(`/${igAccountId}/insights`, accessToken, {
      metric: metricNames.join(","),
      ...params,
    });

  const first = await request(names);
  if (first.ok) {
    const parsed = parseGraphInsights(first.json);
    return { totals: parsed.totals, series: parsed.series, error: null };
  }
  if (isFatalProviderError(first.error) || names.length === 1) {
    return { totals: {}, series: [], error: first.error };
  }

  const totals: Record<string, number> = {};
  const series: SocialSeriesPoint[] = [];
  let fatal: string | null = null;
  for (const name of names) {
    const one = await request([name]);
    if (!one.ok) {
      if (isFatalProviderError(one.error)) {
        fatal = one.error;
        break;
      }
      continue;
    }
    const parsed = parseGraphInsights(one.json);
    Object.assign(totals, parsed.totals);
    series.push(...parsed.series);
  }
  return { totals, series: mergeSeries([series]), error: fatal };
}

function numberField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function fetchInstagramMetrics(input: {
  profileId: string;
  igAccountId: string;
  accessToken: string;
  username: string | null;
  pageName: string | null;
  rangeStart: string;
  rangeEnd: string;
}): Promise<SocialAccountMetrics> {
  const key = accountKey("instagram", input.profileId, input.igAccountId);
  const handle = input.username?.replace(/^@/, "") ?? null;
  const label = handle ? `@${handle}` : input.pageName?.trim() || "Instagram";
  const base = {
    accountKey: key,
    platform: "instagram" as const,
    profileId: input.profileId,
    label,
    handle,
  };

  const userResult = await graphGet(`/${input.igAccountId}`, input.accessToken, {
    fields: "username,name,followers_count,follows_count,media_count",
  });
  if (!userResult.ok && isFatalProviderError(userResult.error)) {
    return emptyAccount({
      ...base,
      status: "error",
      statusMessage: userResult.error ?? "Instagram rejected the saved token. Reconnect the account.",
    });
  }

  const user = (userResult.json ?? {}) as Record<string, unknown>;
  const resolvedHandle = typeof user.username === "string" ? user.username.replace(/^@/, "") : handle;
  const totals: Record<string, number> = {};
  const followers = numberField(user, "followers_count");
  const following = numberField(user, "follows_count");
  const posts = numberField(user, "media_count");
  if (followers !== null) totals.followers = followers;
  if (following !== null) totals.following = following;
  if (posts !== null) totals.posts = posts;

  const windows = eachDateWindow(input.rangeStart, input.rangeEnd, 28);
  const seriesParts: SocialSeriesPoint[][] = [];
  let insightError: string | null = null;

  for (const window of windows) {
    const since = String(dateToUnixStart(window.start));
    const until = String(dateToUnixEndExclusive(window.end));
    const totalValue = await insightsFor(input.igAccountId, input.accessToken, TOTAL_METRICS, {
      metric_type: "total_value",
      period: "day",
      since,
      until,
    });
    if (totalValue.error && isFatalProviderError(totalValue.error)) {
      insightError = totalValue.error;
      break;
    }
    Object.assign(totals, mapInsightTotals(totalValue.totals));
    seriesParts.push(mapInsightSeries(totalValue.series));
    if (totalValue.error) insightError = insightError ?? totalValue.error;

    const followerSeries = await insightsFor(input.igAccountId, input.accessToken, ["follower_count"], {
      period: "day",
      since,
      until,
    });
    if (!followerSeries.error) {
      const mapped = mapInsightTotals(followerSeries.totals);
      if (totals.followers === undefined && mapped.followers !== undefined) {
        totals.followers = mapped.followers;
      }
      seriesParts.push(mapInsightSeries(followerSeries.series));
    }
  }

  if (followers !== null) totals.followers = followers;

  const media = await graphGet(`/${input.igAccountId}/media`, input.accessToken, {
    fields: "id,caption,media_type,timestamp,permalink,thumbnail_url,media_url,like_count,comments_count",
    limit: "12",
  });
  const topPosts = media.ok ? await topInstagramPosts(key, input.accessToken, media.json) : [];

  const series = mergeSeries(seriesParts);
  const metrics = withDerivedMetrics(metricsFromRecord(totals), series);
  const permissionNote =
    insightError && /insight|permission|manage_insights/i.test(insightError)
      ? "Reconnect Instagram and approve instagram_manage_insights to load reach and interactions."
      : insightError;

  return {
    ...base,
    label: resolvedHandle ? `@${resolvedHandle}` : label,
    handle: resolvedHandle,
    status: metrics.length > 0 ? "ok" : "error",
    statusMessage: metrics.length > 0 ? permissionNote : permissionNote ?? "No Instagram metrics were returned.",
    metrics,
    series,
    topPosts,
    capturedAt: new Date().toISOString(),
    fromCache: false,
  };
}

async function topInstagramPosts(
  ownerKey: string,
  accessToken: string,
  payload: unknown
): Promise<SocialTopPost[]> {
  const rows = (payload as { data?: Array<Record<string, unknown>> } | null)?.data ?? [];
  const ranked = [...rows]
    .filter((row) => typeof row.id === "string")
    .sort((left, right) => mediaScore(right) - mediaScore(left))
    .slice(0, 12);
  const insightIds = new Set(ranked.slice(0, 4).map((row) => String(row.id)));

  const posts: SocialTopPost[] = [];
  for (const row of ranked) {
    const id = String(row.id);
    const insights = insightIds.has(id)
      ? await graphGet(`/${id}/insights`, accessToken, { metric: MEDIA_METRICS.join(",") })
      : { ok: false as const, json: null };
    const parsed = insights.ok ? mapInsightTotals(parseGraphInsights(insights.json).totals) : {};
    const likes = numberField(row, "like_count");
    const comments = numberField(row, "comments_count");
    if (likes !== null) parsed.likes = likes;
    if (comments !== null) parsed.comments = comments;
    const caption = typeof row.caption === "string" ? row.caption.trim().split("\n")[0] : "";
    const thumb =
      (typeof row.thumbnail_url === "string" && row.thumbnail_url) ||
      (typeof row.media_url === "string" && row.media_url) ||
      null;
    posts.push({
      id,
      platform: "instagram",
      accountKey: ownerKey,
      title: caption ? caption.slice(0, 90) : "Instagram post",
      permalink: typeof row.permalink === "string" ? row.permalink : null,
      thumbnailUrl: thumb,
      publishedAt: typeof row.timestamp === "string" ? row.timestamp : null,
      metrics: withDerivedMetrics(metricsFromRecord(parsed), []),
    });
  }
  return posts;
}

function mediaScore(row: Record<string, unknown>): number {
  return (numberField(row, "like_count") ?? 0) + (numberField(row, "comments_count") ?? 0);
}

export function instagramFailure(input: {
  profileId: string;
  igAccountId: string;
  label: string;
  message: string;
}): SocialAccountMetrics {
  return emptyAccount({
    accountKey: accountKey("instagram", input.profileId, input.igAccountId),
    platform: "instagram",
    profileId: input.profileId,
    label: input.label,
    handle: null,
    status: "error",
    statusMessage: sanitizeProviderError(input.message),
  });
}
