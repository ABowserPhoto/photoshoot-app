import { access, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const execFileAsync = promisify(execFile);

export const PREVIEW_JPEG_QUALITY = 60;

/** Opacity applied only to the watermark layer's alpha channel (never the base photo). */
export const WATERMARK_OPACITY = 0.34;

/**
 * Drop semi-opaque fill in the tile sheet while keeping logo ink.
 * The watermark PNG uses near-white RGB with mid-range alpha in tile gaps; those
 * pixels create the washed-out haze when composited. Logo strokes sit above this.
 */
const WATERMARK_ALPHA_INK_THRESHOLD = "70%";

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

async function probePreviewDimensions(sourceFilePath, photoshootType) {
  const { stdout } = await execFileAsync(
    "magick",
    [
      sourceFilePath,
      "-auto-orient",
      "-resize",
      previewResizeGeometry(photoshootType),
      "-format",
      "%wx%h",
      "info:",
    ],
    {
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    }
  );
  const match = String(stdout).trim().match(/^(\d+)x(\d+)$/);
  if (!match) {
    throw new Error(`Could not determine preview dimensions for "${sourceFilePath}".`);
  }
  return { width: match[1], height: match[2] };
}

/**
 * Build a lightweight watermarked gallery preview via ImageMagick v7.
 * Uses execFile (no shell) so Windows never interprets resize geometry as redirection.
 *
 * Guarantees:
 * - Base photo stays at full opacity (no alpha/opacity ops on the primary buffer).
 * - Opacity is applied only to the watermark buffer before a single Over composite.
 * - Watermark is contain-fitted once (no crop / no tile loop / no white extent fill).
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
  watermarkOpacity = WATERMARK_OPACITY,
}) {
  await assertReadableWatermark(watermarkPath);

  const opacity = Number(watermarkOpacity);
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
    throw new Error(`watermarkOpacity must be between 0 and 1 (received ${watermarkOpacity}).`);
  }

  const { width, height } = await probePreviewDimensions(sourceFilePath, photoshootType);
  const geometry = previewResizeGeometry(photoshootType);

  await execFileAsync(
    "magick",
    [
      sourceFilePath,
      "-auto-orient",
      "-resize",
      geometry,
      // Watermark-only subexpression: never mutate the base image buffer.
      "(",
      watermarkPath,
      "-background",
      "none",
      "-alpha",
      "set",
      // Remove mid-alpha white/gray tile-fill (haze); keep high-alpha logo ink.
      "(",
      "+clone",
      "-alpha",
      "extract",
      "-threshold",
      WATERMARK_ALPHA_INK_THRESHOLD,
      ")",
      "-alpha",
      "off",
      "-compose",
      "copyopacity",
      "-composite",
      // Contain-fit once inside the resized base (no ^ crop) — full watermark visible.
      "-resize",
      `${width}x${height}`,
      "-gravity",
      "center",
      // background none (set above) keeps extent padding transparent, not white.
      "-extent",
      `${width}x${height}`,
      "-channel",
      "A",
      "-evaluate",
      "multiply",
      String(opacity),
      "+channel",
      ")",
      "-gravity",
      "center",
      "-compose",
      "Over",
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
