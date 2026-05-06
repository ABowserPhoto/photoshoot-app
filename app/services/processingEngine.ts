import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ExifReader from "exifreader";

import { PHOTOS_ROOT } from "@/lib/photosPaths";

const execAsync = promisify(exec);

/** Seconds between bracket groups (tripod rule): gap ≥ this starts a new bracket. */
const BRACKET_GAP_THRESHOLD_SEC = 4;

const SNS_HDR_PATH = '"C:\\Program Files\\SNS-HDR Pro 2\\SNS-HDR.exe"';
const COMFY_TRIGGER_TOKENS = (process.env.COMFYUI_TRIGGER_TOKENS ?? "_sqi")
  .split(",")
  .map((token) => token.trim().toLowerCase())
  .filter(Boolean);

const IMAGE_EXT = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".tif",
  ".tiff",
  ".webp",
  ".bmp",
  ".gif",
  ".heic",
  ".heif",
  ".nef",
]);

export type ProcessingSummary = {
  ok: boolean;
  mergedFiles?: string[];
  error?: string;
};

type RationalLike = {
  value: [number, number];
  computed?: number | null;
};

type PhotoMeta = {
  fileName: string;
  fullPath: string;
  /** Epoch ms for shutter open (best effort). */
  startMs: number;
  /** Duration of current exposure in seconds. */
  exposureSec: number;
};

function isImageFile(fileName: string): boolean {
  return IMAGE_EXT.has(path.extname(fileName).toLowerCase());
}

function quoteArg(p: string): string {
  return `"${p.replace(/"/g, '\\"')}"`;
}

function createSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return null;
  }
  return createClient(url, key);
}

function resolveInternalAppOrigin(): string {
  return process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") ?? "http://127.0.0.1:3000";
}

function validateShootFolder(shootFolderPath: string): { taskRoot: string; localFolderName: string } {
  const taskRoot = path.resolve(shootFolderPath.trim());
  const rootResolved = path.resolve(PHOTOS_ROOT);
  const rel = path.relative(rootResolved, taskRoot);
  if (rel.startsWith("..") || path.isAbsolute(rel) || !rel) {
    throw new Error("shootFolderPath must be a folder under PHOTOS_ROOT.");
  }
  return { taskRoot, localFolderName: rel };
}

function readStringTagDescription(
  value: { description: string | string[] } | undefined
): string | null {
  if (!value) {
    return null;
  }
  const d = value.description;
  if (Array.isArray(d)) {
    return d[0] ?? null;
  }
  return typeof d === "string" && d.trim() ? d : null;
}

function parseExifDateTimeToMs(dateTime: string | null): number | null {
  if (!dateTime) {
    return null;
  }
  const s = dateTime.trim();
  const m = s.match(/^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) {
    return null;
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const sec = Number(m[6]);
  if (![y, mo, d, h, mi, sec].every((n) => Number.isFinite(n))) {
    return null;
  }
  return new Date(y, mo - 1, d, h, mi, sec).getTime();
}

function parseExposureSeconds(tag: RationalLike | undefined): number {
  if (!tag) {
    return 0;
  }
  if (typeof tag.computed === "number" && Number.isFinite(tag.computed)) {
    return Math.max(0, tag.computed);
  }
  const [num, denom] = tag.value;
  if (!denom || !Number.isFinite(num) || !Number.isFinite(denom)) {
    return 0;
  }
  return Math.max(0, num / denom);
}

function mergedOutputFileName(
  firstFileInGroup: string,
  bracketIndex: number,
  totalBrackets: number
): string {
  const stem = path.basename(firstFileInGroup, path.extname(firstFileInGroup));
  const withoutFrameIndex = stem.replace(/_\d+$/i, "");
  if (totalBrackets <= 1) {
    return `${withoutFrameIndex}-merged.jpg`;
  }
  return `${withoutFrameIndex}-merged-${bracketIndex}.jpg`;
}

/**
 * True gap to next frame: (next start) - (current start + current exposure).
 * Same bracket if gap < 4s.
 */
function buildBracketsByTripodRule(sorted: PhotoMeta[]): PhotoMeta[][] {
  if (sorted.length === 0) {
    return [];
  }
  const brackets: PhotoMeta[][] = [];
  let current: PhotoMeta[] = [sorted[0]!];

  for (let i = 0; i < sorted.length - 1; i += 1) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    const gapSec = (b.startMs - a.startMs) / 1000 - a.exposureSec;
    if (gapSec < BRACKET_GAP_THRESHOLD_SEC) {
      current.push(b);
    } else {
      brackets.push(current);
      current = [b];
    }
  }
  brackets.push(current);
  return brackets;
}

