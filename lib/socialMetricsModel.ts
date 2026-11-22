export const SOCIAL_PLATFORMS = ["instagram", "facebook", "tiktok", "linkedin"] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export type MetricStyle = "count" | "percent";

export type MetricGroup = "audience" | "reach" | "engagement" | "content";

export type SocialMetric = {
  key: string;
  label: string;
  value: number | null;
  style: MetricStyle;
  summative: boolean;
  group: MetricGroup;
};

export type SocialSeriesPoint = {
  date: string;
  values: Record<string, number>;
};

export type SocialTopPost = {
  id: string;
  platform: SocialPlatform;
  accountKey: string;
  title: string;
  permalink: string | null;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  metrics: SocialMetric[];
};

export type SocialAccountStatus = "ok" | "not_connected" | "not_configured" | "error";

export type SocialAccountMetrics = {
  accountKey: string;
  platform: SocialPlatform;
  profileId: string;
  label: string;
  handle: string | null;
  status: SocialAccountStatus;
  statusMessage: string | null;
  metrics: SocialMetric[];
  series: SocialSeriesPoint[];
  topPosts: SocialTopPost[];
  capturedAt: string | null;
  fromCache: boolean;
};

export type PlatformSetup = {
  platform: SocialPlatform;
  label: string;
  configured: boolean;
  connected: boolean;
  envVars: string[];
  message: string | null;
};

export type ClientSocialMetrics = {
  clientId: string;
  clientName: string;
  rangeStart: string;
  rangeEnd: string;
  generatedAt: string;
  historyAvailable: boolean;
  platforms: PlatformSetup[];
  accounts: SocialAccountMetrics[];
};

type MetricSpec = {
  label: string;
  style: MetricStyle;
  summative: boolean;
  group: MetricGroup;
};

const METRIC_SPECS: Record<string, MetricSpec> = {
  followers: { label: "Followers", style: "count", summative: true, group: "audience" },
  organic_followers: { label: "Organic followers", style: "count", summative: false, group: "audience" },
  paid_followers: { label: "Paid followers", style: "count", summative: false, group: "audience" },
  following: { label: "Following", style: "count", summative: true, group: "audience" },
  follower_growth: { label: "Follower growth", style: "count", summative: true, group: "audience" },
  posts: { label: "Posts", style: "count", summative: true, group: "content" },
  video_count: { label: "Videos", style: "count", summative: true, group: "content" },
  reach: { label: "Reach", style: "count", summative: true, group: "reach" },
  views: { label: "Views", style: "count", summative: true, group: "reach" },
  impressions: { label: "Impressions", style: "count", summative: true, group: "reach" },
  profile_views: { label: "Profile views", style: "count", summative: true, group: "reach" },
  page_views: { label: "Page views", style: "count", summative: true, group: "reach" },
  interactions: { label: "Interactions", style: "count", summative: true, group: "engagement" },
  engagement_rate: { label: "Engagement rate", style: "percent", summative: false, group: "engagement" },
  likes: { label: "Likes", style: "count", summative: true, group: "engagement" },
  comments: { label: "Comments", style: "count", summative: true, group: "engagement" },
  shares: { label: "Shares", style: "count", summative: true, group: "engagement" },
  saves: { label: "Saves", style: "count", summative: true, group: "engagement" },
  replies: { label: "Replies", style: "count", summative: true, group: "engagement" },
  accounts_engaged: { label: "Accounts engaged", style: "count", summative: true, group: "engagement" },
  website_clicks: { label: "Website clicks", style: "count", summative: true, group: "engagement" },
  profile_link_taps: { label: "Profile link taps", style: "count", summative: true, group: "engagement" },
  clicks: { label: "Clicks", style: "count", summative: true, group: "engagement" },
  lifetime_likes: { label: "Lifetime likes", style: "count", summative: true, group: "engagement" },
};

const SUMMARY_ORDER = [
  "followers",
  "follower_growth",
  "reach",
  "views",
  "impressions",
  "interactions",
  "engagement_rate",
  "profile_views",
  "page_views",
  "likes",
  "comments",
  "shares",
  "saves",
  "replies",
  "accounts_engaged",
  "website_clicks",
  "profile_link_taps",
  "clicks",
  "posts",
  "video_count",
  "following",
  "lifetime_likes",
];

