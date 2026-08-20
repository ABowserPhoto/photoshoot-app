import { access, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const execFileAsync = promisify(execFile);

export const PREVIEW_JPEG_QUALITY = 60;

/** Shoot types that keep landscape gallery tiles / preview framing. */
export function isLandscapePhotoshootType(photoshootType) {
  const type = String(photoshootType ?? "")
    .trim()
    .toLowerCase();
  return type === "immobilien" || type === "food" || type === "real estate";
}

/**
 * ImageMagick geometry that fits inside a box without forcing landscape/portrait.
 * Landscape shoots get a wider box; portrait shoots get a taller box so vertical
 * Nikon NEFs are not visually framed as landscape downstream.
 */
export function previewResizeGeometry(photoshootType) {
  return isLandscapePhotoshootType(photoshootType) ? "1200x900>" : "900x1200>";
}

export async function assertReadableWatermark(watermarkPath) {
  const info = await stat(watermarkPath);
  if (!info.isFile() || info.size < 64) {
    throw new Error(`Watermark file is missing or invalid at "${watermarkPath}".`);
  }
  await access(watermarkPath);
}

/**
 * Build a lightweight watermarked gallery preview via ImageMagick v7.
 * Uses execFile (no shell) so Windows never interprets resize geometry as redirection.
 * Watermark opacity is applied inside a sub-expression so only the overlay is modified.
 *
 * Always runs -auto-orient so EXIF Orientation (or orientation baked into the source
 * pixels by the worker for NEF extracts) is respected before resize/composite.
 */
export async function buildWatermarkedPreviewFile({
  sourceFilePath,
  watermarkPath,
  previewOutputPath,
  quality = PREVIEW_JPEG_QUALITY,
  photoshootType = "",
}) {
  await assertReadableWatermark(watermarkPath);

  await execFileAsync(
    "magick",
    [
      sourceFilePath,
      "-auto-orient",
      "-resize",
      previewResizeGeometry(photoshootType),
      "(",
      watermarkPath,
      "-channel",
      "A",
      "-evaluate",
      "multiply",
      "0.4",
      "+channel",
      ")",
      "-gravity",
      "center",
      "-composite",
      "-quality",
      String(quality),
      previewOutputPath,
    ],
    {
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    }
  );
}
