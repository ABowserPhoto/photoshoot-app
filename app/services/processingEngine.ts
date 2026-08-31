import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { exec } from "node:child_process";
import { spawn } from "node:child_process";
import { promisify } from "node:util";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PHOTOS_ROOT } from "@/lib/photosPaths";
import { fetchWithTimeout } from "@/lib/server/fetchWithTimeout";

const execAsync = promisify(exec);

const SNS_HDR_PATH = process.env.SNSHDR_PATH?.trim() || "C:\\Program Files\\SNS-HDR Pro 2\\SNS-HDR.exe";
const SNS_HDR_PRESET = process.env.SNSHDR_PRESET?.trim() || "Hero_Interior";
const SNS_HDR_PRESET_PATH = process.env.SNSHDR_PRESET_PATH?.trim() || "";
const RAW_THERAPEE_CLI_PATH = process.env.RAW_THERAPEE_CLI_PATH?.trim() || "";
const LENS_CORRECTION_PP3_PATH = path.join(process.cwd(), "lens-correction.pp3");
const EXIFTOOL_PATH =
  process.env.EXIFTOOL_PATH?.trim() || "C:\\Program Files\\SNS-HDR Pro 2\\ExifTool.exe";
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

const RAW_EXT = new Set([
  ".nef",
  ".arw",
  ".cr2",
  ".cr3",
  ".dng",
  ".raf",
  ".rw2",
  ".orf",
]);

export type ProcessingSummary = {
  ok: boolean;
  mergedFiles?: string[];
  comfyQueuedCount?: number;
  comfyFailedCount?: number;
  comfyErrors?: string[];
  error?: string;
};

export type SingleItemProcessingSummary = {
  ok: boolean;
  bracketIndex: number;
  totalBrackets: number;
  mergedFile?: string;
  expectedComfyJobs: number;
  comfyQueuedCount: number;
  comfyFailedCount: number;
  comfyErrors: string[];
  error?: string;
};

type WorkflowNode = {
  inputs?: Record<string, unknown>;
  class_type?: string;
};

function isImageFile(fileName: string): boolean {
  return IMAGE_EXT.has(path.extname(fileName).toLowerCase());
}

function isRawFile(fileName: string): boolean {
  return RAW_EXT.has(path.extname(fileName).toLowerCase());
}

function bracketUsesRawFiles(fileNames: string[]): boolean {
  return fileNames.length > 0 && fileNames.every((name) => isRawFile(name));
}

async function linkOrCopyFile(src: string, dest: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) {
    return;
  }
  try {
    await fs.promises.link(src, dest);
  } catch {
    await fs.promises.copyFile(src, dest);
  }
}

