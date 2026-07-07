/**
 * Shared social publishing utility.
 *
 * Used by both:
 *  - The manual "Publish Now" button in app/scheduler/page.tsx
 *  - The cloud cron job at app/api/cron/publish-social/route.ts
 *
 * Keeps all Meta Graph API interaction in one place so changes propagate everywhere.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { publishToInstagram } from "@/app/actions/publish-instagram";

const GRAPH_VERSION = "v19.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const META_FETCH_TIMEOUT_MS = Number(process.env.META_FETCH_TIMEOUT_MS ?? "15000");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DuePost = {
  id: string;
  profile_id: string;
  file_url: string;
  caption: string | null;
  scheduled_at: string;
};

export type PostPublishOutcome =
  | { postId: string; status: "published"; mediaId: string }
  | { postId: string; status: "failed"; error: string };

export type PublishDuePostsResult = {
  processed: number;
  successful: number;
  failed: number;
  outcomes: PostPublishOutcome[];
};

// ---------------------------------------------------------------------------
// Supabase helpers
// ---------------------------------------------------------------------------

export function makeServiceSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) {
    return null;
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

// ---------------------------------------------------------------------------
// Fetch due posts
// ---------------------------------------------------------------------------

/**
 * Returns all social_posts with status = 'scheduled' whose scheduled_at is
 * in the past or now, across all profiles.
 */
export async function fetchDuePosts(supabase: SupabaseClient): Promise<DuePost[]> {
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("social_posts")
    .select("id, profile_id, file_url, caption, scheduled_at")
    .eq("status", "scheduled")
    .lte("scheduled_at", now)
    .order("scheduled_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch due posts: ${error.message}`);
  }

  return (data ?? []) as DuePost[];
}

// ---------------------------------------------------------------------------
// Mark helpers
// ---------------------------------------------------------------------------

async function markPublished(supabase: SupabaseClient, postId: string): Promise<void> {
  const { error } = await supabase
    .from("social_posts")
    .update({ status: "published", publish_error: null })
    .eq("id", postId);
  if (error) {
    console.error(`[socialPublisher] Failed to mark post ${postId} published:`, error.message);
  }
}

async function markFailed(
  supabase: SupabaseClient,
  postId: string,
  errorMessage: string
): Promise<void> {
  const { error } = await supabase
    .from("social_posts")
    .update({ status: "failed", publish_error: errorMessage.slice(0, 500) })
    .eq("id", postId);
  if (error) {
    console.error(`[socialPublisher] Failed to mark post ${postId} failed:`, error.message);
  }
}

// ---------------------------------------------------------------------------
// Credential lookup
// ---------------------------------------------------------------------------

type ProfileCredentials = {
  igAccountId: string;
  accessToken: string;
};

