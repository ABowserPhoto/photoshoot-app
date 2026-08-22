export const SOCIAL_MEDIA_BUCKET = "social_media";

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
