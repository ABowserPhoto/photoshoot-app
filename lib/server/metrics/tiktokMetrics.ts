import { fetchWithTimeout } from "@/lib/server/fetchWithTimeout";
import {
  accountKey,
  emptyAccount,
  metricsFromRecord,
  parseTikTokUserInfo,
  parseTikTokVideoPage,
  sanitizeProviderError,
  tiktokVideosInRange,
  withDerivedMetrics,
  type SocialAccountMetrics,
  type SocialTopPost,
  type TikTokVideo,
} from "@/lib/socialMetricsModel";

const TIMEOUT_MS = Number(process.env.TIKTOK_FETCH_TIMEOUT_MS ?? "20000");

export type TikTokFetchResult = {
  account: SocialAccountMetrics;
  displayName: string | null;
  username: string | null;
  authFailed: boolean;
};

async function tiktokPost(path: string, accessToken: string, body: Record<string, unknown>): Promise<unknown> {
  const response = await fetchWithTimeout(
    path,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    },
    TIMEOUT_MS
  );
  return response.json().catch(() => null);
}

export async function fetchTikTokMetrics(input: {
  profileId: string;
  openId: string | null;
  handle: string | null;
  accessToken: string;
  scope: string | null;
  rangeStart: string;
  rangeEnd: string;
}): Promise<TikTokFetchResult> {
  const externalId = input.openId?.trim() || input.profileId;
  const key = accountKey("tiktok", input.profileId, externalId);
  const base = {
    accountKey: key,
    platform: "tiktok" as const,
    profileId: input.profileId,
    label: input.handle?.trim() || "TikTok",
    handle: input.handle,
  };

  if (input.scope && !input.scope.includes("user.info.stats")) {
    return {
      account: emptyAccount({
        ...base,
        status: "error",
        statusMessage:
          "This TikTok connection can publish, but analytics scopes were not granted. Reconnect TikTok and approve user.info.stats and video.list.",
      }),
      displayName: null,
      username: null,
      authFailed: false,
    };
  }

  let userPayload: unknown;
  try {
    const fields = "open_id,display_name,username,follower_count,following_count,likes_count,video_count";
    userPayload = await tiktokPost(
      `https://open.tiktokapis.com/v2/user/info/?fields=${encodeURIComponent(fields)}`,
      input.accessToken,
      {}
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "network_error";
    return {
      account: emptyAccount({ ...base, status: "error", statusMessage: sanitizeProviderError(message) }),
      displayName: null,
      username: null,
      authFailed: false,
    };
  }

  const parsedUser = parseTikTokUserInfo(userPayload);
  if (parsedUser.error || !parsedUser.user) {
    const authFailed = /token|unauthor|scope/i.test(parsedUser.error ?? "");
    return {
      account: emptyAccount({
        ...base,
        status: "error",
        statusMessage: parsedUser.error ?? "TikTok did not return profile stats.",
      }),
      displayName: null,
      username: null,
      authFailed,
    };
  }

  const user = parsedUser.user;
  const username = user.username?.replace(/^@/, "").trim() || null;
  const displayName = user.display_name?.trim() || null;
  const totals: Record<string, number> = {};
  if (typeof user.follower_count === "number") totals.followers = user.follower_count;
  if (typeof user.following_count === "number") totals.following = user.following_count;
  if (typeof user.likes_count === "number") totals.lifetime_likes = user.likes_count;
  if (typeof user.video_count === "number") totals.video_count = user.video_count;

  const videos = await listVideos(input.accessToken);
  const ranged = videos.error
    ? []
    : tiktokVideosInRange(videos.videos, input.rangeStart, input.rangeEnd);
  const source = ranged.length > 0 ? ranged : videos.videos;
  const period = sumVideos(source);
  Object.assign(totals, period);

  const topPosts = [...source]
    .sort((left, right) => (right.view_count ?? 0) - (left.view_count ?? 0))
    .slice(0, 4)
    .map((video) => toPost(key, video));

  const metrics = withDerivedMetrics(metricsFromRecord(totals), []);
  const rangeNote =
    ranged.length === 0 && videos.videos.length > 0
      ? "No TikTok videos were published in this date range. Counts above include the lifetime profile and recent videos."
      : null;
  const videoNote = videos.error
    ? "Profile totals loaded. Video stats need the video.list scope — reconnect TikTok and approve it."
    : rangeNote;

  return {
    account: {
      ...base,
      label: username ? `@${username}` : displayName || base.label,
      handle: username ? `@${username}` : input.handle,
      status: metrics.length > 0 ? "ok" : "error",
      statusMessage: videoNote,
      metrics,
      series: [],
      topPosts,
      capturedAt: new Date().toISOString(),
      fromCache: false,
    },
    displayName,
    username,
    authFailed: false,
  };
}

async function listVideos(accessToken: string): Promise<{ videos: TikTokVideo[]; error: string | null }> {
  const fields = "id,title,video_description,create_time,cover_image_url,share_url,view_count,like_count,comment_count,share_count";
  const videos: TikTokVideo[] = [];
  let cursor: number | null = null;
  let error: string | null = null;

  for (let page = 0; page < 3; page += 1) {
    let payload: unknown;
    try {
      payload = await tiktokPost(
        `https://open.tiktokapis.com/v2/video/list/?fields=${encodeURIComponent(fields)}`,
        accessToken,
        cursor === null ? { max_count: 20 } : { max_count: 20, cursor }
      );
    } catch (caught) {
      error = caught instanceof Error ? sanitizeProviderError(caught.message) : "video_list_failed";
      break;
    }
    const parsed = parseTikTokVideoPage(payload);
    if (parsed.error) {
      error = sanitizeProviderError(parsed.error);
      break;
    }
    videos.push(...parsed.videos);
    if (!parsed.hasMore || parsed.cursor === null) break;
    cursor = parsed.cursor;
  }

  return { videos, error: videos.length > 0 ? null : error };
}

function sumVideos(videos: TikTokVideo[]): Record<string, number> {
  if (videos.length === 0) return {};
  const totals = { views: 0, likes: 0, comments: 0, shares: 0, impressions: 0 };
  for (const video of videos) {
    totals.views += video.view_count ?? 0;
    totals.likes += video.like_count ?? 0;
    totals.comments += video.comment_count ?? 0;
    totals.shares += video.share_count ?? 0;
  }
  totals.impressions = totals.views;
  return totals;
}

function toPost(ownerKey: string, video: TikTokVideo): SocialTopPost {
  const title = video.title?.trim() || video.video_description?.trim() || "TikTok video";
  const record: Record<string, number> = {};
  if (typeof video.view_count === "number") {
    record.views = video.view_count;
    record.impressions = video.view_count;
  }
  if (typeof video.like_count === "number") record.likes = video.like_count;
  if (typeof video.comment_count === "number") record.comments = video.comment_count;
  if (typeof video.share_count === "number") record.shares = video.share_count;
  return {
    id: video.id || title,
    platform: "tiktok",
    accountKey: ownerKey,
    title: title.slice(0, 90),
    permalink: video.share_url?.trim() || null,
    thumbnailUrl: video.cover_image_url?.trim() || null,
    publishedAt:
      typeof video.create_time === "number" ? new Date(video.create_time * 1000).toISOString() : null,
    metrics: withDerivedMetrics(metricsFromRecord(record), []),
  };
}
