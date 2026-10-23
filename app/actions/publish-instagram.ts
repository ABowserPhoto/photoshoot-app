"use server";

import {
  normalizeInstagramPostType,
  validateMediaForPostType,
  type InstagramPostType,
} from "@/lib/instagramMedia";
import { fetchWithTimeout, toFetchErrorMessage } from "@/lib/server/fetchWithTimeout";

const GRAPH_VERSION = "v19.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const META_FETCH_TIMEOUT_MS = Number(process.env.META_FETCH_TIMEOUT_MS ?? "15000");
const CONTAINER_STATUS_POLL_ATTEMPTS = 24;
const CONTAINER_STATUS_POLL_MS = 5_000;
const MEDIA_NOT_READY_CODE = 9007;
const PUBLISH_RETRY_ATTEMPTS = 6;
const PUBLISH_RETRY_MS = 5_000;

type GraphErrorBody = {
  error?: {
    message: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
};

export type PublishToInstagramResult =
  | { ok: true; creationId: string; mediaId: string; scheduled: boolean }
  | {
      ok: false;
      error: string;
      step?: "validate" | "create_container" | "wait_ready" | "publish";
      details?: unknown;
    };

export type PublishToInstagramParams = {
  igAccountId: string;
  accessToken: string;
  mediaUrl: string;
  caption?: string;
  postType?: InstagramPostType | string;
  /** Unix timestamp (seconds). When set, Meta is asked to publish at that time. */
  scheduledPublishTimeUnix?: number;
};

function formatGraphError(error: GraphErrorBody["error"] | undefined, fallback: string): string {
  if (!error?.message) return fallback;
  const parts = [error.message];
  if (error.code != null) parts.push(`(code ${error.code})`);
  if (error.error_subcode != null) parts.push(`(subcode ${error.error_subcode})`);
  return parts.join(" ");
}

async function waitForContainerReady(
  creationId: string,
  accessToken: string
): Promise<{ ok: true } | { ok: false; error: string; details?: unknown }> {
  for (let attempt = 0; attempt < CONTAINER_STATUS_POLL_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, CONTAINER_STATUS_POLL_MS));
    }
    let statusRes: Response;
    try {
      statusRes = await fetchWithTimeout(
        `${GRAPH_BASE}/${creationId}?fields=status_code&access_token=${encodeURIComponent(accessToken)}`,
        { method: "GET", cache: "no-store" },
        META_FETCH_TIMEOUT_MS
      );
    } catch (e) {
      return {
        ok: false,
        error: toFetchErrorMessage(e, "Network error while checking media container status"),
      };
    }
    const statusJson = (await statusRes.json().catch(() => ({}))) as {
      status_code?: string;
    } & GraphErrorBody;
    if (!statusRes.ok || statusJson.error) {
      return {
        ok: false,
        error: formatGraphError(statusJson.error, "Failed to check media container status."),
        details: statusJson.error ?? statusJson,
      };
    }
    if (statusJson.status_code === "FINISHED") {
      return { ok: true };
    }
    if (statusJson.status_code === "ERROR") {
      return {
        ok: false,
        error: "Instagram reported an error processing the media container.",
        details: statusJson,
      };
    }
    // Static image containers often omit status_code; give Meta time before publish (9007).
    if (!statusJson.status_code) {
      await new Promise((resolve) => setTimeout(resolve, CONTAINER_STATUS_POLL_MS));
      return { ok: true };
    }
  }
  return {
    ok: false,
    error: "Timed out waiting for Instagram to finish processing the media container.",
  };
}

async function publishContainerWithRetry(
  igId: string,
  creationId: string,
  token: string
): Promise<
  | { ok: true; mediaId: string; publishJson: { id?: string } & GraphErrorBody }
  | { ok: false; error: string; details?: unknown }
> {
  const publishParams = new URLSearchParams({
    creation_id: creationId,
    access_token: token,
  });

  for (let attempt = 0; attempt < PUBLISH_RETRY_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, PUBLISH_RETRY_MS));
    }

    let publishRes: Response;
    try {
      publishRes = await fetchWithTimeout(
        `${GRAPH_BASE}/${igId}/media_publish`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: publishParams.toString(),
          cache: "no-store",
        },
        META_FETCH_TIMEOUT_MS
      );
    } catch (e) {
      if (attempt === PUBLISH_RETRY_ATTEMPTS - 1) {
        return {
          ok: false,
          error: toFetchErrorMessage(e, "Network error while publishing media"),
          details: { creationId },
        };
      }
      continue;
    }

    let publishJson: { id?: string } & GraphErrorBody;
    try {
      publishJson = (await publishRes.json()) as { id?: string } & GraphErrorBody;
    } catch {
      return {
        ok: false,
        error: "Invalid response from Instagram (publish).",
        details: { creationId },
      };
    }

    if (publishRes.ok && !publishJson.error) {
      const mediaId = publishJson.id?.trim() || creationId;
      return { ok: true, mediaId, publishJson };
    }

    const code = publishJson.error?.code;
    const retryable =
      code === MEDIA_NOT_READY_CODE ||
      /media id is not available|not available/i.test(publishJson.error?.message ?? "");

    if (retryable && attempt < PUBLISH_RETRY_ATTEMPTS - 1) {
      console.warn("[publish-instagram] Media not ready (9007), retrying publish…", {
        creationId,
        attempt: attempt + 1,
      });
      continue;
    }

    return {
      ok: false,
      error: formatGraphError(publishJson.error, "Failed to publish media."),
      details: publishJson.error ?? publishJson,
    };
  }

  return {
    ok: false,
    error: "Failed to publish media after retries.",
    details: { creationId },
  };
}

