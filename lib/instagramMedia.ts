export type InstagramPostType = "FEED" | "REEL" | "STORY";

export const META_NATIVE_SCHEDULE_MIN_MS = 15 * 60 * 1000;
export const META_NATIVE_SCHEDULE_MAX_MS = 75 * 24 * 60 * 60 * 1000;

export function normalizeInstagramPostType(value: unknown): InstagramPostType {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase();
  if (raw === "REEL" || raw === "REELS") return "REEL";
  if (raw === "STORY" || raw === "STORIES") return "STORY";
  return "FEED";
}

export function isVideoMediaUrl(fileUrl: string): boolean {
  const trimmed = fileUrl.trim();
  if (!trimmed || trimmed.startsWith("blob:")) return false;
  try {
    const pathOnly = new URL(trimmed).pathname;
    return /\.(mp4|mov|m4v)$/i.test(pathOnly);
  } catch {
    const noQuery = trimmed.split("?")[0] ?? trimmed;
    return /\.(mp4|mov|m4v)$/i.test(noQuery);
  }
}

export function isImageMediaUrl(fileUrl: string): boolean {
  const trimmed = fileUrl.trim();
  if (!trimmed || trimmed.startsWith("blob:")) return false;
  try {
    const pathOnly = new URL(trimmed).pathname;
    return /\.(jpe?g|png|webp|gif)$/i.test(pathOnly);
  } catch {
    const noQuery = trimmed.split("?")[0] ?? trimmed;
    return /\.(jpe?g|png|webp|gif)$/i.test(noQuery);
  }
}

/** Returns a user-facing error if media doesn't match the selected Instagram post type. */
export function validateMediaForPostType(
  postType: InstagramPostType,
  fileUrl: string
): string | null {
  const url = fileUrl.trim();
  if (!url || url.startsWith("blob:")) {
    return "Upload the media so it has a public URL before publishing or scheduling.";
  }

  if (postType === "REEL") {
    if (!isVideoMediaUrl(url)) {
      return 'Reels require a video file (.mp4 or .mov). Switch to "Grid Post" or "Story" for images.';
    }
    return null;
  }

  if (postType === "STORY") {
    if (!isVideoMediaUrl(url) && !isImageMediaUrl(url)) {
      return "Stories require an image (.jpg/.png) or video (.mp4/.mov) file.";
    }
    return null;
  }

  // FEED / Grid — image preferred; reject obvious video so users pick Reel instead.
  if (isVideoMediaUrl(url)) {
    return 'Grid posts expect an image. Use "Reel" for video files.';
  }
  return null;
}

export function canUseMetaNativeSchedule(
  scheduledAt: Date | null | undefined,
  postType: InstagramPostType,
  now = new Date()
): { ok: true; unixSeconds: number } | { ok: false; reason: string } {
  if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) {
    return { ok: false, reason: "No scheduled time." };
  }
  if (postType === "STORY") {
    return {
      ok: false,
      reason: "Instagram Stories cannot use Meta native scheduling; using local worker fallback.",
    };
  }

  const deltaMs = scheduledAt.getTime() - now.getTime();
  if (deltaMs < META_NATIVE_SCHEDULE_MIN_MS) {
    return {
      ok: false,
      reason: "Scheduled time is less than 15 minutes away; using local worker fallback.",
    };
  }
  if (deltaMs > META_NATIVE_SCHEDULE_MAX_MS) {
    return {
      ok: false,
      reason: "Scheduled time is more than 75 days away; Meta rejects native scheduling that far out.",
    };
  }

  return { ok: true, unixSeconds: Math.floor(scheduledAt.getTime() / 1000) };
}