const SERIES_KEYS = new Set([
  "followers",
  "reach",
  "views",
  "impressions",
  "interactions",
  "likes",
  "comments",
  "shares",
  "saves",
  "profile_views",
  "page_views",
  "clicks",
]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isSocialPlatform(value: string): value is SocialPlatform {
  return (SOCIAL_PLATFORMS as readonly string[]).includes(value);
}

export function platformLabel(platform: SocialPlatform): string {
  switch (platform) {
    case "instagram":
      return "Instagram";
    case "facebook":
      return "Facebook";
    case "tiktok":
      return "TikTok";
    case "linkedin":
      return "LinkedIn";
    default: {
      const exhaustive: never = platform;
      return exhaustive;
    }
  }
}

export function accountKey(platform: SocialPlatform, profileId: string, externalId: string): string {
  return `${platform}:${profileId}:${externalId}`;
}

export function labelFromKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function metric(key: string, value: number | null, overrides?: Partial<MetricSpec>): SocialMetric {
  const spec = METRIC_SPECS[key] ?? {
    label: labelFromKey(key),
    style: "count" as const,
    summative: false,
    group: "content" as const,
  };
  return {
    key,
    value: value === null || Number.isNaN(value) ? null : value,
    ...spec,
    ...overrides,
  };
}

export function metricsFromRecord(record: Record<string, number | null | undefined>): SocialMetric[] {
  const metrics: SocialMetric[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (typeof value !== "number" || Number.isNaN(value)) continue;
    metrics.push(metric(key, value));
  }
  return metrics;
}

export function recordFromMetrics(metrics: SocialMetric[]): Record<string, number> {
  const record: Record<string, number> = {};
  for (const item of metrics) {
    if (item.value === null) continue;
    record[item.key] = item.value;
  }
  return record;
}

export function isIsoDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addUtcDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

export function dateToUnixStart(isoDate: string): number {
  return Math.floor(Date.parse(`${isoDate}T00:00:00.000Z`) / 1000);
}

export function dateToUnixEndExclusive(isoDate: string): number {
  return dateToUnixStart(addUtcDays(isoDate, 1));
}

export function eachDateWindow(
  start: string,
  end: string,
  maxDays: number
): Array<{ start: string; end: string }> {
  if (!isIsoDate(start) || !isIsoDate(end) || start > end || maxDays < 1) {
    return [];
  }
  const windows: Array<{ start: string; end: string }> = [];
  let cursor = start;
  while (cursor <= end) {
    const windowEnd = addUtcDays(cursor, maxDays - 1);
    const clamped = windowEnd < end ? windowEnd : end;
    windows.push({ start: cursor, end: clamped });
    cursor = addUtcDays(clamped, 1);
  }
  return windows;
}

export function defaultRange(days: number): { start: string; end: string } {
  const end = utcToday();
  return { start: addUtcDays(end, -(days - 1)), end };
}

export function rangeLengthDays(start: string, end: string): number {
  const startMs = Date.parse(`${start}T00:00:00.000Z`);
  const endMs = Date.parse(`${end}T00:00:00.000Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return 0;
  return Math.round((endMs - startMs) / 86400000) + 1;
}

export function formatMetricValue(value: number | null, style: MetricStyle): string {
  if (value === null || Number.isNaN(value)) return "—";
  if (style === "percent") {
    return `${value.toFixed(1)}%`;
  }
  const abs = Math.abs(value);
  return new Intl.NumberFormat("en-US", {
    notation: abs >= 10000 ? "compact" : "standard",
    maximumFractionDigits: abs >= 10000 ? 1 : 0,
  }).format(value);
}

export function formatSignedCount(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  const formatted = formatMetricValue(Math.abs(value), "count");
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}

type InsightRow = {
  name?: string;
  total_value?: { value?: number };
  values?: Array<{ value?: number; end_time?: string }>;
};

export function parseGraphInsights(payload: unknown): {
  totals: Record<string, number>;
  series: SocialSeriesPoint[];
} {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return { totals: {}, series: [] };

  const totals: Record<string, number> = {};
  const byDate = new Map<string, Record<string, number>>();

  for (const entry of data) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as InsightRow;
    const name = row.name?.trim();
    if (!name) continue;

    if (typeof row.total_value?.value === "number" && Number.isFinite(row.total_value.value)) {
      totals[name] = row.total_value.value;
    }

    if (!Array.isArray(row.values)) continue;
    let sum = 0;
    let saw = false;
    for (const point of row.values) {
      if (typeof point?.value !== "number" || !Number.isFinite(point.value)) continue;
      saw = true;
      sum += point.value;
      const date = typeof point.end_time === "string" ? point.end_time.slice(0, 10) : "";
      if (!isIsoDate(date)) continue;
      const bucket = byDate.get(date) ?? {};
      bucket[name] = (bucket[name] ?? 0) + point.value;
      byDate.set(date, bucket);
    }
    if (saw && totals[name] === undefined) totals[name] = sum;
  }

  const series = [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, values]) => ({ date, values }));

  return { totals, series };
}

const INSIGHT_KEY_MAP: Record<string, string> = {
  reach: "reach",
  views: "views",
  impressions: "impressions",
  total_interactions: "interactions",
  likes: "likes",
  comments: "comments",
  shares: "shares",
  saves: "saves",
  saved: "saves",
  replies: "replies",
  profile_views: "profile_views",
  website_clicks: "website_clicks",
  profile_links_taps: "profile_link_taps",
  accounts_engaged: "accounts_engaged",
  follower_count: "followers",
  follows_and_unfollows: "follower_growth",
  page_impressions: "impressions",
  page_impressions_unique: "reach",
  page_media_view: "views",
  page_total_media_view_unique: "reach",
  page_post_engagements: "interactions",
  page_views_total: "page_views",
  page_daily_follows: "follower_growth",
  page_follows: "followers",
};

export function mapInsightTotals(totals: Record<string, number>): Record<string, number> {
  const mapped: Record<string, number> = {};
  for (const [name, value] of Object.entries(totals)) {
    const key = INSIGHT_KEY_MAP[name] ?? name;
    mapped[key] = (mapped[key] ?? 0) + value;
  }
  if (mapped.views !== undefined && mapped.impressions === undefined) {
    mapped.impressions = mapped.views;
  }
  return mapped;
}

export function mapInsightSeries(series: SocialSeriesPoint[]): SocialSeriesPoint[] {
  return series.map((point) => {
    const values: Record<string, number> = {};
    for (const [name, value] of Object.entries(point.values)) {
      const key = INSIGHT_KEY_MAP[name] ?? name;
      if (!SERIES_KEYS.has(key) && key !== "follower_growth") continue;
      values[key] = (values[key] ?? 0) + value;
    }
    if (values.views !== undefined && values.impressions === undefined) {
      values.impressions = values.views;
    }
    return { date: point.date, values };
  });
}

export function mergeSeries(parts: SocialSeriesPoint[][]): SocialSeriesPoint[] {
  const byDate = new Map<string, Record<string, number>>();
  for (const series of parts) {
    for (const point of series) {
      if (!isIsoDate(point.date)) continue;
      const bucket = byDate.get(point.date) ?? {};
      for (const [key, value] of Object.entries(point.values)) {
        if (typeof value !== "number" || !Number.isFinite(value)) continue;
        bucket[key] = (bucket[key] ?? 0) + value;
      }
      byDate.set(point.date, bucket);
    }
  }
  return [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, values]) => ({ date, values }));
}

export function followerDelta(series: SocialSeriesPoint[]): number | null {
  const points = series
    .map((point) => ({ date: point.date, value: point.values.followers }))
    .filter((point): point is { date: string; value: number } => typeof point.value === "number")
    .sort((left, right) => left.date.localeCompare(right.date));
  if (points.length < 2) return null;
  return points[points.length - 1].value - points[0].value;
}

export function interactionTotal(record: Record<string, number>): number | null {
  if (typeof record.interactions === "number") return record.interactions;
  const parts = ["likes", "comments", "shares", "saves", "replies"]
    .map((key) => record[key])
    .filter((value): value is number => typeof value === "number");
  if (parts.length === 0) return null;
  return parts.reduce((sum, value) => sum + value, 0);
}

export function engagementRate(record: Record<string, number>): number | null {
  const interactions = interactionTotal(record);
  if (interactions === null) return null;
  const reach = record.reach;
  const views = record.views ?? record.impressions;
  const followers = record.followers;
  const base =
    typeof reach === "number" && reach > 0
      ? reach
      : typeof views === "number" && views > 0
        ? views
        : typeof followers === "number" && followers > 0
          ? followers
          : null;
  if (base === null) return null;
  return (interactions / base) * 100;
}

export function withDerivedMetrics(
  metrics: SocialMetric[],
  series: SocialSeriesPoint[]
): SocialMetric[] {
  const record = recordFromMetrics(metrics);
  const interactions = interactionTotal(record);
  if (interactions !== null && record.interactions === undefined) {
    record.interactions = interactions;
  }
  const growthFromSeries = followerDelta(series);
  if (growthFromSeries !== null) {
    record.follower_growth = growthFromSeries;
  }
  const rate = engagementRate(record);
  if (rate !== null) record.engagement_rate = rate;

  const next = metricsFromRecord(record);
  return sortMetrics(next);
}

export function sortMetrics(metrics: SocialMetric[]): SocialMetric[] {
  const order = new Map(SUMMARY_ORDER.map((key, index) => [key, index]));
  return [...metrics].sort((left, right) => {
    const leftOrder = order.get(left.key) ?? 1000;
    const rightOrder = order.get(right.key) ?? 1000;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return left.label.localeCompare(right.label);
  });
}

export function summaryMetrics(metrics: SocialMetric[]): SocialMetric[] {
  const preferred = new Set(SUMMARY_ORDER);
  const visible = metrics.filter((item) => item.value !== null && (preferred.has(item.key) || !item.summative));
  const summary = visible.filter((item) => preferred.has(item.key));
  return summary.length > 0 ? summary : visible.slice(0, 8);
}

export function detailMetrics(metrics: SocialMetric[]): SocialMetric[] {
  const preferred = new Set(SUMMARY_ORDER);
  return sortMetrics(metrics.filter((item) => item.value !== null && !preferred.has(item.key)));
}

export type AggregatedMetrics = {
  metrics: SocialMetric[];
  series: SocialSeriesPoint[];
  topPosts: SocialTopPost[];
};

export function aggregateAccounts(accounts: SocialAccountMetrics[]): AggregatedMetrics {
  const sums = new Map<string, number>();
  const specByKey = new Map<string, SocialMetric>();
  const seriesParts: SocialSeriesPoint[][] = [];
  const posts: SocialTopPost[] = [];

  for (const account of accounts) {
    if (account.status === "not_configured" || account.status === "not_connected") continue;
    for (const item of account.metrics) {
      if (!item.summative || item.value === null || item.key === "follower_growth" || item.key === "engagement_rate") {
        continue;
      }
      sums.set(item.key, (sums.get(item.key) ?? 0) + item.value);
      specByKey.set(item.key, item);
    }
    seriesParts.push(account.series);
    posts.push(...account.topPosts);
  }

  const series = mergeSeries(seriesParts);
  const base = [...sums.entries()].map(([key, value]) => metric(key, value));
  const metrics = withDerivedMetrics(base, series);
  const topPosts = [...posts]
    .sort((left, right) => postScore(right) - postScore(left))
    .slice(0, 8);

  return { metrics, series, topPosts };
}

function postScore(post: SocialTopPost): number {
  const record = recordFromMetrics(post.metrics);
  return (
    record.interactions ??
    (record.likes ?? 0) + (record.comments ?? 0) + (record.shares ?? 0) + (record.saves ?? 0) + (record.views ?? 0)
  );
}

export function mergeFollowerSnapshots(
  series: SocialSeriesPoint[],
  dailies: Array<{ date: string; followers: number | null }>
): SocialSeriesPoint[] {
  const byDate = new Map<string, Record<string, number>>();
  for (const point of series) {
    byDate.set(point.date, { ...point.values });
  }
  for (const daily of dailies) {
    if (!isIsoDate(daily.date) || typeof daily.followers !== "number") continue;
    const bucket = byDate.get(daily.date) ?? {};
    if (typeof bucket.followers !== "number") bucket.followers = daily.followers;
    byDate.set(daily.date, bucket);
  }
  return [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, values]) => ({ date, values }));
}

export function sanitizeProviderError(message: string): string {
  return message
    .replace(/access_token=[^&\s]+/gi, "access_token=redacted")
    .replace(/bearer\s+[a-z0-9._\-]+/gi, "Bearer redacted")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
}

export function emptyAccount(
  partial: Pick<SocialAccountMetrics, "accountKey" | "platform" | "profileId" | "label" | "handle" | "status"> & {
    statusMessage?: string | null;
  }
): SocialAccountMetrics {
  return {
    accountKey: partial.accountKey,
    platform: partial.platform,
    profileId: partial.profileId,
    label: partial.label,
    handle: partial.handle,
    status: partial.status,
    statusMessage: partial.statusMessage ?? null,
    metrics: [],
    series: [],
    topPosts: [],
    capturedAt: null,
    fromCache: false,
  };
}

type TikTokUser = {
  display_name?: string;
  username?: string;
  follower_count?: number;
  following_count?: number;
  likes_count?: number;
  video_count?: number;
};

export function parseTikTokUserInfo(payload: unknown): {
  user: TikTokUser | null;
  error: string | null;
} {
  const body = payload as {
    data?: { user?: TikTokUser };
    error?: { code?: string; message?: string };
  } | null;
  const code = body?.error?.code?.trim();
  if (code && code !== "ok") {
    return { user: null, error: body?.error?.message?.trim() || code };
  }
  const user = body?.data?.user;
  if (!user || typeof user !== "object") {
    return { user: null, error: "TikTok did not return a user profile." };
  }
  return { user, error: null };
}

export type TikTokVideo = {
  id?: string;
  title?: string;
  video_description?: string;
  create_time?: number;
  cover_image_url?: string;
  share_url?: string;
  view_count?: number;
  like_count?: number;
  comment_count?: number;
  share_count?: number;
};

export function parseTikTokVideoPage(payload: unknown): {
  videos: TikTokVideo[];
  cursor: number | null;
  hasMore: boolean;
  error: string | null;
} {
  const body = payload as {
    data?: { videos?: TikTokVideo[]; cursor?: number; has_more?: boolean };
    error?: { code?: string; message?: string };
  } | null;
  const code = body?.error?.code?.trim();
  if (code && code !== "ok") {
    return { videos: [], cursor: null, hasMore: false, error: body?.error?.message?.trim() || code };
  }
  const videos = Array.isArray(body?.data?.videos) ? body.data.videos : [];
  const cursor = typeof body?.data?.cursor === "number" ? body.data.cursor : null;
  return { videos, cursor, hasMore: body?.data?.has_more === true, error: null };
}

export function tiktokVideosInRange(videos: TikTokVideo[], rangeStart: string, rangeEnd: string): TikTokVideo[] {
  const start = dateToUnixStart(rangeStart);
  const end = dateToUnixEndExclusive(rangeEnd);
  return videos.filter((video) => {
    if (typeof video.create_time !== "number") return false;
    return video.create_time >= start && video.create_time < end;
  });
}

type LinkedInShareStats = {
  clickCount?: number;
  commentCount?: number;
  engagement?: number;
  impressionCount?: number;
  likeCount?: number;
  shareCount?: number;
  uniqueImpressionsCount?: number;
};

export function parseLinkedInShareStatistics(payload: unknown): {
  totals: Record<string, number>;
  series: SocialSeriesPoint[];
} {
  const elements = (payload as { elements?: unknown[] } | null)?.elements;
  if (!Array.isArray(elements)) return { totals: {}, series: [] };

  const totals: Record<string, number> = {};
  const series: SocialSeriesPoint[] = [];

  const add = (stats: LinkedInShareStats | undefined, into: Record<string, number>) => {
    if (!stats) return;
    const pairs: Array<[string, number | undefined]> = [
      ["clicks", stats.clickCount],
      ["comments", stats.commentCount],
      ["impressions", stats.impressionCount],
      ["reach", stats.uniqueImpressionsCount],
      ["likes", stats.likeCount],
      ["shares", stats.shareCount],
    ];
    for (const [key, value] of pairs) {
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      into[key] = (into[key] ?? 0) + value;
    }
  };

  for (const element of elements) {
    if (!element || typeof element !== "object") continue;
    const row = element as {
      totalShareStatistics?: LinkedInShareStats;
      timeRange?: { start?: number; end?: number };
    };
    add(row.totalShareStatistics, totals);
    if (row.timeRange?.end && row.totalShareStatistics) {
      const values: Record<string, number> = {};
      add(row.totalShareStatistics, values);
      const date = new Date(row.timeRange.end).toISOString().slice(0, 10);
      if (isIsoDate(date)) series.push({ date, values });
    }
  }

  const interactions =
    (totals.likes ?? 0) + (totals.comments ?? 0) + (totals.shares ?? 0) + (totals.clicks ?? 0);
  if (interactions > 0) totals.interactions = interactions;

  return { totals, series };
}

export function parseLinkedInNetworkSize(payload: unknown): number | null {
  const size = (payload as { firstDegreeSize?: number } | null)?.firstDegreeSize;
  return typeof size === "number" && Number.isFinite(size) ? size : null;
}

export function parseLinkedInFollowerStatistics(payload: unknown): {
  followers: number | null;
  organicFollowers: number | null;
  paidFollowers: number | null;
  organicGain: number | null;
  paidGain: number | null;
} {
  const elements = (payload as { elements?: unknown[] } | null)?.elements;
  if (!Array.isArray(elements)) {
    return { followers: null, organicFollowers: null, paidFollowers: null, organicGain: null, paidGain: null };
  }

  let organic = 0;
  let paid = 0;
  let sawCount = false;
  let organicGain = 0;
  let paidGain = 0;
  let sawGain = false;

  for (const element of elements) {
    if (!element || typeof element !== "object") continue;
    const row = element as {
      followerCounts?: { organicFollowerCount?: number; paidFollowerCount?: number };
      followerGains?: { organicFollowerGain?: number; paidFollowerGain?: number };
      followerCountsByAssociationType?: Array<{
        followerCounts?: { organicFollowerCount?: number; paidFollowerCount?: number };
      }>;
    };
    const counts = [row.followerCounts, ...(row.followerCountsByAssociationType ?? []).map((item) => item.followerCounts)];
    for (const count of counts) {
      if (typeof count?.organicFollowerCount === "number") {
        organic += count.organicFollowerCount;
        sawCount = true;
      }
      if (typeof count?.paidFollowerCount === "number") {
        paid += count.paidFollowerCount;
        sawCount = true;
      }
    }
    if (typeof row.followerGains?.organicFollowerGain === "number") {
      organicGain += row.followerGains.organicFollowerGain;
      sawGain = true;
    }
    if (typeof row.followerGains?.paidFollowerGain === "number") {
      paidGain += row.followerGains.paidFollowerGain;
      sawGain = true;
    }
  }

  return {
    followers: sawCount ? organic + paid : null,
    organicFollowers: sawCount ? organic : null,
    paidFollowers: sawCount ? paid : null,
    organicGain: sawGain ? organicGain : null,
    paidGain: sawGain ? paidGain : null,
  };
}

export function parseLinkedInPageStatistics(payload: unknown): Record<string, number> {
  const elements = (payload as { elements?: unknown[] } | null)?.elements;
  if (!Array.isArray(elements)) return {};
  let pageViews = 0;
  let saw = false;
  for (const element of elements) {
    if (!element || typeof element !== "object") continue;
    const views = (element as { totalPageStatistics?: { views?: { allPageViews?: { pageViews?: number } } } })
      .totalPageStatistics?.views?.allPageViews?.pageViews;
    if (typeof views === "number" && Number.isFinite(views)) {
      pageViews += views;
      saw = true;
    }
  }
  return saw ? { page_views: pageViews } : {};
}

export function parseLinkedInOrganizations(payload: unknown): string[] {
  const elements = (payload as { elements?: unknown[] } | null)?.elements;
  if (!Array.isArray(elements)) return [];
  const ids: string[] = [];
  for (const element of elements) {
    if (!element || typeof element !== "object") continue;
    const urn = (element as { organization?: string; organizationalTarget?: string }).organization
      ?? (element as { organizationalTarget?: string }).organizationalTarget;
    if (typeof urn !== "string") continue;
    const match = urn.match(/urn:li:organization:(\d+)/);
    if (!match) continue;
    ids.push(match[1]);
  }
  return [...new Set(ids)];
}

export function parseLinkedInOrganizationName(payload: unknown): { name: string | null; vanity: string | null } {
  const body = payload as {
    localizedName?: string | { localized?: Record<string, string> };
    vanityName?: string;
    name?: { localized?: Record<string, string> };
  } | null;
  let name: string | null = null;
  if (typeof body?.localizedName === "string" && body.localizedName.trim()) {
    name = body.localizedName.trim();
  } else if (body?.localizedName && typeof body.localizedName === "object") {
    const localized = body.localizedName.localized;
    const first = localized ? Object.values(localized).find((value) => value.trim()) : undefined;
    name = first?.trim() ?? null;
  } else if (body?.name?.localized) {
    const first = Object.values(body.name.localized).find((value) => value.trim());
    name = first?.trim() ?? null;
  }
  const vanity = typeof body?.vanityName === "string" && body.vanityName.trim() ? body.vanityName.trim() : null;
  return { name, vanity };
}

export function graphErrorMessage(payload: unknown): string | null {
  const error = (payload as { error?: { message?: string; code?: number } } | null)?.error;
  if (!error) return null;
  if (typeof error.message === "string" && error.message.trim()) return error.message.trim();
  if (typeof error.code === "number") return `Graph error ${error.code}`;
  return null;
}
