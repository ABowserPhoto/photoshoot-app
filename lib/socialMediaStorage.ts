export const SOCIAL_MEDIA_BUCKET = "social_media";

function supabaseProjectRefFromEnv(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!url) {
    return null;
  }
  try {
    const host = new URL(url).hostname;
    const match = host.match(/^([a-z0-9-]+)\.supabase\.co$/i);
    return match?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

/**
 * Extract the object path inside a Supabase Storage bucket from a public (or signed) URL.
 * Returns null for blob: URLs and non-Supabase URLs.
 */
export function storagePathFromPublicUrl(
  fileUrl: string,
  bucket: string = SOCIAL_MEDIA_BUCKET
): string | null {
  const trimmed = fileUrl.trim();
  if (!trimmed || trimmed.startsWith("blob:")) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    const patterns = [
      `/storage/v1/object/public/${bucket}/`,
      `/storage/v1/object/sign/${bucket}/`,
      `/storage/v1/object/authenticated/${bucket}/`,
    ];

    for (const marker of patterns) {
      const idx = url.pathname.indexOf(marker);
      if (idx >= 0) {
        const encodedPath = url.pathname.slice(idx + marker.length);
        return decodeURIComponent(encodedPath);
      }
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Validates that a URL points at an object in the social_media bucket for this task.
 * Used by server routes after client-side direct-to-storage uploads.
 */
export function isTaskSocialMediaFileUrl(fileUrl: string, taskId: string): boolean {
  const trimmedUrl = fileUrl.trim();
  const trimmedTaskId = taskId.trim();
  if (!trimmedUrl || !trimmedTaskId) {
    return false;
  }

  const path = storagePathFromPublicUrl(trimmedUrl, SOCIAL_MEDIA_BUCKET);
  if (!path) {
    return false;
  }

  const allowedPrefixes = [`queue/${trimmedTaskId}/`, `${trimmedTaskId}/`];
  if (!allowedPrefixes.some((prefix) => path.startsWith(prefix)) && !path.includes(`/${trimmedTaskId}/`)) {
    return false;
  }

  const projectRef = supabaseProjectRefFromEnv();
  if (!projectRef) {
    return true;
  }

  try {
    const host = new URL(trimmedUrl).hostname.toLowerCase();
    return host === `${projectRef}.supabase.co`;
  } catch {
    return false;
  }
}
