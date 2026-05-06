import path from "node:path";

/**
 * Root for gallery/auto-merge paths when the Next server reads files locally.
 * The PM2 worker also uses this same effective root.
 */
export const DEFAULT_PHOTOS_ROOT = "D:\\Photos_2026";

export function getPhotosRoot(): string {
  const fromBaseDir = process.env.BASE_DIR?.trim();
  const configuredRoot = fromBaseDir || DEFAULT_PHOTOS_ROOT;

  const defaultResolved = path.resolve(DEFAULT_PHOTOS_ROOT);
  const configuredResolved = path.resolve(configuredRoot);
  const rel = path.relative(defaultResolved, configuredResolved);
  const isWithinDefaultRoot = rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));

  if (!isWithinDefaultRoot) {
    return DEFAULT_PHOTOS_ROOT;
  }

  return configuredResolved;
}

export const PHOTOS_ROOT = getPhotosRoot();