async function removeBracketWorkDir(workDir: string | null): Promise<void> {
  if (!workDir) {
    return;
  }
  try {
    await fs.promises.rm(workDir, { recursive: true, force: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[processingEngine] Failed to remove bracket work dir ${workDir}:`, message);
  }
}

function resolveStraightenedTiffForRaw(
  tempStraightenedDir: string,
  rawFileName: string
): string {
  const stem = path.basename(rawFileName, path.extname(rawFileName));
  const candidates = [
    path.join(tempStraightenedDir, `${stem}.tif`),
    path.join(tempStraightenedDir, `${stem}.tiff`),
    path.join(tempStraightenedDir, `${stem}.TIF`),
    path.join(tempStraightenedDir, `${stem}.TIFF`),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(`RawTherapee output missing for ${rawFileName} in ${tempStraightenedDir}`);
  }
  return found;
}

/**
 * Lens-correct RAW bracket files via RawTherapee CLI into `{bracketDir}/temp_straightened`.
 * Returns SNS-HDR input paths (16-bit TIFFs) and a work directory to delete after merge.
 */
async function prepareStraightenedBracketInputs(params: {
  bracketFileNames: string[];
  selectsDir: string;
  bracketIndex: number;
  localFolderName: string;
}): Promise<{ snsInputs: string[]; workDir: string | null }> {
  const { bracketFileNames, selectsDir, bracketIndex, localFolderName } = params;
  const defaultInputs = bracketFileNames.map((name) => path.join(selectsDir, name));

  if (!bracketUsesRawFiles(bracketFileNames)) {
    return { snsInputs: defaultInputs, workDir: null };
  }

  const rawTherapeeCli = RAW_THERAPEE_CLI_PATH;
  if (!rawTherapeeCli) {
    console.info(
      "[processingEngine] RAW_THERAPEE_CLI_PATH not set; skipping lens correction for bracket",
      bracketIndex
    );
    return { snsInputs: defaultInputs, workDir: null };
  }
  if (!fs.existsSync(rawTherapeeCli)) {
    throw new Error(`RawTherapee CLI not found at ${rawTherapeeCli}`);
  }
  if (!fs.existsSync(LENS_CORRECTION_PP3_PATH)) {
    throw new Error(`Lens correction profile not found at ${LENS_CORRECTION_PP3_PATH}`);
  }

  const bracketDir = path.join(selectsDir, `_bracket_${bracketIndex}`);
  const tempStraightenedDir = path.join(bracketDir, "temp_straightened");
  await fs.promises.rm(bracketDir, { recursive: true, force: true }).catch(() => null);
  await fs.promises.mkdir(tempStraightenedDir, { recursive: true });

  for (const fileName of bracketFileNames) {
    const src = path.join(selectsDir, fileName);
    const dest = path.join(bracketDir, fileName);
    await linkOrCopyFile(src, dest);
  }

  try {
    const rtArgs = [
      "-o",
      tempStraightenedDir,
      "-p",
      LENS_CORRECTION_PP3_PATH,
      "-t",
      "-Y",
      "-c",
      bracketDir,
    ];
    const constructedCommandString = `${quoteArg(rawTherapeeCli)} ${rtArgs.map(quoteArg).join(" ")}`;
    console.log(`[processingEngine] EXECUTING RawTherapee: ${constructedCommandString}`);
    await runCommandWithDiagnostics(rawTherapeeCli, rtArgs, {
      stage: "rawtherapee",
      localFolderName,
      bracketIndex,
      bracketDir,
      tempStraightenedDir,
      commandPreview: constructedCommandString,
    });

    const snsInputs = bracketFileNames.map((fileName) =>
      resolveStraightenedTiffForRaw(tempStraightenedDir, fileName)
    );
    return { snsInputs, workDir: bracketDir };
  } catch (error) {
    await removeBracketWorkDir(bracketDir);
    throw error;
  }
}

function quoteArg(p: string): string {
  return `"${p.replace(/"/g, '\\"')}"`;
}

function resolveSnsPresetArg(): string {
  const fromExplicitPath = SNS_HDR_PRESET_PATH.trim();
  if (fromExplicitPath) {
    return path.isAbsolute(fromExplicitPath)
      ? fromExplicitPath
      : path.resolve(process.cwd(), fromExplicitPath);
  }

  const presetValue = SNS_HDR_PRESET.trim();
  const looksLikePresetFile = /\.(xrs|prs)$/i.test(presetValue);
  if (!looksLikePresetFile) {
    return presetValue;
  }
  return path.isAbsolute(presetValue) ? presetValue : path.resolve(process.cwd(), presetValue);
}

type CommandRunResult = {
  stdout: string;
  stderr: string;
};

async function runCommandWithDiagnostics(
  command: string,
  args: string[],
  context: Record<string, unknown>
): Promise<CommandRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      console.error("[processingEngine] merge command process error", {
        ...context,
        command,
        args,
        error: error.message,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
      reject(
        new Error(
          `Merge process failed to start: ${error.message}${
            stderr.trim() ? ` | stderr=${stderr.trim()}` : ""
          }`
        )
      );
    });

    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      console.error("[processingEngine] merge command non-zero exit", {
        ...context,
        command,
        args,
        exitCode: code,
        signal,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
      reject(
        new Error(
          `Merge command failed (exit=${code ?? "null"}${signal ? `, signal=${signal}` : ""})${
            stderr.trim() ? ` | stderr=${stderr.trim()}` : ""
          }`
        )
      );
    });
  });
}

function createSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) {
    return null;
  }
  // Prefer service_role so local processing continues under tasks RLS.
  return createClient(url, key, { auth: { persistSession: false } });
}

function resolveInternalAppOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_BASE_URL?.trim().replace(/\/$/, "") ??
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") ??
    "http://127.0.0.1:3000"
  );
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

function isEditingLikeStatus(status: string | null | undefined): boolean {
  const normalized = String(status ?? "")
    .trim()
    .toLowerCase();
  return normalized === "editing" || normalized === "processing";
}

function truncateProcessingError(message: string, maxLen = 2000): string {
  const text = message.trim() || "Processing failed.";
  if (text.length <= maxLen) {
    return text;
  }
  return `${text.slice(0, maxLen - 1)}…`;
}

type TaskTimerRow = {
  status?: string | null;
  editing_started_at?: string | null;
  total_editing_seconds?: number | null;
};

function buildEditingTimerStopPayload(currentTask: TaskTimerRow | null | undefined) {
  const startedAt =
    typeof currentTask?.editing_started_at === "string" && currentTask.editing_started_at.trim()
      ? currentTask.editing_started_at.trim()
      : null;
  const startedAtMs = startedAt ? Date.parse(startedAt) : Number.NaN;
  const elapsed = Number.isFinite(startedAtMs)
    ? Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000))
    : 0;
  const prevTotal = Number(currentTask?.total_editing_seconds ?? 0);
  return {
    editing_started_at: null as null,
    total_editing_seconds: prevTotal + elapsed,
    elapsedSeconds: elapsed,
  };
}

type SharpConstructor = typeof import("sharp");

let sharpModulePromise: Promise<SharpConstructor> | null = null;

async function getSharp(): Promise<SharpConstructor> {
  if (!sharpModulePromise) {
    sharpModulePromise = import("sharp")
      .then((mod) => mod.default)
      .catch((error) => {
        sharpModulePromise = null;
        throw error;
      });
  }
  return sharpModulePromise;
}

