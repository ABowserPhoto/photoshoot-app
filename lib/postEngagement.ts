import type { SocialMetric } from "@/lib/socialMetricsModel";

export type PostEngagementCounts = {
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  views: number | null;
};

const GENERIC_TITLES = new Set(["instagram post", "tiktok video"]);

export function postEngagementFromMetrics(metrics: readonly SocialMetric[]): PostEngagementCounts | null {
  const counts: PostEngagementCounts = {
    likes: metricValue(metrics, "likes"),
    comments: metricValue(metrics, "comments"),
    shares: metricValue(metrics, "shares"),
    saves: metricValue(metrics, "saves"),
    views: metricValue(metrics, "views"),
  };
  return hasPostEngagement(counts) ? counts : null;
}

export function hasPostEngagement(counts: PostEngagementCounts | null | undefined): counts is PostEngagementCounts {
  if (!counts) return false;
  return [counts.likes, counts.comments, counts.shares, counts.saves, counts.views].some(
    (value) => typeof value === "number" && Number.isFinite(value)
  );
}

/** First line, trimmed, used to join a scheduler caption to a cached platform post. */
export function captionMatchKey(value: string | null | undefined): string {
  const firstLine = (value ?? "").split("\n")[0] ?? "";
  return firstLine.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 90);
}

export function indexEngagementByCaption<T extends { title: string; counts: PostEngagementCounts }>(
  posts: readonly T[]
): Map<string, T> {
  const index = new Map<string, T>();
  for (const post of posts) {
    if (!hasPostEngagement(post.counts)) continue;
    const key = captionMatchKey(post.title);
    if (key.length < 8 || GENERIC_TITLES.has(key)) continue;
    if (!index.has(key)) index.set(key, post);
  }
  return index;
}

export function lookupEngagementByCaption<T extends { title: string; counts: PostEngagementCounts }>(
  index: Map<string, T>,
  caption: string | null | undefined
): T | null {
  const key = captionMatchKey(caption);
  if (!key) return null;
  return index.get(key) ?? null;
}

function metricValue(metrics: readonly SocialMetric[], key: string): number | null {
  const found = metrics.find((metric) => metric.key === key);
  return typeof found?.value === "number" && Number.isFinite(found.value) ? found.value : null;
}
