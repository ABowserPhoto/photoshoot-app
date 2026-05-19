"use server";

const GRAPH_VERSION = "v19.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

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
  | { ok: true; creationId: string; mediaId: string }
  | { ok: false; error: string; step?: "create_container" | "publish"; details?: unknown };

/**
 * Publishes a photo feed post to an Instagram Business account via Graph API v19.
 * Requires a user or page access token with instagram_content_publish (and related) permissions.
 */
export async function publishToInstagram(
  igAccountId: string,
  accessToken: string,
  imageUrl: string,
  caption: string
): Promise<PublishToInstagramResult> {
  const igId = igAccountId.trim();
  const token = accessToken.trim();
  const img = imageUrl.trim();
  const cap = caption.trim();

  if (!igId || !token || !img) {
    return { ok: false, error: "igAccountId, accessToken, and imageUrl are required." };
  }

  const createParams = new URLSearchParams({
    image_url: img,
    caption: cap,
    access_token: token,
  });

  let createRes: Response;
  try {
    createRes = await fetch(`${GRAPH_BASE}/${igId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: createParams.toString(),
      cache: "no-store",
    });
  } catch (e) {
    console.error("[publish-instagram] create container fetch failed:", e);
    return {
      ok: false,
      error: "Network error while creating media container.",
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
    return {
      ok: false,
      error: createJson.error?.message ?? "Failed to create media container.",
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

  const publishParams = new URLSearchParams({
    creation_id: creationId,
    access_token: token,
  });

  let publishRes: Response;
  try {
    publishRes = await fetch(`${GRAPH_BASE}/${igId}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: publishParams.toString(),
      cache: "no-store",
    });
  } catch (e) {
    console.error("[publish-instagram] publish fetch failed:", e);
    return {
      ok: false,
      error: "Network error while publishing media.",
      step: "publish",
      details: { creationId },
    };
  }

  let publishJson: { id?: string } & GraphErrorBody;
  try {
    publishJson = (await publishRes.json()) as { id?: string } & GraphErrorBody;
  } catch {
    return {
      ok: false,
      error: "Invalid response from Instagram (publish).",
      step: "publish",
      details: { creationId },
    };
  }

  if (!publishRes.ok || publishJson.error) {
    return {
      ok: false,
      error: publishJson.error?.message ?? "Failed to publish media.",
      step: "publish",
      details: publishJson.error ?? publishJson,
    };
  }

  const mediaId = publishJson.id?.trim();
  if (!mediaId) {
    return {
      ok: false,
      error: 'Missing media id from publish response (expected "id").',
      step: "publish",
      details: publishJson,
    };
  }

  return { ok: true, creationId, mediaId };
}