async function loadTimestampBracketsFromDir(
  dirPath: string
): Promise<{ ok: true; brackets: string[][] } | { ok: false; brackets: string[][]; error: string }> {
  try {
    const { buildTimestampBracketsFromDir } = await import("@/lib/bracketGrouping.mjs");
    const brackets = await buildTimestampBracketsFromDir(dirPath);
    return { ok: true, brackets: Array.isArray(brackets) ? brackets : [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[processingEngine] Failed to group brackets:", message);
    return { ok: false, brackets: [], error: message };
  }
}

function failedSingleItemSummary(
  bracketIndex: number,
  totalBrackets: number,
  error: string
): SingleItemProcessingSummary {
  return {
    ok: false,
    bracketIndex,
    totalBrackets,
    expectedComfyJobs: 0,
    comfyQueuedCount: 0,
    comfyFailedCount: 0,
    comfyErrors: [],
    error,
  };
}

function loadWorkflowTemplate(): Record<string, WorkflowNode> {
  const workflowPath = path.join(process.cwd(), "lib", "comfy", "workflow_api.json");
  if (!fs.existsSync(workflowPath)) {
    throw new Error(`Comfy workflow template not found at ${workflowPath}`);
  }
  const raw = fs.readFileSync(workflowPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Comfy workflow template is invalid.");
  }
  return parsed as Record<string, WorkflowNode>;
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
  const sharp = await getSharp();
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
  const comfyResponse = await fetchWithTimeout(
    COMFY_PROMPT_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(comfyRequestPayload),
    },
    15_000
  );
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

function validateShootFolder(
  shootFolderPath: string
): { ok: true; taskRoot: string; localFolderName: string } | { ok: false; error: string } {
  const trimmed = shootFolderPath.trim();
  if (!trimmed) {
    return { ok: false, error: "shootFolderPath is required." };
  }
  const taskRoot = path.resolve(trimmed);
  const rootResolved = path.resolve(PHOTOS_ROOT);
  const rel = path.relative(rootResolved, taskRoot);
  if (rel.startsWith("..") || path.isAbsolute(rel) || !rel) {
    return { ok: false, error: "shootFolderPath must be a folder under PHOTOS_ROOT." };
  }
  return { ok: true, taskRoot, localFolderName: rel };
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
  // Pure passthrough: preserve SNS-HDR output exactly as generated by the CLI.
  // No Sharp-based color, contrast, or white-balance changes are applied.
  void filePath;
}

export async function startProcessingSingleItem(
  taskId: string,
  shootFolderPath: string,
  bracketIndex: number
): Promise<SingleItemProcessingSummary> {
  try {
    void taskId;
    const folderValidation = validateShootFolder(shootFolderPath);
    if (!folderValidation.ok) {
      return failedSingleItemSummary(bracketIndex, 0, folderValidation.error);
    }
    const { taskRoot, localFolderName } = folderValidation;
    const selectsDir = path.join(taskRoot, "2_Selects");
    const mergedDir = path.join(taskRoot, "3_Merged");

    if (!fs.existsSync(selectsDir)) {
      return failedSingleItemSummary(bracketIndex, 0, `Selects folder missing: ${selectsDir}`);
    }

    fs.mkdirSync(mergedDir, { recursive: true });
    const bracketResult = await loadTimestampBracketsFromDir(selectsDir);
    if (!bracketResult.ok) {
      return failedSingleItemSummary(
        bracketIndex,
        0,
        `Failed to group selected photos: ${bracketResult.error}`
      );
    }
    const brackets = bracketResult.brackets;
    const totalBrackets = brackets.length;
    if (totalBrackets === 0) {
      return failedSingleItemSummary(bracketIndex, totalBrackets, "No images found in 2_Selects.");
    }
    if (!Number.isInteger(bracketIndex) || bracketIndex < 0 || bracketIndex >= totalBrackets) {
      return failedSingleItemSummary(
        bracketIndex,
        totalBrackets,
        `Invalid bracket index ${bracketIndex}. Valid range is 0..${Math.max(0, totalBrackets - 1)}.`
      );
    }

    const group = brackets[bracketIndex] ?? [];
    const currentBracketIndex = bracketIndex + 1;
    const firstName = group[0];
    if (!firstName) {
      return failedSingleItemSummary(bracketIndex, totalBrackets, `Bracket ${currentBracketIndex} is empty.`);
    }

    const snsPreset = resolveSnsPresetArg();
    const originalInputs = group.map((name) => path.join(selectsDir, name));
    const outBaseName = mergedOutputFileName(firstName, currentBracketIndex, totalBrackets);
    const outFile = path.join(mergedDir, outBaseName);

    // ── Resume guard ─────────────────────────────────────────────────────────
    // If this bracket was already merged (e.g. worker was interrupted mid-run),
    // skip the expensive RawTherapee → SNS-HDR pipeline and return success.
    // We report 0 new Comfy jobs so the caller doesn't double-queue them.
    if (fs.existsSync(outFile)) {
      console.info(
        `[processingEngine] Bracket ${currentBracketIndex}/${totalBrackets} already merged: ${outBaseName}. Skipping merge pipeline.`
      );
      return {
        ok: true,
        bracketIndex,
        totalBrackets,
        mergedFile: outBaseName,
        expectedComfyJobs: 0,
        comfyQueuedCount: 0,
        comfyFailedCount: 0,
        comfyErrors: [],
      };
    }
    // ── End resume guard ─────────────────────────────────────────────────────

    const tempOutFile = path.join(
      mergedDir,
      `${path.basename(outBaseName, path.extname(outBaseName))}.__tmp_${Date.now()}_${Math.random()
        .toString(16)
        .slice(2)}${path.extname(outBaseName) || ".jpg"}`
    );

    let bracketWorkDir: string | null = null;
    let snsInputs = originalInputs;
    try {
      const prepared = await prepareStraightenedBracketInputs({
        bracketFileNames: group,
        selectsDir,
        bracketIndex: currentBracketIndex,
        localFolderName,
      });
      bracketWorkDir = prepared.workDir;
      snsInputs = prepared.snsInputs;

      const snsArgs = ["-preset", snsPreset, "-srgb", "-o", tempOutFile, ...snsInputs];
      const constructedCommandString = `${quoteArg(SNS_HDR_PATH)} ${snsArgs.map(quoteArg).join(" ")}`;
      console.log(`EXECUTING: ${constructedCommandString}`);

      try {
        await runCommandWithDiagnostics(SNS_HDR_PATH, snsArgs, {
          localFolderName,
          bracketIndex: currentBracketIndex,
          outFile,
          tempOutFile,
          inputs: snsInputs,
          snsPreset,
          commandPreview: constructedCommandString,
        });
        if (fs.existsSync(outFile)) {
          await fs.promises.unlink(outFile);
        }
        await fs.promises.rename(tempOutFile, outFile);
      } catch (error) {
        const mergeError = error instanceof Error ? error.message : String(error);
        return failedSingleItemSummary(
          bracketIndex,
          totalBrackets,
          `snsHDR failed on bracket ${currentBracketIndex}: ${mergeError}`
        );
      }
    } finally {
      await removeBracketWorkDir(bracketWorkDir);
    }

    try {
      const restoreExifCmd = [
        quoteArg(EXIFTOOL_PATH),
        "-TagsFromFile",
        quoteArg(originalInputs[0]!),
        "-all:all",
        "-overwrite_original",
        quoteArg(outFile),
      ].join(" ");
      await execAsync(restoreExifCmd, { windowsHide: true });
    } catch (exifError) {
      const message = exifError instanceof Error ? exifError.message : String(exifError);
      const maybeErrno = (exifError as { code?: string } | null)?.code;
      if (!(maybeErrno === "ENOENT" || /not\s+found/i.test(message))) {
        console.warn(
          `[processingEngine] EXIF restore failed for ${outBaseName}; continuing without EXIF metadata.`,
          message
        );
      }
    }

    await enhanceMergedPhotoInPlace(outFile);

    if (!fs.existsSync(outFile)) {
      return failedSingleItemSummary(
        bracketIndex,
        totalBrackets,
        `Merged output missing after pipeline for bracket ${currentBracketIndex}: ${outBaseName}`
      );
    }

    const comfyErrors: string[] = [];
    const runComfy = shouldRunComfyForFilename(outBaseName);
    const expectedComfyJobs = runComfy ? 1 : 0;
    let comfyQueuedCount = 0;
    let comfyFailedCount = 0;

    if (runComfy) {
      try {
        const payload = await triggerComfyLocally(localFolderName, outBaseName);
        comfyQueuedCount += 1;
        console.info(
          `[processingEngine] ComfyUI queued for ${outBaseName}${payload.promptId ? ` (prompt ${payload.promptId})` : ""}.`
        );
        const baseName = baseNameForCleanup(firstName);
        try {
          await cleanupComfyFinalFilename({
            localFolderName,
            mergedFilename: outBaseName,
            baseName,
            bracketIndex: currentBracketIndex,
          });
        } catch (renameErr) {
          console.error("[processingEngine] Comfy output rename skipped:", renameErr);
        }
      } catch (err) {
        comfyFailedCount += 1;
        const errorText =
          err instanceof Error ? `${err.message}${err.stack ? `\n${err.stack}` : ""}` : String(err);
        const detail = `[processingEngine] ComfyUI API failed/not running for ${outBaseName}: ${errorText}`;
        comfyErrors.push(detail);
        console.error(detail);
      }
    }

    return {
      ok: true,
      bracketIndex,
      totalBrackets,
      mergedFile: outBaseName,
      expectedComfyJobs,
      comfyQueuedCount,
      comfyFailedCount,
      comfyErrors,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[processingEngine] startProcessingSingleItem failed:", message, error);
    return failedSingleItemSummary(bracketIndex, 0, message);
  }
}

export async function startProcessing(taskId: string, shootFolderPath: string): Promise<ProcessingSummary> {
  const supabase = createSupabase();
  const folderValidation = validateShootFolder(shootFolderPath);
  if (!folderValidation.ok) {
    return { ok: false, error: folderValidation.error };
  }
  const { taskRoot, localFolderName } = folderValidation;
  const selectsDir = path.join(taskRoot, "2_Selects");
  const mergedDir = path.join(taskRoot, "3_Merged");

  const setStatus = async (
    status: string,
    extras?: { processing_error?: string | null }
  ) => {
    if (!supabase) {
      console.warn(`[processingEngine] Supabase not configured; skip status "${status}" for task ${taskId}.`);
      return;
    }

    const { data: currentTask, error: readError } = await supabase
      .from("tasks")
      .select("status, editing_started_at, total_editing_seconds")
      .eq("id", taskId)
      .maybeSingle();
    if (readError) {
      console.error(`[processingEngine] Failed to read task ${taskId} before status update:`, readError.message);
    }

    const payload: Record<string, unknown> = { status, ...(extras ?? {}) };
    const currentStatus = typeof currentTask?.status === "string" ? currentTask.status : "";
    const timerRunning =
      typeof currentTask?.editing_started_at === "string" &&
      currentTask.editing_started_at.trim().length > 0;

    if (isEditingLikeStatus(status) && !isEditingLikeStatus(currentStatus)) {
      payload.editing_started_at =
        (timerRunning ? currentTask?.editing_started_at : null) || new Date().toISOString();
      if (payload.total_editing_seconds == null) {
        payload.total_editing_seconds = Number(currentTask?.total_editing_seconds ?? 0);
      }
      if (payload.processing_error === undefined) {
        payload.processing_error = null;
      }
    } else if (!isEditingLikeStatus(status) && (isEditingLikeStatus(currentStatus) || timerRunning)) {
      const stop = buildEditingTimerStopPayload(currentTask);
      payload.editing_started_at = stop.editing_started_at;
      payload.total_editing_seconds = stop.total_editing_seconds;
      console.info(
        `[processingEngine] Accumulating editing timer for task ${taskId}: elapsed=${stop.elapsedSeconds}s, new total=${stop.total_editing_seconds}s.`
      );
    }

    const { error } = await supabase.from("tasks").update(payload).eq("id", taskId);
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

    const bracketResult = await loadTimestampBracketsFromDir(selectsDir);
    if (!bracketResult.ok) {
      throw new Error(`Failed to group selected photos: ${bracketResult.error}`);
    }
    const brackets = bracketResult.brackets;
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
    const snsPreset = resolveSnsPresetArg();
    console.info("[processingEngine] snsHDR diagnostics", {
      snsHdrPath: SNS_HDR_PATH,
      snsHdrExists: fs.existsSync(SNS_HDR_PATH),
      snsHdrPreset: snsPreset,
      snsHdrPresetExists: /\.(xrs|prs)$/i.test(snsPreset) ? fs.existsSync(snsPreset) : "n/a",
      localFolderName,
    });

    const totalBrackets = brackets.length;
    for (const group of brackets) {
      const currentBracketIndex = bracketIndex;
      const originalInputs = group.map((name) => path.join(selectsDir, name));
      const firstName = group[0]!;
      const outBaseName = mergedOutputFileName(firstName, currentBracketIndex, totalBrackets);
      const outFile = path.join(mergedDir, outBaseName);
      const tempOutFile = path.join(
        mergedDir,
        `${path.basename(outBaseName, path.extname(outBaseName))}.__tmp_${Date.now()}_${Math.random()
          .toString(16)
          .slice(2)}${path.extname(outBaseName) || ".jpg"}`
      );

      let bracketWorkDir: string | null = null;
      try {
        const prepared = await prepareStraightenedBracketInputs({
          bracketFileNames: group,
          selectsDir,
          bracketIndex: currentBracketIndex,
          localFolderName,
        });
        bracketWorkDir = prepared.workDir;
        const snsInputs = prepared.snsInputs;

        const snsArgs = ["-preset", snsPreset, "-srgb", "-o", tempOutFile, ...snsInputs];
        const constructedCommandString = `${quoteArg(SNS_HDR_PATH)} ${snsArgs.map(quoteArg).join(" ")}`;
        console.log(`EXECUTING: ${constructedCommandString}`);
        try {
          await runCommandWithDiagnostics(SNS_HDR_PATH, snsArgs, {
            localFolderName,
            bracketIndex: currentBracketIndex,
            outFile,
            tempOutFile,
            inputs: snsInputs,
            snsPreset,
            commandPreview: constructedCommandString,
          });
        } catch (error) {
          const mergeError = error instanceof Error ? error.message : String(error);
          throw new Error(`snsHDR failed on bracket ${currentBracketIndex}: ${mergeError}`);
        }
        if (fs.existsSync(outFile)) {
          await fs.promises.unlink(outFile);
        }
        await fs.promises.rename(tempOutFile, outFile);

        try {
          const restoreExifCmd = [
            quoteArg(EXIFTOOL_PATH),
            "-TagsFromFile",
            quoteArg(originalInputs[0]!),
            "-all:all",
            "-overwrite_original",
            quoteArg(outFile),
          ].join(" ");
          await execAsync(restoreExifCmd, { windowsHide: true });
          console.log("[processingEngine] Restored EXIF data from original bracket");
        } catch (exifError) {
          const message = exifError instanceof Error ? exifError.message : String(exifError);
          const maybeErrno = (exifError as { code?: string } | null)?.code;
          if (maybeErrno === "ENOENT" || /not\s+found/i.test(message)) {
            console.warn("ExifTool not found, skipping metadata injection");
          } else {
            console.warn(
              `[processingEngine] EXIF restore failed for ${outBaseName}; continuing without EXIF metadata.`,
              message
            );
          }
        }

        mergedOutputs.push(outFile);
        mergedMeta.push({ outBaseName, firstName, bracketIndex });
        // Keep SNS-HDR output untouched to avoid channel remapping/color shifts.
        await enhanceMergedPhotoInPlace(outFile);

        const removalTarget = extractRemovalTargetFromFilename(outBaseName);
        if (removalTarget) {
          try {
            const removeRes = await fetchWithTimeout(
              `${origin}/api/ai-remove`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  imagePath: outFile,
                  removalTarget,
                }),
              },
              15_000
            );
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
          } catch (error) {
            console.error(
              `[processingEngine] /api/ai-remove request failed for ${outBaseName}:`,
              error instanceof Error ? error.message : error
            );
          }
        }
      } finally {
        await removeBracketWorkDir(bracketWorkDir);
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

    const missingMerged = mergedOutputs.filter((p) => !fs.existsSync(p));
    if (missingMerged.length > 0 || mergedOutputs.length !== brackets.length) {
      throw new Error(
        `Merged outputs missing after pipeline: expected ${brackets.length}, present ${
          mergedOutputs.length - missingMerged.length
        }. Missing: ${missingMerged.map((p) => path.basename(p)).join(", ") || "unknown"}`
      );
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
    await setStatus("Selection Failed", {
      processing_error: truncateProcessingError(message),
    });
    return { ok: false, error: message };
  }
}