async function loadPhotoMeta(fullPath: string, fileName: string): Promise<PhotoMeta> {
  let exposureSec = 0;
  let startMs: number | null = null;

  try {
    const buffer = await fs.promises.readFile(fullPath);
    const tags = ExifReader.load(buffer);

    const dtRaw =
      readStringTagDescription(tags["DateTimeOriginal"] as { description: string | string[] }) ??
      readStringTagDescription(tags["DateTime"] as { description: string | string[] });

    startMs = parseExifDateTimeToMs(dtRaw);

    exposureSec = parseExposureSeconds(tags["ExposureTime"] as RationalLike | undefined);
  } catch {
    // Fall through to mtime fallback below.
  }

  const stat = await fs.promises.stat(fullPath);
  if (startMs === null) {
    console.warn(
      `[processingEngine] Missing DateTimeOriginal for ${fileName}; using file mtime for ordering.`
    );
    startMs = stat.mtimeMs;
  }

  return {
    fileName,
    fullPath,
    startMs,
    exposureSec,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Rename newest Comfy output (AI_<mergedStem>*) to a clean name, matching /api/auto-merge behavior. */
async function cleanupComfyFinalFilename(params: {
  localFolderName: string;
  mergedFilename: string;
  baseName: string;
  bracketIndex: number;
}): Promise<void> {
  const { localFolderName, mergedFilename, baseName, bracketIndex } = params;
  const finalDir = path.join(PHOTOS_ROOT, localFolderName, "4_Final");
  const mergedStem = path.basename(mergedFilename, path.extname(mergedFilename));
  const comfyPrefix = `AI_${mergedStem}`;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const entries = await fs.promises.readdir(finalDir, { withFileTypes: true }).catch(() => []);
    const candidates = entries
      .filter((e) => e.isFile() && e.name.startsWith(comfyPrefix))
      .map((e) => e.name);

    if (candidates.length > 0) {
      const stats = await Promise.all(
        candidates.map(async (name) => {
          const fullPath = path.join(finalDir, name);
          const stat = await fs.promises.stat(fullPath);
          return { name, fullPath, mtimeMs: stat.mtimeMs };
        })
      );
      stats.sort((a, b) => b.mtimeMs - a.mtimeMs);
      const newest = stats[0]!;
      const ext = path.extname(newest.name) || ".jpg";
      const cleanName = `${baseName}_${bracketIndex}${ext}`;
      const cleanPath = path.join(finalDir, cleanName);

      if (newest.fullPath.toLowerCase() === cleanPath.toLowerCase()) {
        return;
      }

      if (fs.existsSync(cleanPath)) {
        await fs.promises.unlink(cleanPath);
      }
      await fs.promises.rename(newest.fullPath, cleanPath);
      return;
    }

    await sleep(300);
  }
}

function baseNameForCleanup(firstFilename: string): string {
  const stem = path.basename(firstFilename, path.extname(firstFilename));
  const withoutSqi = stem.replace(/_sqi$/i, "");
  const withoutIndex = withoutSqi.replace(/[_-]\d+$/i, "");
  const normalized = withoutIndex.trim().replace(/[<>:"/\\|?*]/g, "_");
  return normalized || "merged";
}

function extractRemovalTargetFromFilename(filename: string): string | null {
  const stem = path.basename(filename, path.extname(filename));
  const match = stem.match(/_rm-([^_.]+)/i);
  if (!match?.[1]) {
    return null;
  }
  return match[1].trim() || null;
}

function shouldRunComfyForFilename(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return COMFY_TRIGGER_TOKENS.some((token) => lower.includes(token));
}

export async function startProcessing(taskId: string, shootFolderPath: string): Promise<ProcessingSummary> {
  const supabase = createSupabase();
  const { taskRoot, localFolderName } = validateShootFolder(shootFolderPath);
  const selectsDir = path.join(taskRoot, "2_Selects");
  const mergedDir = path.join(taskRoot, "3. merge");

  const setStatus = async (status: string) => {
    if (!supabase) {
      console.warn(`[processingEngine] Supabase not configured; skip status "${status}" for task ${taskId}.`);
      return;
    }
    const { error } = await supabase.from("tasks").update({ status }).eq("id", taskId);
    if (error) {
      console.error(`[processingEngine] Failed to set status "${status}":`, error.message);
    }
  };

  try {
    await setStatus("Processing");

    if (!fs.existsSync(selectsDir)) {
      throw new Error(`Selects folder missing: ${selectsDir}`);
    }

    fs.mkdirSync(mergedDir, { recursive: true });

    const names = fs
      .readdirSync(selectsDir, { withFileTypes: true })
      .filter((e) => e.isFile() && isImageFile(e.name))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

    if (names.length === 0) {
      throw new Error("No images found in 2_Selects.");
    }

    const metaList: PhotoMeta[] = [];
    for (const name of names) {
      metaList.push(await loadPhotoMeta(path.join(selectsDir, name), name));
    }

    metaList.sort((a, b) => a.startMs - b.startMs);

    const brackets = buildBracketsByTripodRule(metaList);
    const mergedOutputs: string[] = [];
    const mergedMeta: Array<{ outBaseName: string; firstName: string; bracketIndex: number }> = [];
    let bracketIndex = 1;
    const origin = resolveInternalAppOrigin();

    const totalBrackets = brackets.length;
    for (const group of brackets) {
      const inputs = group.map((p) => p.fullPath);
      const firstName = group[0]!.fileName;
      const outBaseName = mergedOutputFileName(firstName, bracketIndex, totalBrackets);
      const outFile = path.join(mergedDir, outBaseName);

      const parts = [SNS_HDR_PATH, "-interior", ...inputs.map(quoteArg), "-o", quoteArg(outFile)];
      const cmd = parts.join(" ");
      await execAsync(cmd, { windowsHide: true });
      mergedOutputs.push(outFile);
      mergedMeta.push({ outBaseName, firstName, bracketIndex });
      try {
        const normalizeCmd = `magick ${quoteArg(outFile)} -normalize ${quoteArg(outFile)}`;
        await execAsync(normalizeCmd, { windowsHide: true });
        console.info(`[processingEngine] ImageMagick normalization complete: ${outBaseName}`);
      } catch (normalizeError) {
        const message =
          normalizeError instanceof Error ? normalizeError.message : "Unknown ImageMagick normalization error.";
        console.error(`[processingEngine] ImageMagick normalization failed for ${outBaseName}:`, message);
        throw new Error(`ImageMagick normalization failed for ${outBaseName}: ${message}`);
      }

      const removalTarget = extractRemovalTargetFromFilename(outBaseName);
      if (removalTarget) {
        const removeRes = await fetch(`${origin}/api/ai-remove`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imagePath: outFile,
            removalTarget,
          }),
        });
        const removePayload = (await removeRes.json().catch(() => null)) as { error?: string } | null;
        if (!removeRes.ok) {
          console.error(
            "[processingEngine] /api/ai-remove failed:",
            removeRes.status,
            removePayload?.error ?? removePayload
          );
        } else {
          console.info(
            `[processingEngine] Queued object removal for ${outBaseName} with target "${removalTarget}".`
          );
        }
      }

      bracketIndex += 1;
    }

    for (const merged of mergedMeta) {
      const runComfy = shouldRunComfyForFilename(merged.outBaseName);
      if (runComfy) {
        const res = await fetch(`${origin}/api/ai-edit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            local_folder_name: localFolderName,
            filename: merged.outBaseName,
          }),
        });
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        if (!res.ok) {
          console.error(
            "[processingEngine] /api/ai-edit failed:",
            res.status,
            payload?.error ?? payload
          );
        } else {
          const baseName = baseNameForCleanup(merged.firstName);
          try {
            await cleanupComfyFinalFilename({
              localFolderName,
              mergedFilename: merged.outBaseName,
              baseName,
              bracketIndex: merged.bracketIndex,
            });
          } catch (renameErr) {
            console.error("[processingEngine] Comfy output rename skipped:", renameErr);
          }
        }
      } else {
        console.info(
          `[processingEngine] Skipped ComfyUI for ${merged.outBaseName} (no trigger token in ${COMFY_TRIGGER_TOKENS.join(", ")}).`
        );
      }
    }

    return { ok: true, mergedFiles: mergedOutputs.map((p) => path.basename(p)) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Processing failed.";
    console.error("[processingEngine]", message);
    await setStatus("Selection Available");
    return { ok: false, error: message };
  }
}
