"use server";

import { createClient } from "@supabase/supabase-js";

import { getAuthRole } from "@/lib/server/getAuthRole";
import { fetchWithTimeout, toFetchErrorMessage } from "@/lib/server/fetchWithTimeout";

const INIT_URL = "https://open.tiktokapis.com/v2/post/publish/video/init/";
const TIKTOK_FETCH_TIMEOUT_MS = Number(process.env.TIKTOK_FETCH_TIMEOUT_MS ?? "30000");

export type PublishToTikTokResult = { ok: true } | { ok: false; error: string; step?: string };

function serviceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const key = serviceKey || anonKey;
  if (!url || !key) {
    return null;
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

type InitResponse = {
  data?: { publish_id?: string; upload_url?: string };
  error?: { code?: string; message?: string; log_id?: string };
};

/**
 * Uploads an MP4 video to TikTok via Content Posting API (direct post, FILE_UPLOAD).
 * Loads credentials from social_profiles for the given profile id.
 */
export async function publishToTikTok(
  profileId: string,
  videoUrl: string,
  caption: string,
): Promise<PublishToTikTokResult> {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return { ok: false, error: "Unauthorized", step: "auth" };
  }

  const pid = profileId.trim();
  const url = videoUrl.trim();
  const title = caption.trim();

  if (!pid || !url) {
    return { ok: false, error: "profileId and videoUrl are required.", step: "validate" };
  }

  const supabase = serviceSupabase();
  if (!supabase) {
    return { ok: false, error: "Database is not configured.", step: "db" };
  }

  const { data: row, error: readErr } = await supabase
    .from("social_profiles")
    .select("tiktok_access_token")
    .eq("id", pid)
    .maybeSingle();

  if (readErr) {
    console.error("[publish-tiktok] read profile", readErr);
    return { ok: false, error: readErr.message, step: "db" };
  }

  const accessToken = (row as { tiktok_access_token?: string | null } | null)?.tiktok_access_token?.trim();
  if (!accessToken) {
    return { ok: false, error: "No TikTok access token for this profile. Connect TikTok first.", step: "token" };
  }

  let videoRes: Response;
  try {
    videoRes = await fetchWithTimeout(
      url,
      {
        cache: "no-store",
      },
      TIKTOK_FETCH_TIMEOUT_MS
    );
  } catch (e) {
    console.error("[publish-tiktok] fetch video", e);
    return { ok: false, error: toFetchErrorMessage(e, "Could not download video from URL"), step: "fetch_video" };
  }

  if (!videoRes.ok) {
    return {
      ok: false,
      error: `Video download failed (${videoRes.status}).`,
      step: "fetch_video",
    };
  }

  const buffer = await videoRes.arrayBuffer();
  const size = buffer.byteLength;
  if (size === 0) {
    return { ok: false, error: "Video file is empty.", step: "fetch_video" };
  }

  const initBody = {
    post_info: {
      title: title || " ",
      privacy_level: "SELF_ONLY",
      disable_comment: false,
    },
    source_info: {
      source: "FILE_UPLOAD",
      video_size: size,
      chunk_size: size,
      total_chunk_count: 1,
    },
  };

  let initRes: Response;
  try {
    initRes = await fetchWithTimeout(
      INIT_URL,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify(initBody),
        cache: "no-store",
      },
      TIKTOK_FETCH_TIMEOUT_MS
    );
  } catch (e) {
    console.error("[publish-tiktok] init", e);
    return { ok: false, error: toFetchErrorMessage(e, "Network error during TikTok init"), step: "init" };
  }

  let initJson: InitResponse;
  try {
    initJson = (await initRes.json()) as InitResponse;
  } catch {
    return { ok: false, error: "Invalid JSON from TikTok init.", step: "init" };
  }

  if (initJson.error?.code !== "ok" || !initJson.data?.upload_url?.trim()) {
    const msg =
      initJson.error?.message ||
      (initJson.error?.code ? `TikTok error: ${initJson.error.code}` : "TikTok init failed.");
    return { ok: false, error: msg, step: "init" };
  }

  const uploadUrl = initJson.data.upload_url.trim();
  const lastByte = size - 1;

  let putRes: Response;
  try {
    putRes = await fetchWithTimeout(
      uploadUrl,
      {
        method: "PUT",
        headers: {
          "Content-Type": "video/mp4",
          "Content-Range": `bytes 0-${lastByte}/${size}`,
          "Content-Length": String(size),
        },
        body: buffer,
        cache: "no-store",
      },
      TIKTOK_FETCH_TIMEOUT_MS
    );
  } catch (e) {
    console.error("[publish-tiktok] upload", e);
    return {
      ok: false,
      error: toFetchErrorMessage(e, "Network error during video upload to TikTok"),
      step: "upload",
    };
  }

  if (!putRes.ok) {
    let detail = `Upload failed (${putRes.status}).`;
    try {
      const errText = await putRes.text();
      if (errText) {
        detail = `${detail} ${errText.slice(0, 200)}`;
      }
    } catch {
      /* ignore */
    }
    return { ok: false, error: detail, step: "upload" };
  }

  return { ok: true };
}
