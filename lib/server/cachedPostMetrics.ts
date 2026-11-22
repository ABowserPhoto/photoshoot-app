import { postEngagementFromMetrics, type PostEngagementCounts } from "@/lib/postEngagement";
import { createServiceRoleClient } from "@/lib/server/supabaseServer";
import type { SocialMetric, SocialPlatform, SocialTopPost } from "@/lib/socialMetricsModel";
import { isSocialPlatform } from "@/lib/socialMetricsModel";

export type CachedPostEngagement = {
  id: string;
  platform: SocialPlatform;
  title: string;
  permalink: string | null;
  counts: PostEngagementCounts;
};

/** Latest snapshot rows only. Does not call Instagram, TikTok, or LinkedIn. */
export async function listCachedPostEngagement(
  clientId: string
): Promise<{ ok: true; posts: CachedPostEngagement[] } | { ok: false; error: string }> {
  const supabase = createServiceRoleClient();
  if (!supabase) return { ok: false, error: "Database is not configured." };

  const { data, error } = await supabase
    .from("social_metric_snapshots")
    .select("top_posts, fetched_at")
    .eq("client_id", clientId)
    .eq("kind", "range")
    .order("fetched_at", { ascending: false })
    .limit(40);

  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) {
      return { ok: true, posts: [] };
    }
    return { ok: false, error: error.message };
  }

  const seen = new Set<string>();
  const posts: CachedPostEngagement[] = [];
  for (const row of data ?? []) {
    const raw = (row as { top_posts?: unknown }).top_posts;
    if (!Array.isArray(raw)) continue;
    for (const entry of raw) {
      const post = asTopPost(entry);
      if (!post) continue;
      const counts = postEngagementFromMetrics(post.metrics);
      if (!counts) continue;
      const key = `${post.platform}:${post.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      posts.push({
        id: post.id,
        platform: post.platform,
        title: post.title,
        permalink: post.permalink,
        counts,
      });
    }
  }

  return { ok: true, posts };
}

function asTopPost(value: unknown): SocialTopPost | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<SocialTopPost>;
  if (typeof row.id !== "string" || typeof row.title !== "string") return null;
  if (typeof row.platform !== "string" || !isSocialPlatform(row.platform)) return null;
  const metrics = Array.isArray(row.metrics) ? row.metrics.filter(isMetric) : [];
  return {
    id: row.id,
    platform: row.platform,
    accountKey: typeof row.accountKey === "string" ? row.accountKey : "",
    title: row.title,
    permalink: typeof row.permalink === "string" ? row.permalink : null,
    thumbnailUrl: typeof row.thumbnailUrl === "string" ? row.thumbnailUrl : null,
    publishedAt: typeof row.publishedAt === "string" ? row.publishedAt : null,
    metrics,
  };
}

function isMetric(value: unknown): value is SocialMetric {
  if (!value || typeof value !== "object") return false;
  const metric = value as Partial<SocialMetric>;
  return typeof metric.key === "string" && (metric.value === null || typeof metric.value === "number");
}
