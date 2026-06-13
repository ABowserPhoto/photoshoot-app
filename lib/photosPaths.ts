import path from "node:path";

/**
 * Root for gallery/auto-merge paths when the Next server reads files locally.
 * The PM2 worker also uses this same effective root.
 *
 * IMPORTANT: The root is assembled at runtime (array join) so Next.js Node File
 * Tracing (NFT) cannot statically resolve "D:\Photos_2026" and try to bundle the
 * entire photo library into the standalone server build.
 */
const DEFAULT_PHOTOS_ROOT_SEGMENTS = ["D:", "Photos_2026"];

export const DEFAULT_PHOTOS_ROOT = DEFAULT_PHOTOS_ROOT_SEGMENTS.join("\\");

export function getPhotosRoot(): string {
  const fromBaseDir = process.env.BASE_DIR?.trim();
  const defaultRoot = [DEFAULT_PHOTOS_ROOT].join("");
  const configuredRoot = fromBaseDir || defaultRoot;

  const defaultResolved = path.resolve([defaultRoot].join(""));
  const configuredResolved = path.resolve([configuredRoot].join(""));
  const rel = path.relative(defaultResolved, configuredResolved);
  const isWithinDefaultRoot = rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));

  if (!isWithinDefaultRoot) {
    return defaultRoot;
  }

  return configuredResolved;
}

export const PHOTOS_ROOT = getPhotosRoot();
