import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";

import { buildTimestampBracketsFromDir } from "@/lib/bracketGrouping.mjs";
import { PHOTOS_ROOT } from "@/lib/photosPaths";

const execAsync = promisify(exec);

const SNS_HDR_PATH = '"C:\\Program Files\\SNS-HDR Pro 2\\SNS-HDR.exe"';
const SNS_HDR_PRESET = "Hero_Interior";
const COMFY_TRIGGER_TOKENS = (process.env.COMFYUI_TRIGGER_TOKENS ?? "_sqi")
  .split(",")
  .map((token) => token.trim().toLowerCase())
  .filter(Boolean);
const COMFY_PROMPT_URL = "http://127.0.0.1:8188/prompt";

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
  comfyQueuedCount?: number;
  comfyFailedCount?: number;
  comfyErrors?: string[];
  error?: string;
};

type WorkflowNode = {
  inputs?: Record<string, unknown>;
  class_type?: string;
};

function isImageFile(fileName: string): boolean {
  return IMAGE_EXT.has(path.extname(fileName).toLowerCase());
}

function quoteArg(p: string): string {
  return `"${p.replace(/"/g, '\\"')}"`;
}

let exiftoolPathPromise: Promise<string> | null = null;

async function getExiftoolPath(): Promise<string> {
  if (!exiftoolPathPromise) {
    exiftoolPathPromise = import("exiftool-vendored").then(async (module) => {
      const resolved = module.exiftoolPath ?? module.default?.exiftoolPath;
      if (typeof resolved === "function") {
        return resolved();
      }
      if (typeof resolved === "string" && resolved.trim()) {
        return resolved;
      }
      throw new Error("exiftool-vendored did not expose exiftoolPath.");
    });
  }
  return exiftoolPathPromise;
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

function normalizeErrorMessage(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const msg = record.message;
    if (typeof msg === "string" && msg.trim()) {
      return msg;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function loadWorkflowTemplate(): Record<string, WorkflowNode> {
  const workflowPath = path.join(process.cwd(), "lib", "comfy", "workflow_api.json");
  const raw = fs.readFileSync(workflowPath, "utf8");
  return JSON.parse(raw) as Record<string, WorkflowNode>;
}

function validateMergedFilename(filename: string): string {
  const safe = path.basename(filename.trim());
  if (!safe || safe !== filename.trim() || !isImageFile(safe)) {
    throw new Error(`Invalid merged filename: ${filename}`);
  }
  return safe;
}

async function triggerComfyLocally(localFolderName: string, mergedFilename: string): Promise<{ promptId?: string }> {
  const safeFolder = localFolderName.trim();
  if (!safeFolder || safeFolder.includes("..") || /[<>:"|?*]/.test(safeFolder)) {
    throw new Error("Invalid local_folder_name.");
  }
  const safeFilename = validateMergedFilename(mergedFilename);
  const imagePath = path.resolve(PHOTOS_ROOT, safeFolder, "3_Merged", safeFilename);
  const rootResolved = path.resolve(PHOTOS_ROOT);
  if (!imagePath.toLowerCase().startsWith(rootResolved.toLowerCase() + path.sep)) {
    throw new Error("Access denied.");
  }
  console.info(`[processingEngine] Local Comfy source image: ${imagePath}`);
  if (!fs.existsSync(imagePath) || !fs.statSync(imagePath).isFile()) {
    throw new Error(`Merged image not found at local path: ${imagePath}`);
  }

  const comfyInputDir = process.env.COMFYUI_INPUT_DIR?.trim();
  if (!comfyInputDir) {
    throw new Error("COMFYUI_INPUT_DIR is not configured.");
  }
  const inputRoot = path.resolve(comfyInputDir);
  fs.mkdirSync(inputRoot, { recursive: true });
  const resizedFilename = `resized_${Date.now()}_${safeFilename}`.replace(/[^a-zA-Z0-9._-]/g, "_");
  const resizedPath = path.join(inputRoot, resizedFilename);
  await sharp(imagePath)
    .resize({ width: 2048, height: 2048, fit: "inside" })
    .toFile(resizedPath);

  const outputBaseName = path.basename(safeFilename, path.extname(safeFilename));
  const outputPrefix = path.join(PHOTOS_ROOT, safeFolder, "4_Final", `AI_${outputBaseName}`);
  const workflow = loadWorkflowTemplate();
  if (!workflow["1"]?.inputs || !workflow["9"]?.inputs || !workflow["11"]?.inputs) {
    throw new Error("Workflow template is missing required nodes.");
  }
  workflow["9"].inputs.seed = Math.floor(Math.random() * 1000000000000000);
  workflow["1"].inputs.image = resizedFilename;
  workflow["11"].inputs.filename_prefix = outputPrefix;

  const comfyRequestPayload = {
    prompt: workflow,
    client_id: randomUUID(),
  };
  const comfyResponse = await fetch(COMFY_PROMPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(comfyRequestPayload),
  });
  const comfyPayload = (await comfyResponse.json().catch(() => null)) as
    | {
        prompt_id?: string;
        error?: unknown;
        detail?: unknown;
        message?: unknown;
      }
    | null;
  if (!comfyResponse.ok) {
    throw new Error(
      normalizeErrorMessage(
        comfyPayload?.message ?? comfyPayload?.detail ?? comfyPayload?.error ?? comfyPayload,
        `ComfyUI error (${comfyResponse.status}).`
      )
    );
  }
  return { promptId: comfyPayload?.prompt_id };
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

async function enhanceMergedPhotoInPlace(filePath: string): Promise<void> {
  let originalBuffer: Buffer;
  try {
    originalBuffer = await fs.promises.readFile(filePath);
  } catch (error) {
    console.warn(
      `[processingEngine] Skipping merged enhancement for ${path.basename(filePath)}: could not read original file.`,
      error instanceof Error ? error.message : error
    );
    return;
  }

  try {
    const enhancedBuffer = await sharp(originalBuffer)
      .normalize()
      .gamma(1.8)
      .clahe({ width: 200, height: 200, maxSlope: 3 })
      .modulate({ brightness: 1.05, saturation: 1.05 })
      .jpeg({ quality: 92 })
      .toBuffer();
    await fs.promises.writeFile(filePath, enhancedBuffer);
    console.info(`[processingEngine] Sharp enhancement complete: ${path.basename(filePath)}`);
  } catch (error) {
    console.warn(
      `[processingEngine] Sharp enhancement failed for ${path.basename(filePath)}. Keeping original merged file.`,
      error instanceof Error ? error.message : error
    );
    try {
      await fs.promises.writeFile(filePath, originalBuffer);
    } catch (restoreError) {
      console.warn(
        `[processingEngine] Failed to restore original merged file ${path.basename(filePath)} after enhancement error.`,
        restoreError instanceof Error ? restoreError.message : restoreError
      );
    }
  }
}

export async function startProcessing(taskId: string, shootFolderPath: string): Promise<ProcessingSummary> {
  const supabase = createSupabase();
  const { taskRoot, localFolderName } = validateShootFolder(shootFolderPath);
  const selectsDir = path.join(taskRoot, "2_Selects");
  const mergedDir = path.join(taskRoot, "3_Merged");

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

    const brackets = await buildTimestampBracketsFromDir(selectsDir);
    if (brackets.length === 0) {
      throw new Error("No images found in 2_Selects.");
    }
    const mergedOutputs: string[] = [];
    const mergedMeta: Array<{ outBaseName: string; firstName: string; bracketIndex: number }> = [];
    let comfyQueuedCount = 0;
    let comfyFailedCount = 0;
    let bracketIndex = 1;
    const comfyErrors: string[] = [];
    const origin = resolveInternalAppOrigin();

    const totalBrackets = brackets.length;
    for (const group of brackets) {
      const inputs = group.map((name) => path.join(selectsDir, name));
      const firstName = group[0]!;
      const outBaseName = mergedOutputFileName(firstName, bracketIndex, totalBrackets);
      const outFile = path.join(mergedDir, outBaseName);

      const parts = [
        SNS_HDR_PATH,
        ...inputs.map(quoteArg),
        "-preset",
        quoteArg(SNS_HDR_PRESET),
        "-o",
        quoteArg(outFile),
      ];
      const cmd = parts.join(" ");
      await execAsync(cmd, { windowsHide: true });

      const exiftoolPath = await getExiftoolPath();
      const restoreExifCmd = [
        quoteArg(exiftoolPath),
        "-TagsFromFile",
        quoteArg(inputs[0]!),
        "-all:all",
        "-overwrite_original",
        quoteArg(outFile),
      ].join(" ");
      await execAsync(restoreExifCmd, { windowsHide: true });
      console.log("[processingEngine] Restored EXIF data from original bracket");

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
      await enhanceMergedPhotoInPlace(outFile);

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
        try {
          console.info(`[processingEngine] Triggering ComfyUI locally for ${merged.outBaseName}...`);
          const payload = await triggerComfyLocally(localFolderName, merged.outBaseName);
          comfyQueuedCount += 1;
          console.info(
            `[processingEngine] ComfyUI queued for ${merged.outBaseName}${payload.promptId ? ` (prompt ${payload.promptId})` : ""}.`
          );
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
        } catch (err) {
          comfyFailedCount += 1;
          console.error("RAW COMFY ERROR:", err);
          const errorText =
            err instanceof Error ? `${err.message}${err.stack ? `\n${err.stack}` : ""}` : String(err);
          const detail = `[processingEngine] ComfyUI API failed/not running for ${merged.outBaseName}: ${errorText}`;
          comfyErrors.push(detail);
          console.error(detail);
          console.error(
            `[processingEngine] Local Comfy trigger context for ${merged.outBaseName}: ${JSON.stringify({
              local_folder_name: localFolderName,
              filename: merged.outBaseName,
            })}`
          );
        }
      } else {
        console.info(
          `[processingEngine] Skipped ComfyUI for ${merged.outBaseName} (no trigger token in ${COMFY_TRIGGER_TOKENS.join(", ")}).`
        );
      }
    }

    return {
      ok: true,
      mergedFiles: mergedOutputs.map((p) => path.basename(p)),
      comfyQueuedCount,
      comfyFailedCount,
      comfyErrors,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Processing failed.";
    console.error("[processingEngine]", message);
    await setStatus("Selection Available");
    return { ok: false, error: message };
  }
}