async function getProfileCredentials(
  supabase: SupabaseClient,
  profileId: string
): Promise<ProfileCredentials | null> {
  const { data, error } = await supabase
    .from("social_profiles")
    .select("ig_account_id, access_token")
    .eq("id", profileId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const igAccountId =
    typeof data.ig_account_id === "string" ? data.ig_account_id.trim() : "";
  const accessToken =
    typeof data.access_token === "string" ? data.access_token.trim() : "";

  if (!igAccountId || !accessToken) {
    return null;
  }

  return { igAccountId, accessToken };
}

// ---------------------------------------------------------------------------
// Publish a single post
// ---------------------------------------------------------------------------

async function publishSinglePost(
  supabase: SupabaseClient,
  post: DuePost
): Promise<PostPublishOutcome> {
  const fileUrl = post.file_url?.trim() ?? "";
  if (!fileUrl || fileUrl.startsWith("blob:")) {
    const error = "Post has no public image URL.";
    await markFailed(supabase, post.id, error);
    return { postId: post.id, status: "failed", error };
  }

  const credentials = await getProfileCredentials(supabase, post.profile_id);
  if (!credentials) {
    const error = "Profile has no Instagram credentials configured.";
    await markFailed(supabase, post.id, error);
    return { postId: post.id, status: "failed", error };
  }

  const result = await publishToInstagram(
    credentials.igAccountId,
    credentials.accessToken,
    fileUrl,
    post.caption?.trim() ?? ""
  );

  if (!result.ok) {
    await markFailed(supabase, post.id, result.error);
    return { postId: post.id, status: "failed", error: result.error };
  }

  await markPublished(supabase, post.id);
  return { postId: post.id, status: "published", mediaId: result.mediaId };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Fetches all due scheduled posts and publishes them one by one.
 * Returns a summary of results.  Safe to call from both the cron route and
 * manual triggers — no side-effects outside Supabase + Meta Graph API.
 */
export async function publishDuePosts(
  supabase: SupabaseClient
): Promise<PublishDuePostsResult> {
  const duePosts = await fetchDuePosts(supabase);

  const outcomes: PostPublishOutcome[] = [];

  for (const post of duePosts) {
    console.info(
      `[socialPublisher] Publishing post ${post.id} (profile ${post.profile_id}) scheduled at ${post.scheduled_at}`
    );
    const outcome = await publishSinglePost(supabase, post);
    outcomes.push(outcome);
    console.info(`[socialPublisher] Post ${post.id} → ${outcome.status}`);
  }

  const successful = outcomes.filter((o) => o.status === "published").length;
  const failed = outcomes.filter((o) => o.status === "failed").length;

  return {
    processed: duePosts.length,
    successful,
    failed,
    outcomes,
  };
}

// ---------------------------------------------------------------------------
// Video publishing via TikTok-style direct URL (future extension point)
// ---------------------------------------------------------------------------

export type VideoPublishParams = {
  igAccountId: string;
  accessToken: string;
  videoUrl: string;
  caption: string;
};

/**
 * Publishes a Reel / video container via the Instagram Graph API.
 * Uses media_type=REELS for public .mp4 URLs.
 */
export async function publishVideoToInstagram(
  params: VideoPublishParams
): Promise<{ ok: true; mediaId: string } | { ok: false; error: string }> {
  const { igAccountId, accessToken, videoUrl, caption } = params;

  const createParams = new URLSearchParams({
    media_type: "REELS",
    video_url: videoUrl,
    caption,
    access_token: accessToken,
  });

  let createRes: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), META_FETCH_TIMEOUT_MS);
    createRes = await fetch(`${GRAPH_BASE}/${igAccountId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: createParams.toString(),
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error (create container)" };
  }

  const createJson = (await createRes.json().catch(() => ({}))) as {
    id?: string;
    error?: { message?: string };
  };
  if (!createRes.ok || createJson.error) {
    return { ok: false, error: createJson.error?.message ?? "Failed to create video container." };
  }

  const creationId = createJson.id?.trim();
  if (!creationId) {
    return { ok: false, error: "No creation_id returned from Instagram." };
  }

  // Poll status until FINISHED (up to 60 s)
  for (let attempt = 0; attempt < 12; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    const statusRes = await fetch(
      `${GRAPH_BASE}/${creationId}?fields=status_code&access_token=${encodeURIComponent(accessToken)}`
    ).catch(() => null);
    if (!statusRes?.ok) continue;
    const statusJson = (await statusRes.json().catch(() => ({}))) as { status_code?: string };
    if (statusJson.status_code === "FINISHED") break;
    if (statusJson.status_code === "ERROR") {
      return { ok: false, error: "Instagram reported an error processing the video." };
    }
  }

  const publishParams = new URLSearchParams({
    creation_id: creationId,
    access_token: accessToken,
  });

  const publishRes = await fetch(`${GRAPH_BASE}/${igAccountId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: publishParams.toString(),
  }).catch((e) => {
    throw new Error(e instanceof Error ? e.message : "Network error (publish)");
  });

  const publishJson = (await publishRes.json().catch(() => ({}))) as {
    id?: string;
    error?: { message?: string };
  };
  if (!publishRes.ok || publishJson.error) {
    return { ok: false, error: publishJson.error?.message ?? "Failed to publish video." };
  }

  return { ok: true, mediaId: publishJson.id?.trim() ?? creationId };
}
