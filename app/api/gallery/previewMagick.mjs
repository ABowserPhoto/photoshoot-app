import { access, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const execFileAsync = promisify(execFile);

export const PREVIEW_JPEG_QUALITY = 60;

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
 */
export async function buildWatermarkedPreviewFile({
  sourceFilePath,
  watermarkPath,
  previewOutputPath,
  quality = PREVIEW_JPEG_QUALITY,
}) {
  await assertReadableWatermark(watermarkPath);

  await execFileAsync(
    "magick",
    [
      sourceFilePath,
      "-auto-orient",
      "-resize",
      "1200x1200",
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