/**
 * Publishes (or Meta-schedules) content to an Instagram Business account via Graph API v19.
 */
export async function publishToInstagram(
  igAccountIdOrParams: string | PublishToInstagramParams,
  accessTokenArg?: string,
  mediaUrlArg?: string,
  captionArg?: string
): Promise<PublishToInstagramResult> {
  // Backward-compatible positional signature used by existing callers.
  const params: PublishToInstagramParams =
    typeof igAccountIdOrParams === "string"
      ? {
          igAccountId: igAccountIdOrParams,
          accessToken: accessTokenArg ?? "",
          mediaUrl: mediaUrlArg ?? "",
          caption: captionArg ?? "",
          postType: "FEED",
        }
      : igAccountIdOrParams;

  const igId = params.igAccountId.trim();
  const token = params.accessToken.trim();
  const mediaUrl = params.mediaUrl.trim();
  const caption = (params.caption ?? "").trim();
  const postType = normalizeInstagramPostType(params.postType);
  const scheduledUnix =
    typeof params.scheduledPublishTimeUnix === "number" &&
    Number.isFinite(params.scheduledPublishTimeUnix)
      ? Math.floor(params.scheduledPublishTimeUnix)
      : null;
  const isScheduled = scheduledUnix != null;

  if (!igId || !token || !mediaUrl) {
    return {
      ok: false,
      error: "igAccountId, accessToken, and mediaUrl are required.",
      step: "validate",
    };
  }

  const mediaError = validateMediaForPostType(postType, mediaUrl);
  if (mediaError) {
    return { ok: false, error: mediaError, step: "validate" };
  }

  const createParams = new URLSearchParams({
    access_token: token,
  });

  if (postType === "REEL") {
    createParams.set("media_type", "REELS");
    createParams.set("video_url", mediaUrl);
    if (caption) createParams.set("caption", caption);
  } else if (postType === "STORY") {
    createParams.set("media_type", "STORIES");
    if (/\.(mp4|mov|m4v)$/i.test(mediaUrl.split("?")[0] ?? mediaUrl)) {
      createParams.set("video_url", mediaUrl);
    } else {
      createParams.set("image_url", mediaUrl);
    }
  } else {
    createParams.set("image_url", mediaUrl);
    if (caption) createParams.set("caption", caption);
  }

  if (isScheduled && scheduledUnix != null) {
    createParams.set("scheduled_publish_time", String(scheduledUnix));
    // Meta Content Publishing often expects published=false alongside schedule time.
    createParams.set("published", "false");
  }

  let createRes: Response;
  try {
    createRes = await fetchWithTimeout(
      `${GRAPH_BASE}/${igId}/media`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: createParams.toString(),
        cache: "no-store",
      },
      META_FETCH_TIMEOUT_MS
    );
  } catch (e) {
    console.error("[publish-instagram] create container fetch failed:", e, {
      postType,
      isScheduled,
      scheduledUnix,
    });
    return {
      ok: false,
      error: toFetchErrorMessage(e, "Network error while creating media container"),
      step: "create_container",
    };
  }

  let createJson: { id?: string } & GraphErrorBody;
  try {
    createJson = (await createRes.json()) as { id?: string } & GraphErrorBody;
  } catch {
    return {
      ok: false,
      error: "Invalid response from Instagram (create container).",
      step: "create_container",
    };
  }

  if (!createRes.ok || createJson.error) {
    const message = formatGraphError(
      createJson.error,
      "Failed to create media container."
    );
    console.error("[publish-instagram] create container Graph error:", {
      message,
      postType,
      isScheduled,
      scheduledUnix,
      details: createJson.error ?? createJson,
    });
    return {
      ok: false,
      error: message,
      step: "create_container",
      details: createJson.error ?? createJson,
    };
  }

  const creationId = createJson.id?.trim();
  if (!creationId) {
    return {
      ok: false,
      error: 'Missing creation id from container response (expected "id").',
      step: "create_container",
      details: createJson,
    };
  }

  // All containers must finish processing before publish (avoids Graph error 9007).
  const ready = await waitForContainerReady(creationId, token);
  if (!ready.ok) {
    console.error("[publish-instagram] container not ready:", ready.error, {
      creationId,
      postType,
      isScheduled,
      scheduledUnix,
    });
    return {
      ok: false,
      error: ready.error,
      step: "wait_ready",
      details: ready.details,
    };
  }

  // Native Meta schedule: container is created with scheduled_publish_time + published=false.
  // Do not call media_publish — Meta (or Page scheduling whitelist) holds the publish.
  if (isScheduled) {
    console.info("[publish-instagram] Meta native schedule container created:", {
      creationId,
      postType,
      scheduledUnix,
    });
    return { ok: true, creationId, mediaId: creationId, scheduled: true };
  }

  const published = await publishContainerWithRetry(igId, creationId, token);
  if (!published.ok) {
    console.error("[publish-instagram] publish Graph error:", {
      message: published.error,
      creationId,
      details: published.details,
    });
    return {
      ok: false,
      error: published.error,
      step: "publish",
      details: published.details,
    };
  }

  return {
    ok: true,
    creationId,
    mediaId: published.mediaId,
    scheduled: false,
  };
}
