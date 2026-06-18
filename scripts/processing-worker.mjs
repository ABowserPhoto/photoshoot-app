import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import chokidar from "chokidar";
import sharp from "sharp";

import { buildWatermarkedPreviewFile, assertReadableWatermark } from "../app/api/gallery/previewMagick.mjs";
import { fetchWithTimeout, toFetchErrorMessage } from "../lib/server/fetchWithTimeout.mjs";

import { buildLocalFolderNameFromTask } from "./localFolderName.mjs";
import { buildTimestampBracketsFromDir } from "../lib/bracketGrouping.mjs";
import { sanitizeStoragePath } from "../lib/sanitizeStoragePath.mjs";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const execFileAsync = promisify(execFile);

const FOLDER_POLL_INTERVAL_MS = 15 * 1000;
const PROCESSING_POLL_INTERVAL_MS = 5 * 60 * 1000;
const PREVIEW_FALLBACK_SYNC_INTERVAL_MS = 4 * 60 * 1000;
const LOCAL_PROCESS_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const SELECTS_DEBOUNCE_MS = readPositiveIntEnv("SELECTS_DEBOUNCE_MS", 8000);
const SELECTS_STABILITY_WAIT_MS = readPositiveIntEnv("SELECTS_STABILITY_WAIT_MS", 2500);
const SELECTS_STABILITY_MAX_PASSES = readPositiveIntEnv("SELECTS_STABILITY_MAX_PASSES", 8);

const AWAITING_FOLDER_STATUS = "awaiting_folder_creation";
const BOOKING_STATUS = "Booking";
const SELECTION_AVAILABLE_STATUS = "Selection Available";
const SELECTION_FAILED_STATUS = "Selection Failed";
const SELECTION_SYNCING_STATUS = "syncing_selection";
const SELECTION_SYNC_VALIDATION_ERROR_PATTERNS = [
  /no selected_chunk_indices in gallery_selection/i,
  /no selected raw files were copied to 2_selects/i,
];

const CLAIM_STATUS = "pending_processing";
const ACTIVE_STATUS = "Processing";
const READY_FOR_REVIEW_STATUS = "Ready for Review";
const PREVIEW_DEBOUNCE_MS = 1500;
const RAW_PREVIEW_EXTENSIONS = new Set([".nef", ".cr2", ".cr3", ".arw", ".dng", ".raf", ".rw2", ".orf"]);
const SELECTS_TRIGGER_EXTENSIONS = new Set([".nef", ".dng"]);
/** Capture One proxy/sidecar noise — never arm debounce for these. */
const CHOKIDAR_IGNORED_PATTERNS = [
  /(^|[\\/])\../,
  /\.cop$/i,
  /\.cof$/i,
  /\.psd$/i,
  /\.dng\.cop$/i,
];
const RAW_PREVIEW_TAGS = ["PreviewImage", "JpgFromRaw", "OtherImage", "ThumbnailImage"];

const DEFAULT_PHOTOS_ROOT = "D:\\Photos_2026";

/**
 * Root for shoot folders.
 * We allow env configuration, but enforce that the effective root remains under D:\Photos_2026.
 * COMFYUI_INPUT_DIR can live on another drive (e.g. F:) and must not affect shoot root resolution.
 */
function getShootFoldersRoot() {
  const fromBaseDir = process.env.BASE_DIR?.trim();
  const configuredRoot = fromBaseDir || DEFAULT_PHOTOS_ROOT;

  const defaultResolved = path.resolve(DEFAULT_PHOTOS_ROOT);
  const configuredResolved = path.resolve(configuredRoot);
  const rel = path.relative(defaultResolved, configuredResolved);
  const isWithinDefaultRoot = rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));

  if (!isWithinDefaultRoot) {
    console.warn(
      `[worker] Ignoring BASE_DIR="${configuredRoot}" because local task folders must stay under ${DEFAULT_PHOTOS_ROOT}.`
    );
    return DEFAULT_PHOTOS_ROOT;
  }

  return configuredResolved;
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function readPositiveIntEnv(name, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const LOCAL_PROCESS_TIMEOUT_MS_EFFECTIVE = readPositiveIntEnv(
  "LOCAL_PROCESS_TIMEOUT_MS",
  LOCAL_PROCESS_TIMEOUT_MS
);
const PRIORITY_POLL_INTERVAL_MS = readPositiveIntEnv("WORKER_PRIORITY_POLL_INTERVAL_MS", 10 * 1000);
const RETRY_ATTEMPTS = readPositiveIntEnv("WORKER_RETRY_ATTEMPTS", 3);
const RETRY_BASE_MS = readPositiveIntEnv("WORKER_RETRY_BASE_MS", 500);
const PREVIEW_RETRY_ATTEMPTS = readPositiveIntEnv("PREVIEW_RETRY_ATTEMPTS", 3);
const PREVIEW_RETRY_BASE_MS = readPositiveIntEnv("PREVIEW_RETRY_BASE_MS", 500);
const COVER_THUMB_WIDTH = readPositiveIntEnv("COVER_THUMB_WIDTH", 600);
const WATERMARK_PATH = path.join(process.cwd(), "public", "watermark.png");
const SUPABASE_PREVIEWS_BUCKET = process.env.SUPABASE_PREVIEWS_BUCKET?.trim() || "previews";
const SUPABASE_FINALS_BUCKET = process.env.SUPABASE_FINALS_BUCKET?.trim() || "finals";
const COMFY_OUTPUT_DIR =
  process.env.COMFYUI_OUTPUT_DIR?.trim() ||
  "F:\\ComfyUI_windows_portable_nvidia\\ComfyUI_windows_portable\\ComfyUI\\output";
const COMFY_WAIT_TIMEOUT_MS = readPositiveIntEnv("COMFY_WAIT_TIMEOUT_MS", 90 * 60 * 1000);

const previewSyncTimers = new Map();
const previewSyncInFlight = new Set();
const previewSyncPending = new Set();
const selectsProcessTimers = new Map();
let rawWatcherStarted = false;
let selectsWatcherStarted = false;
let exiftoolPathPromise = null;
let lastSelectsTriggerAtMs = null;
let processingPipelineInFlight = false;
let activeMergeTaskId = null;
let activeMergeLocalFolder = null;
let activeMergePhase = null;

function setActiveMergeContext(taskId, localFolderName, phase) {
  activeMergeTaskId = taskId;
  activeMergeLocalFolder = localFolderName;
  activeMergePhase = phase;
}

function clearActiveMergeContext() {
  activeMergeTaskId = null;
  activeMergeLocalFolder = null;
  activeMergePhase = null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRawPreviewFile(filePath) {
  return RAW_PREVIEW_EXTENSIONS.has(path.extname(String(filePath || "")).toLowerCase());
}

async function getExiftoolPath() {
  if (!exiftoolPathPromise) {
    exiftoolPathPromise = import("exiftool-vendored").then((module) => {
      const directExport = module?.exiftoolPath;
      const defaultExport = module?.default?.exiftoolPath;
      const exportValue = directExport ?? defaultExport;
      if (typeof exportValue === "function") {
        return exportValue();
      }
      if (typeof exportValue === "string" && exportValue.trim()) {
        return exportValue;
      }
      throw new Error(
        "exiftool-vendored did not expose exiftoolPath (expected a function or non-empty string)."
      );
    });
  }
  return exiftoolPathPromise;
}

async function extractEmbeddedRawPreviewBuffer(sourcePath) {
  const exiftoolPath = await getExiftoolPath();
  let lastError = null;
  for (const tag of RAW_PREVIEW_TAGS) {
    try {
      const { stdout } = await execFileAsync(exiftoolPath, ["-b", `-${tag}`, sourcePath], {
        windowsHide: true,
        encoding: "buffer",
        maxBuffer: 64 * 1024 * 1024,
      });
      const previewBuffer = Buffer.isBuffer(stdout) ? stdout : Buffer.from(String(stdout ?? ""), "binary");
      if (previewBuffer.length > 0) {
        return previewBuffer;
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `No embedded RAW preview found (${RAW_PREVIEW_TAGS.join(", ")}).${
      lastError instanceof Error ? ` Last error: ${lastError.message}` : ""
    }`
  );
}

async function resolvePreviewSourcePath(sourcePath, contextLabel) {
  const cleanupPaths = [];
  if (!isRawPreviewFile(sourcePath)) {
    return { inputPath: sourcePath, cleanupPaths };
  }

  try {
    const extractedPreview = await extractEmbeddedRawPreviewBuffer(sourcePath);
    const tempRawPreview = path.join(
      os.tmpdir(),
      `raw-preview-${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`
    );
    await fs.promises.writeFile(tempRawPreview, extractedPreview);
    cleanupPaths.push(tempRawPreview);
    console.info(
      `[worker] Extracted embedded RAW preview for ${path.basename(sourcePath)} (${contextLabel}) via exiftool-vendored.`
    );
    return { inputPath: tempRawPreview, cleanupPaths };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[worker] RAW preview extraction failed for ${path.basename(sourcePath)} (${contextLabel}); skipping file.`,
      message
    );
    throw new Error(message);
  }
}

async function getPreviewSharpInput(sourcePath, contextLabel) {
  if (!isRawPreviewFile(sourcePath)) {
    return sourcePath;
  }
  try {
    const extractedPreview = await extractEmbeddedRawPreviewBuffer(sourcePath);
    console.info(
      `[worker] Extracted embedded RAW preview for ${path.basename(sourcePath)} (${contextLabel}) via exiftool-vendored.`
    );
    return extractedPreview;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[worker] RAW preview extraction failed for ${path.basename(sourcePath)} (${contextLabel}); skipping file.`,
      message
    );
    throw new Error(message);
  }
}

async function logExiftoolStartupStatus() {
  try {
    const exiftoolPath = await getExiftoolPath();
    console.info(`[worker] exiftool-vendored path resolved: ${exiftoolPath}`);
  } catch (error) {
    console.warn(
      "[worker] exiftool-vendored path check failed at startup. RAW preview extraction may be skipped.",
      error instanceof Error ? error.message : error
    );
  }
}

async function withRetry(label, fn, attempts = RETRY_ATTEMPTS) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        const waitMs = RETRY_BASE_MS * 2 ** (attempt - 1);
        console.warn(`[worker] ${label} failed (attempt ${attempt}/${attempts}). Retrying in ${waitMs}ms.`);
        await sleep(waitMs);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${label} failed after ${attempts} attempts.`);
}

async function withPreviewRetry(label, fn, attempts = PREVIEW_RETRY_ATTEMPTS) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        const waitMs = PREVIEW_RETRY_BASE_MS * 2 ** (attempt - 1);
        console.warn(`[worker] ${label} failed (attempt ${attempt}/${attempts}). Retrying in ${waitMs}ms.`);
        await sleep(waitMs);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${label} failed after ${attempts} attempts.`);
}

function getSupabaseClient() {
  const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!key) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY (preferred) or NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

async function claimTask(supabase, taskId) {
  return claimTaskForStatus(supabase, taskId, CLAIM_STATUS, ACTIVE_STATUS);
}

function isSelectionSyncValidationError(err) {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return SELECTION_SYNC_VALIDATION_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

async function resolveSelectionSyncFailure(supabase, taskId, err) {
  const validationError = isSelectionSyncValidationError(err);
  const nextStatus = validationError ? SELECTION_FAILED_STATUS : SELECTION_AVAILABLE_STATUS;
  const actionLabel = validationError ? "mark Selection Failed" : "restore Selection Available";

  await withRetry(`${actionLabel} for task ${taskId}`, async () => {
    const { error: updateError } = await supabase
      .from("tasks")
      .update({ status: nextStatus })
      .eq("id", taskId);
    if (updateError) {
      throw new Error(updateError.message);
    }
  });

  console.warn(
    `[worker] Task ${taskId} set to ${nextStatus} after selection sync failure (${validationError ? "validation" : "transient"}).`
  );
}

async function claimTaskForStatus(supabase, taskId, fromStatus, toStatus) {
  const { data, error } = await withRetry(
    `claim task ${taskId} (${fromStatus} -> ${toStatus})`,
    async () =>
      supabase
        .from("tasks")
        .update({ status: toStatus })
        .eq("id", taskId)
        .eq("status", fromStatus)
        .select("id")
        .limit(1)
  );

  if (error) {
    throw new Error(`Failed to claim task ${taskId}: ${error.message}`);
  }
  return (data ?? []).length > 0;
}

function isImageFile(fileName) {
  return [
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
    ".arw",
    ".cr2",
    ".cr3",
    ".dng",
    ".raf",
    ".rw2",
    ".orf",
  ].includes(path.extname(fileName).toLowerCase());
}

function isPreviewSourceFile(fileName) {
  const normalized = String(fileName || "").toLowerCase();
  if (!normalized || normalized === ".ds_store" || normalized === "thumbs.db") {
    return false;
  }
  return isImageFile(normalized);
}

function isWatcherIgnoredPath(filePath) {
  const normalized = String(filePath || "").replace(/\\/g, "/");
  return CHOKIDAR_IGNORED_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isSelectsWatcherTriggerFile(filePath) {
  if (!filePath || isWatcherIgnoredPath(filePath)) {
    return false;
  }
  const ext = path.extname(filePath).toLowerCase();
  return SELECTS_TRIGGER_EXTENSIONS.has(ext);
}

function isRawWatcherTriggerFile(filePath) {
  if (!filePath || isWatcherIgnoredPath(filePath)) {
    return false;
  }
  const ext = path.extname(filePath).toLowerCase();
  return RAW_PREVIEW_EXTENSIONS.has(ext);
}

function createShootFolderWatcherOptions() {
  return {
    ignoreInitial: false,
    awaitWriteFinish: {
      stabilityThreshold: 2500,
      pollInterval: 100,
    },
    usePolling: true,
    ignored: (watchedPath) => isWatcherIgnoredPath(watchedPath),
  };
}

function normalizePreviewPreference(value) {
  if (value === "middle" || value === "last") {
    return value;
  }
  return "first";
}

function resolvePreviewSourceFilename(bracket, preference) {
  if (!Array.isArray(bracket) || bracket.length === 0) {
    return null;
  }
  const fileNames = bracket.filter((entry) => typeof entry === "string");
  if (fileNames.length === 0) {
    return null;
  }

  let preferredIndex = 0;
  if (preference === "middle") {
    preferredIndex = Math.floor(fileNames.length / 2);
  } else if (preference === "last") {
    preferredIndex = fileNames.length - 1;
  }

  // Bounds guard to prevent crashes if bracket content is unexpected.
  if (preferredIndex < 0 || preferredIndex >= fileNames.length) {
    preferredIndex = 0;
  }

  const preferredFile = fileNames[preferredIndex];
  if (preferredFile && isPreviewSourceFile(preferredFile)) {
    return preferredFile;
  }

  return fileNames.find((name) => isPreviewSourceFile(name)) ?? null;
}

function safePreviewStem(localFolderName, firstFilename, chunkIndex) {
  const stem = `${localFolderName}_${chunkIndex}_${path.basename(firstFilename, path.extname(firstFilename))}`;
  return stem.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function buildPreviewStoragePath(localFolderName, firstFilename, chunkIndex) {
  return sanitizeStoragePath(
    `${localFolderName}/${safePreviewStem(localFolderName, firstFilename, chunkIndex)}.jpg`
  );
}

function getPreviewPublicUrl(supabase, storagePath) {
  const { data } = supabase.storage.from(SUPABASE_PREVIEWS_BUCKET).getPublicUrl(storagePath);
  return data?.publicUrl ?? "";
}

async function previewObjectExistsInStorage(supabase, storagePath) {
  const lastSlash = storagePath.lastIndexOf("/");
  const folder = lastSlash >= 0 ? storagePath.slice(0, lastSlash) : "";
  const fileName = lastSlash >= 0 ? storagePath.slice(lastSlash + 1) : storagePath;
  const { data, error } = await supabase.storage.from(SUPABASE_PREVIEWS_BUCKET).list(folder, {
    limit: 1000,
  });
  if (error) {
    return false;
  }
  return (data ?? []).some((entry) => entry.name === fileName);
}

function readNaturallySortedImageFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isImageFile(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

function parseSelectionPayload(raw) {
  const payload = raw && typeof raw === "object" ? raw : {};
  const selectedChunkIndices = Array.from(
    new Set(
      (Array.isArray(payload.selected_chunk_indices) ? payload.selected_chunk_indices : [])
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value >= 0)
    )
  ).sort((a, b) => a - b);
  return { selectedChunkIndices };
}

function parsePreviewItems(raw) {
  const items = Array.isArray(raw?.items) ? raw.items : [];
  return items
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const chunkIndex = Number(item.chunkIndex);
      const firstFilename =
        typeof item.firstFilename === "string"
          ? item.firstFilename
          : typeof item.middleFilename === "string"
            ? item.middleFilename
            : "";
      const previewUrl = typeof item.previewUrl === "string" ? item.previewUrl : "";
      const storagePath = typeof item.storagePath === "string" ? item.storagePath : "";
      if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || !firstFilename || !previewUrl || !storagePath) {
        return null;
      }
      return { chunkIndex, firstFilename, previewUrl, storagePath };
    })
    .filter(Boolean);
}

function galleryPreviewsNeedsDbSync(raw) {
  if (raw == null) {
    return true;
  }
  return parsePreviewItems(raw).length === 0;
}

/**
 * Clean Kanban cover: resize only, then same ImageMagick exposure pass as watermarked previews (no watermark).
 */
async function buildCoverThumbnailBuffer(sourcePath) {
  const sourceInput = await getPreviewSharpInput(sourcePath, "cover-thumbnail");
  const resizedBuffer = await sharp(sourceInput)
    .resize({ width: COVER_THUMB_WIDTH, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true, chromaSubsampling: "4:2:0" })
    .toBuffer();

  const tmpBase = path.join(os.tmpdir(), `cover-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const tempInput = `${tmpBase}-in.jpg`;
  const tempOutput = `${tmpBase}-out.jpg`;
  try {
    await fs.promises.writeFile(tempInput, resizedBuffer);
    await execFileAsync(
      "magick",
      [
        tempInput,
        "-auto-level",
        "-modulate",
        "102,112,100",
        "-contrast-stretch",
        "0.3%x0.3%",
        tempOutput,
      ],
      { windowsHide: true }
    );
    return await fs.promises.readFile(tempOutput);
  } finally {
    await fs.promises.unlink(tempInput).catch(() => {});
    await fs.promises.unlink(tempOutput).catch(() => {});
  }
}

async function buildPreviewBuffer(sourcePath) {
  await assertReadableWatermark(WATERMARK_PATH);

  const { inputPath, cleanupPaths } = await resolvePreviewSourcePath(sourcePath, "gallery-preview");
  const tempOutput = path.join(
    os.tmpdir(),
    `gallery-preview-${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`
  );
  cleanupPaths.push(tempOutput);

  try {
    await buildWatermarkedPreviewFile({
      sourceFilePath: inputPath,
      watermarkPath: WATERMARK_PATH,
      previewOutputPath: tempOutput,
    });
    return await fs.promises.readFile(tempOutput);
  } finally {
    await Promise.all(cleanupPaths.map((filePath) => fs.promises.unlink(filePath).catch(() => {})));
  }
}

async function uploadPreviewBuffer(supabase, params) {
  const storagePath = buildPreviewStoragePath(
    params.localFolderName,
    params.firstFilename,
    params.chunkIndex
  );
  await withPreviewRetry(`upload preview ${storagePath}`, async () => {
    const { error } = await supabase.storage.from(SUPABASE_PREVIEWS_BUCKET).upload(storagePath, params.buffer, {
      upsert: true,
      contentType: "image/jpeg",
      cacheControl: "3600",
    });
    if (error) {
      throw new Error(error.message);
    }
  });
  return { storagePath, previewUrl: getPreviewPublicUrl(supabase, storagePath) };
}

async function persistGalleryPreviews(supabase, taskId, chunks, nextItems) {
  await withPreviewRetry(`persist gallery_previews for task ${taskId}`, async () => {
    const { error } = await supabase
      .from("tasks")
      .update({
        gallery_previews: {
          updated_at: new Date().toISOString(),
          bracket_size: chunks[0]?.length ?? null,
          items: nextItems,
        },
      })
      .eq("id", taskId);
    if (error) {
      throw new Error(error.message);
    }
  });
  console.info(
    `[worker] Persisted gallery_previews for task ${taskId}: ${nextItems.length} item(s).`
  );
}

async function ensureCoverImageOnce(supabase, taskRow, rawDir, chunks) {
  const existing = taskRow.cover_image_url;
  if (existing != null && String(existing).trim()) {
    return;
  }
  if (!chunks.length) {
    return;
  }

  const previewPreference = normalizePreviewPreference(taskRow.preview_preference);
  const taskId = String(taskRow.id);

  for (const chunk of chunks) {
    const firstFilename = resolvePreviewSourceFilename(chunk, previewPreference);
    if (!firstFilename) {
      continue;
    }
    const sourcePath = path.join(rawDir, firstFilename);
    if (!fs.existsSync(sourcePath)) {
      continue;
    }

    try {
      const buffer = await withPreviewRetry(`cover thumbnail ${taskId}`, async () =>
        buildCoverThumbnailBuffer(sourcePath)
      );
      const storagePath = sanitizeStoragePath(`cover_${taskId}.jpg`);
      await withPreviewRetry(`upload cover ${storagePath}`, async () => {
        const { error } = await supabase.storage.from(SUPABASE_PREVIEWS_BUCKET).upload(storagePath, buffer, {
          upsert: true,
          contentType: "image/jpeg",
          cacheControl: "3600",
        });
        if (error) {
          throw new Error(error.message);
        }
      });
      const publicUrl = getPreviewPublicUrl(supabase, storagePath);
      if (!publicUrl) {
        throw new Error(`Missing public URL for cover ${storagePath}`);
      }

      await withPreviewRetry(`set cover_image_url for task ${taskId}`, async () => {
        const { error } = await supabase.from("tasks").update({ cover_image_url: publicUrl }).eq("id", taskId);
        if (error) {
          throw new Error(error.message);
        }
      });
      console.info(`[worker] Cover image set for task ${taskId} from ${firstFilename}`);
      return;
    } catch (err) {
      console.warn(
        `[worker] Cover candidate skipped for task ${taskId} (${firstFilename}):`,
        err instanceof Error ? err.message : err
      );
    }
  }

  console.warn(`[worker] Could not set cover image for task ${taskId}: no usable source file in 1_Raw.`);
}

async function syncTaskPreviews(supabase, taskRow) {
  const localFolderName = String(taskRow.local_folder_name ?? "").trim();
  if (!localFolderName) {
    return;
  }

  const base = path.join(getShootFoldersRoot(), localFolderName);
  const rawDir = path.join(base, "1_Raw");
  if (!fs.existsSync(rawDir)) {
    return;
  }

  const chunks = await buildTimestampBracketsFromDir(rawDir);
  const previewPreference = normalizePreviewPreference(taskRow.preview_preference);
  const forceGalleryPreviewDbSync = galleryPreviewsNeedsDbSync(taskRow.gallery_previews);
  const { selectedChunkIndices } = parseSelectionPayload(taskRow.gallery_selection);
  const selectedChunkSet = new Set(selectedChunkIndices);
  const nextItems = [];
  let processedCount = 0;
  let skippedCount = 0;
  let selectedSkippedCount = 0;
  let failedCount = 0;
  let reusedFromStorageCount = 0;

  await ensureCoverImageOnce(supabase, taskRow, rawDir, chunks).catch((err) => {
    console.warn(
      `[worker] Cover image skipped for task ${taskRow.id}:`,
      err instanceof Error ? err.message : err
    );
  });

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    if (selectedChunkSet.has(chunkIndex)) {
      // Keep historical selection in gallery_selection, but never regenerate selected previews.
      selectedSkippedCount += 1;
      continue;
    }

    const chunk = chunks[chunkIndex];
    const firstFilename = resolvePreviewSourceFilename(chunk, previewPreference);
    if (!firstFilename) {
      console.warn(
        `[worker] Skipping chunk ${chunkIndex}: no valid source file for preview_preference="${previewPreference}".`
      );
      skippedCount += 1;
      continue;
    }

    const storagePath = buildPreviewStoragePath(localFolderName, firstFilename, chunkIndex);

    try {
      if (!forceGalleryPreviewDbSync) {
        const existingItems = parsePreviewItems(taskRow.gallery_previews);
        const existing = existingItems.find((item) => item.chunkIndex === chunkIndex);
        if (
          existing &&
          existing.firstFilename === firstFilename &&
          existing.storagePath === storagePath &&
          existing.previewUrl
        ) {
          const previewUrl = getPreviewPublicUrl(supabase, storagePath) || existing.previewUrl;
          nextItems.push({
            chunkIndex,
            firstFilename,
            previewUrl,
            storagePath,
          });
          processedCount += 1;
          continue;
        }
      }

      const previewAlreadyInStorage = await previewObjectExistsInStorage(supabase, storagePath);
      if (previewAlreadyInStorage) {
        const previewUrl = getPreviewPublicUrl(supabase, storagePath);
        if (previewUrl) {
          nextItems.push({
            chunkIndex,
            firstFilename,
            previewUrl,
            storagePath,
          });
          processedCount += 1;
          reusedFromStorageCount += 1;
          continue;
        }
      }

      const sourcePath = path.join(rawDir, firstFilename);
      const previewBuffer = await withPreviewRetry(`render preview ${localFolderName}/${firstFilename}`, async () =>
        buildPreviewBuffer(sourcePath)
      );
      const uploaded = await uploadPreviewBuffer(supabase, {
        localFolderName,
        chunkIndex,
        firstFilename,
        buffer: previewBuffer,
      });
      if (!uploaded.previewUrl) {
        throw new Error(`Missing public URL for uploaded preview ${uploaded.storagePath}`);
      }
      nextItems.push({
        chunkIndex,
        firstFilename,
        previewUrl: uploaded.previewUrl,
        storagePath: uploaded.storagePath,
      });
      processedCount += 1;
    } catch (error) {
      failedCount += 1;
      console.warn(
        "[worker] Skipping file due to error:",
        firstFilename,
        error instanceof Error ? error.message : error
      );
    }
  }

  nextItems.sort((a, b) => a.chunkIndex - b.chunkIndex);

  const rawImageCount = readNaturallySortedImageFiles(rawDir).length;
  if (nextItems.length === 0 && rawImageCount > 0 && chunks.length === 0) {
    console.warn(
      `[worker] Skipping gallery_previews persist for task ${taskRow.id}: ${rawImageCount} image(s) in 1_Raw but bracket grouping returned 0 chunks.`
    );
    return;
  }

  await persistGalleryPreviews(supabase, taskRow.id, chunks, nextItems);
  console.info(
    `[worker] Folder [${localFolderName}] complete. Processed: ${processedCount} | Skipped: ${skippedCount} | SelectedSkipped: ${selectedSkippedCount} | Failed: ${failedCount} | ReusedFromStorage: ${reusedFromStorageCount} | DbItems: ${nextItems.length}`
  );
}

async function syncPreviewsForLocalFolder(localFolderName) {
  if (previewSyncInFlight.has(localFolderName)) {
    previewSyncPending.add(localFolderName);
    return;
  }

  previewSyncInFlight.add(localFolderName);
  try {
    do {
      previewSyncPending.delete(localFolderName);

      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("tasks")
        .select("id, local_folder_name, gallery_selection, gallery_previews, cover_image_url, preview_preference")
        .eq("local_folder_name", localFolderName)
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        console.error(`[worker] Failed to find task for folder ${localFolderName}:`, error.message);
        return;
      }
      if (!data) {
        return;
      }
      await syncTaskPreviews(supabase, data);
    } while (previewSyncPending.has(localFolderName));
  } finally {
    previewSyncInFlight.delete(localFolderName);
  }
}

async function processInitialPreviewSync(supabase) {
  console.info("[worker] Starting initial full preview sync...");
  let offset = 0;
  const pageSize = 200;
  const folderNames = new Set();
  let skipped = 0;

  while (true) {
    const { data, error } = await supabase
      .from("tasks")
      .select("local_folder_name")
      .not("local_folder_name", "is", null)
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) {
      throw new Error(`Initial preview sync query failed: ${error.message}`);
    }
    const rows = data ?? [];
    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      const localFolderName = String(row.local_folder_name ?? "").trim();
      if (!localFolderName) {
        skipped += 1;
        continue;
      }
      const rawDir = path.join(getShootFoldersRoot(), localFolderName, "1_Raw");
      if (!fs.existsSync(rawDir)) {
        skipped += 1;
        continue;
      }
      folderNames.add(localFolderName);
    }

    offset += rows.length;
    if (rows.length < pageSize) {
      break;
    }
  }

  let processed = 0;
  let failed = 0;
  for (const localFolderName of folderNames) {
    try {
      await syncPreviewsForLocalFolder(localFolderName);
      processed += 1;
    } catch (error) {
      failed += 1;
      console.error(
        `[worker] Initial preview sync failed for folder ${localFolderName}:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  console.info(
    `[worker] Initial full preview sync finished. folders=${folderNames.size}, processed=${processed}, skipped=${skipped}, failed=${failed}`
  );
}

function localFolderNameFromRawPath(filePath) {
  const root = getShootFoldersRoot();
  const absolute = path.resolve(filePath);
  const relativeToRoot = path.relative(root, absolute);
  if (!relativeToRoot || relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    return null;
  }
  const segments = relativeToRoot.split(path.sep).filter(Boolean);
  const rawIndex = segments.indexOf("1_Raw");
  if (rawIndex < 1) {
    return null;
  }
  const taskSegments = segments.slice(0, rawIndex);
  if (taskSegments.length === 0) {
    return null;
  }
  return taskSegments.join(path.sep);
}

function localFolderNameFromSelectsPath(filePath) {
  const root = getShootFoldersRoot();
  const absolute = path.resolve(filePath);
  const relativeToRoot = path.relative(root, absolute);
  if (!relativeToRoot || relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    return null;
  }
  const segments = relativeToRoot.split(path.sep).filter(Boolean);
  const selectsIndex = segments.indexOf("2_Selects");
  if (selectsIndex < 1) {
    return null;
  }
  const taskSegments = segments.slice(0, selectsIndex);
  if (taskSegments.length === 0) {
    return null;
  }
  return taskSegments.join(path.sep);
}

function getSelectsFolderSnapshot(selectsDir) {
  if (!fs.existsSync(selectsDir)) {
    return "missing";
  }
  try {
    const entries = fs.readdirSync(selectsDir, { withFileTypes: true });
    const snapshot = entries
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const fullPath = path.join(selectsDir, entry.name);
        try {
          const stat = fs.statSync(fullPath);
          return `${entry.name}:${stat.size}:${Math.floor(stat.mtimeMs)}`;
        } catch {
          return `${entry.name}:stat-error`;
        }
      })
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
    return snapshot.join("|");
  } catch (error) {
    return `snapshot-error:${error instanceof Error ? error.message : String(error)}`;
  }
}

async function waitForSelectsFolderToStabilize(localFolderName) {
  const selectsDir = path.join(getShootFoldersRoot(), localFolderName, "2_Selects");
  let previous = "";
  for (let pass = 1; pass <= SELECTS_STABILITY_MAX_PASSES; pass += 1) {
    const current = getSelectsFolderSnapshot(selectsDir);
    if (pass > 1 && current === previous) {
      console.info(
        `[worker] Selects folder stabilized for ${localFolderName} after ${pass} pass(es).`
      );
      return;
    }
    previous = current;
    console.log(
      `[worker] Selects stabilization pass ${pass}/${SELECTS_STABILITY_MAX_PASSES} for ${localFolderName}`
    );
    await sleep(SELECTS_STABILITY_WAIT_MS);
  }
  console.warn(
    `[worker] Selects folder did not stabilize within max passes for ${localFolderName}; proceeding anyway.`
  );
}

function schedulePreviewSync(localFolderName) {
  const existing = previewSyncTimers.get(localFolderName);
  if (existing) {
    clearTimeout(existing);
  }
  const timer = setTimeout(() => {
    previewSyncTimers.delete(localFolderName);
    void syncPreviewsForLocalFolder(localFolderName).catch((err) => {
      console.error(
        `[worker] Preview sync failed for ${localFolderName}:`,
        err instanceof Error ? err.message : err
      );
    });
  }, PREVIEW_DEBOUNCE_MS);
  previewSyncTimers.set(localFolderName, timer);
}

function getMergePriorityAt(task) {
  const selection = task?.gallery_selection;
  if (!selection || typeof selection !== "object") {
    return 0;
  }
  const raw = selection.merge_priority_at;
  if (typeof raw !== "string" || !raw.trim()) {
    return 0;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortTasksByMergePriority(tasks) {
  return [...tasks].sort((left, right) => {
    const priorityDelta = getMergePriorityAt(right) - getMergePriorityAt(left);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }
    return String(left.id).localeCompare(String(right.id));
  });
}

function isMergePipelineBusy() {
  return processingPipelineInFlight;
}

async function runProcessingPipeline(supabase, { reason = "poll" } = {}) {
  if (processingPipelineInFlight) {
    console.info(
      `[worker] Skipping processing pipeline (${reason}): active merge in progress for task ${activeMergeTaskId ?? "unknown"} (${activeMergeLocalFolder ?? "unknown folder"}, phase=${activeMergePhase ?? "unknown"}).`
    );
    return false;
  }

  processingPipelineInFlight = true;
  try {
    await processSelectionAvailable(supabase);
    await processPendingProcessing(supabase);
    return true;
  } catch (error) {
    console.error(
      `[worker] Processing pipeline failed (${reason}):`,
      error instanceof Error ? error.message : error
    );
    return false;
  } finally {
    processingPipelineInFlight = false;
    clearActiveMergeContext();
  }
}

async function hasPriorityMergeQueued(supabase) {
  const { data, error } = await supabase
    .from("tasks")
    .select("id, gallery_selection")
    .in("status", [SELECTION_AVAILABLE_STATUS, CLAIM_STATUS, SELECTION_SYNCING_STATUS, ACTIVE_STATUS])
    .limit(50);

  if (error) {
    console.warn(`[worker] Priority merge probe failed: ${error.message}`);
    return false;
  }

  const cutoffMs = Date.now() - 4 * 60 * 60 * 1000;
  return (data ?? []).some((task) => getMergePriorityAt(task) >= cutoffMs);
}

function scheduleSelectsProcessing(localFolderName, filePath, eventName) {
  if (processingPipelineInFlight && activeMergeLocalFolder === localFolderName) {
    console.info(
      `[worker] Ignoring selects watcher event during active merge for ${localFolderName} (task ${activeMergeTaskId ?? "unknown"}).`
    );
    return;
  }

  if ((eventName === "add" || eventName === "change" || eventName === "unlink") && !isSelectsWatcherTriggerFile(filePath)) {
    return;
  }

  if (eventName === "add" || eventName === "change") {
    console.log("New file detected:", filePath);
  }
  console.log(
    `[worker] Selects watcher event="${eventName}" folder="${localFolderName}" path="${filePath}"`
  );
  const existing = selectsProcessTimers.get(localFolderName);
  if (existing) {
    clearTimeout(existing);
  }
  const timer = setTimeout(() => {
    selectsProcessTimers.delete(localFolderName);
    lastSelectsTriggerAtMs = Date.now();
    void (async () => {
      try {
        if (processingPipelineInFlight) {
          console.info(
            `[worker] Selects debounce elapsed for ${localFolderName}, but merge pipeline is busy; deferring.`
          );
          return;
        }
        console.info(
          `[worker] Selects debounce elapsed for ${localFolderName}. Waiting for stable copy completion before processing.`
        );
        await waitForSelectsFolderToStabilize(localFolderName);
        await runProcessingPipeline(getSupabaseClient(), { reason: `selects-watcher:${localFolderName}` });
      } catch (error) {
        console.error(
          `[worker] Immediate selects-triggered processing failed for ${localFolderName}:`,
          error instanceof Error ? error.message : error
        );
      }
    })();
  }, SELECTS_DEBOUNCE_MS);
  selectsProcessTimers.set(localFolderName, timer);
}

function startWorkerHeartbeat() {
  setInterval(() => {
    const queueSize = selectsProcessTimers.size;
    const lastTrigger = lastSelectsTriggerAtMs
      ? new Date(lastSelectsTriggerAtMs).toISOString()
      : "never";
    const activeMerge = processingPipelineInFlight
      ? `task=${activeMergeTaskId ?? "unknown"} folder=${activeMergeLocalFolder ?? "unknown"} phase=${activeMergePhase ?? "unknown"}`
      : "idle";
    console.info(
      `[Heartbeat] Watcher armed | Debounce queue: ${queueSize} | Last trigger: ${lastTrigger} | Merge pipeline: ${activeMerge}`
    );
  }, 60 * 1000);
}

function startRawFolderWatcher() {
  if (rawWatcherStarted) {
    return;
  }
  rawWatcherStarted = true;

  const root = getShootFoldersRoot();
  const watcher = chokidar.watch(root, {
    ...createShootFolderWatcherOptions(),
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 100,
    },
  });

  watcher.on("all", (eventName, filePath) => {
    if (!["add", "change", "unlink", "addDir"].includes(eventName)) {
      return;
    }
    if ((eventName === "add" || eventName === "change" || eventName === "unlink") && !isRawWatcherTriggerFile(filePath)) {
      return;
    }
    const localFolderName = localFolderNameFromRawPath(filePath);
    if (!localFolderName) {
      return;
    }
    schedulePreviewSync(localFolderName);
  });

  watcher.on("error", (error) => {
    console.error("[worker] chokidar watcher error:", error);
  });

  console.info(
    `[worker] Watching shoot root for RAW changes: ${root} (polling enabled, awaitWriteFinish=2000/100)`
  );
}

function startSelectsFolderWatcher() {
  if (selectsWatcherStarted) {
    return;
  }
  selectsWatcherStarted = true;

  const root = getShootFoldersRoot();
  const watcher = chokidar.watch(root, createShootFolderWatcherOptions());

  watcher.on("all", (eventName, filePath) => {
    if (!["add", "change", "unlink", "addDir", "unlinkDir"].includes(eventName)) {
      return;
    }
    if ((eventName === "add" || eventName === "change" || eventName === "unlink") && !isSelectsWatcherTriggerFile(filePath)) {
      return;
    }
    const localFolderName = localFolderNameFromSelectsPath(filePath);
    if (!localFolderName) {
      return;
    }
    scheduleSelectsProcessing(localFolderName, filePath, eventName);
  });

  watcher.on("error", (error) => {
    console.error("[worker] selects chokidar watcher error:", error);
  });

  console.info(
    `[worker] Watching shoot root for Selects changes: ${root} (polling enabled, awaitWriteFinish=2500/100, debounce=${SELECTS_DEBOUNCE_MS}ms)`
  );
}

async function syncSelectedRawFilesToSelects(localFolderName, gallerySelection) {
  const { selectedChunkIndices } = parseSelectionPayload(gallerySelection);
  if (selectedChunkIndices.length === 0) {
    throw new Error("No selected_chunk_indices in gallery_selection.");
  }

  const base = path.join(getShootFoldersRoot(), localFolderName);
  const rawDir = path.join(base, "1_Raw");
  const selectsDir = path.join(base, "2_Selects");
  fs.mkdirSync(selectsDir, { recursive: true });

  const chunks = await buildTimestampBracketsFromDir(rawDir);
  const copiedFiles = [];

  for (const chunkIndex of selectedChunkIndices) {
    const chunk = chunks[chunkIndex];
    if (!chunk) {
      console.warn(`[worker] Selection chunk ${chunkIndex} not found for folder ${localFolderName}.`);
      continue;
    }
    for (const fileName of chunk) {
      const sourcePath = path.join(rawDir, fileName);
      const targetPath = path.join(selectsDir, fileName);
      if (!fs.existsSync(sourcePath)) {
        console.warn(`[worker] Selected source file missing: ${sourcePath}`);
        continue;
      }
      if (!fs.existsSync(targetPath)) {
        fs.copyFileSync(sourcePath, targetPath);
      }
      copiedFiles.push(fileName);
    }
  }

  if (copiedFiles.length === 0) {
    throw new Error("No selected RAW files were copied to 2_Selects.");
  }
  return { copiedFiles, selectedChunkIndices };
}

async function processTaskLocally(task) {
  const localOrigin = process.env.LOCAL_APP_ORIGIN?.trim() || "http://127.0.0.1:3000";
  const workerSecret = requiredEnv("LOCAL_WORKER_SECRET");
  const url = `${localOrigin.replace(/\/$/, "")}/api/worker/process-single-item`;
  console.info(
    `[worker] Calling local process-single-item endpoint: ${url} (timeout ${LOCAL_PROCESS_TIMEOUT_MS_EFFECTIVE}ms)`
  );
  const taskRoot = path.join(getShootFoldersRoot(), String(task.local_folder_name ?? "").trim());
  const selectsDir = path.join(taskRoot, "2_Selects");
  const brackets = await buildTimestampBracketsFromDir(selectsDir);
  const totalItems = brackets.length;
  const processingStartedAtMs = Date.now();

  if (totalItems === 0) {
    throw new Error(`No bracket groups found for task ${task.id} in ${selectsDir}.`);
  }

  let processedItems = 0;
  let failedItems = 0;
  let comfyQueuedCount = 0;
  let comfyFailedCount = 0;
  const comfyErrors = [];
  let expectedComfyJobs = 0;

  for (let photoIndex = 0; photoIndex < totalItems; photoIndex += 1) {
    console.log(`[Worker] Task ${task.id}: Merging photo ${photoIndex + 1} of ${totalItems}...`);
    try {
      const response = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-worker-secret": workerSecret,
          },
          body: JSON.stringify({
            taskId: String(task.id),
            local_folder_name: task.local_folder_name,
            bracketIndex: photoIndex,
          }),
        },
        LOCAL_PROCESS_TIMEOUT_MS_EFFECTIVE
      );
      const responseText = await response.text();
      let payload = null;
      try {
        payload = responseText ? JSON.parse(responseText) : null;
      } catch {
        payload = null;
      }
      if (!response.ok || !payload?.success) {
        const message =
          payload?.error ||
          (responseText.trim() && !responseText.trim().startsWith("<")
            ? responseText.trim().slice(0, 500)
            : null) ||
          `Local single-item processing failed for task ${task.id} bracket ${photoIndex} (HTTP ${response.status}).`;
        throw new Error(message);
      }

      processedItems += 1;
      comfyQueuedCount += Number(payload?.comfyQueuedCount) || 0;
      comfyFailedCount += Number(payload?.comfyFailedCount) || 0;
      expectedComfyJobs += Number(payload?.expectedComfyJobs) || 0;
      if (Array.isArray(payload?.comfyErrors)) {
        for (const errorLine of payload.comfyErrors) {
          comfyErrors.push(String(errorLine));
        }
      }
    } catch (err) {
      failedItems += 1;
      const message = toFetchErrorMessage(
        err,
        `[worker] process-single-item request failed for task ${task.id} bracket ${photoIndex}`
      );
      console.error(message, err);
      // Continue with next bracket/photo set even when this one fails.
      continue;
    }
  }

  return {
    totalItems,
    processedItems,
    failedItems,
    processingStartedAtMs,
    expectedComfyJobs,
    comfyQueuedCount,
    comfyFailedCount,
    comfyErrors,
  };
}

async function finalizeTask(supabase, taskId, status) {
  const { error } = await supabase.from("tasks").update({ status }).eq("id", taskId);
  if (error) {
    throw new Error(`Failed to set status ${status} for task ${taskId}: ${error.message}`);
  }
}

async function uploadFileToBucket(supabase, bucket, storagePath, filePath) {
  const buffer = await fs.promises.readFile(filePath);
  const { error } = await supabase.storage.from(bucket).upload(storagePath, buffer, {
    upsert: true,
    contentType: "image/jpeg",
    cacheControl: "3600",
  });
  if (error) {
    throw new Error(error.message);
  }
}

async function waitForComfyOutputs(taskRoot, expectedSqiCount, startedAtMs, timeoutMs = COMFY_WAIT_TIMEOUT_MS) {
  if (expectedSqiCount <= 0) {
    return { copied: 0, timedOut: false };
  }
  const finalDir = path.join(taskRoot, "4_Final");
  fs.mkdirSync(finalDir, { recursive: true });
  const comfyOutputDir = path.resolve(COMFY_OUTPUT_DIR);
  if (!fs.existsSync(comfyOutputDir)) {
    console.warn(`[worker] ComfyUI output dir not found: ${comfyOutputDir}. Skipping wait.`);
    return { copied: 0, timedOut: true };
  }

  const copiedSourcePaths = new Set();
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const entries = await fs.promises.readdir(comfyOutputDir, { withFileTypes: true }).catch(() => []);
    const candidates = [];
    for (const entry of entries) {
      if (!entry.isFile() || !isImageFile(entry.name)) {
        continue;
      }
      const sourcePath = path.join(comfyOutputDir, entry.name);
      const stat = await fs.promises.stat(sourcePath).catch(() => null);
      if (!stat || stat.mtimeMs + 1000 < startedAtMs) {
        continue;
      }
      candidates.push({ sourcePath, name: entry.name, mtimeMs: stat.mtimeMs });
    }
    candidates.sort((a, b) => a.mtimeMs - b.mtimeMs);

    for (const candidate of candidates) {
      if (copiedSourcePaths.has(candidate.sourcePath)) {
        continue;
      }
      const parsed = path.parse(candidate.name);
      const targetName = `AI_${parsed.name}${parsed.ext || ".jpg"}`;
      let targetPath = path.join(finalDir, targetName);
      let suffix = 1;
      while (fs.existsSync(targetPath)) {
        targetPath = path.join(finalDir, `${path.parse(targetName).name}_${suffix}${path.extname(targetName)}`);
        suffix += 1;
      }
      try {
        await fs.promises.copyFile(candidate.sourcePath, targetPath);
        copiedSourcePaths.add(candidate.sourcePath);
        console.info(`[worker] Copied Comfy output: ${candidate.sourcePath} -> ${targetPath}`);
      } catch (err) {
        console.error("RAW COMFY ERROR:", err);
        console.error(
          `[worker] Failed to copy Comfy output: ${candidate.sourcePath} -> ${targetPath}`,
          err instanceof Error ? err.message : err
        );
      }
    }

    if (copiedSourcePaths.size >= expectedSqiCount) {
      return { copied: copiedSourcePaths.size, timedOut: false };
    }
    await sleep(1500);
  }

  console.warn(
    `[worker] ComfyUI wait timed out. expected=${expectedSqiCount}, copied=${copiedSourcePaths.size}, output_dir=${comfyOutputDir}`
  );
  return { copied: copiedSourcePaths.size, timedOut: true };
}

async function uploadMergedAndFinalsForReview(supabase, localFolderName) {
  const taskRoot = path.join(getShootFoldersRoot(), localFolderName);
  const mergedDir = path.join(taskRoot, "3_Merged");
  const finalDir = path.join(taskRoot, "4_Final");
  const imageMatcher = /\.(jpe?g|png|tiff?|webp|bmp|gif)$/i;

  console.info(`[worker] Finals upload scan: mergedDir=${mergedDir}, finalDir=${finalDir}`);
  const mergedFiles = readNaturallySortedImageFiles(mergedDir);
  let mergedUploaded = 0;
  for (const fileName of mergedFiles) {
    const localPath = path.join(mergedDir, fileName);
    const storagePath = sanitizeStoragePath(`${localFolderName}/3_Merged/${fileName}`);
    await withRetry(`upload merged ${storagePath}`, async () =>
      uploadFileToBucket(supabase, SUPABASE_FINALS_BUCKET, storagePath, localPath)
    );
    mergedUploaded += 1;
  }

  const finalEntries = fs.existsSync(finalDir) ? await fs.promises.readdir(finalDir, { withFileTypes: true }) : [];
  const finalFiles = finalEntries
    .filter((entry) => entry.isFile() && imageMatcher.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  let finalUploaded = 0;
  for (const fileName of finalFiles) {
    const localPath = path.join(finalDir, fileName);
    const storagePath = sanitizeStoragePath(`${localFolderName}/4_Final/${fileName}`);
    await withRetry(`upload final ${storagePath}`, async () =>
      uploadFileToBucket(supabase, SUPABASE_FINALS_BUCKET, storagePath, localPath)
    );
    finalUploaded += 1;
  }
  console.info(
    `[worker] Finals upload complete for ${localFolderName}: merged_uploaded=${mergedUploaded}/${mergedFiles.length}, final_uploaded=${finalUploaded}/${finalFiles.length}, bucket=${SUPABASE_FINALS_BUCKET}`
  );
}

/**
 * Creates `1_Raw` … `4_Final` under D:\Photos_2026 (effective root), then sets status to Booking.
 */
async function processAwaitingFolderCreation(supabase) {
  const { data, error } = await supabase
    .from("tasks")
    .select("id, title, company_name, photoshoot_type, street, city, shoot_location, photoshoot_date")
    .eq("status", AWAITING_FOLDER_STATUS)
    .order("id", { ascending: true })
    .limit(20);

  if (error) {
    throw new Error(`Folder queue poll failed: ${error.message}`);
  }

  const queue = data ?? [];
  if (queue.length === 0) {
    return;
  }

  console.info(`[worker] Found ${queue.length} task(s) awaiting local folder creation.`);
  const root = getShootFoldersRoot();

  for (const row of queue) {
    const taskId = String(row.id);
    try {
      const folderName = buildLocalFolderNameFromTask(row);
      const base = path.join(root, folderName);

      for (const sub of ["1_Raw", "2_Selects", "3_Merged", "4_Final"]) {
        fs.mkdirSync(path.join(base, sub), { recursive: true });
      }

      const { error: updateError } = await supabase
        .from("tasks")
        .update({ local_folder_name: folderName, status: BOOKING_STATUS })
        .eq("id", taskId)
        .eq("status", AWAITING_FOLDER_STATUS);

      if (updateError) {
        console.error(`[worker] Could not save folder name for task ${taskId}:`, updateError.message);
        continue;
      }

      console.info(`[worker] Created shoot folders for task ${taskId} under ${base}`);
    } catch (err) {
      console.error(`[worker] Folder creation failed for task ${taskId}:`, err instanceof Error ? err.message : err);
    }
  }
}

async function processPendingProcessing(supabase) {
  const { data, error } = await supabase
    .from("tasks")
    .select("id, local_folder_name, status, gallery_selection")
    .eq("status", CLAIM_STATUS)
    .order("id", { ascending: true })
    .limit(20);

  if (error) {
    throw new Error(`Polling failed: ${error.message}`);
  }

  const queue = sortTasksByMergePriority(data ?? []);
  if (queue.length === 0) {
    console.info(`[worker] No ${CLAIM_STATUS} tasks found.`);
    return;
  }

  console.info(`[worker] Found ${queue.length} queued task(s).`);
  for (const [index, task] of queue.entries()) {
    console.log(`[Worker] Processing item ${index + 1} of ${queue.length}...`);
    const taskId = String(task.id);
    const localFolderName = String(task.local_folder_name ?? "").trim();
    if (!localFolderName) {
      console.warn(`[worker] Skipping task ${taskId}: missing local_folder_name.`);
      continue;
    }

    try {
      const claimed = await claimTask(supabase, taskId);
      if (!claimed) {
        console.info(`[worker] Task ${taskId} already claimed by another worker.`);
        continue;
      }

      console.info(`[worker] Processing task ${taskId}...`);
      setActiveMergeContext(taskId, localFolderName, "merge");
      const processingResult = await processTaskLocally({ id: taskId, local_folder_name: localFolderName });
      console.info(
        `[worker] Local Comfy trigger summary for task ${taskId}: queued=${processingResult.comfyQueuedCount}, failed=${processingResult.comfyFailedCount}, processed=${processingResult.processedItems}/${processingResult.totalItems}, failedItems=${processingResult.failedItems}`
      );
      if (processingResult.comfyErrors.length > 0) {
        for (const errorLine of processingResult.comfyErrors) {
          console.error(`[worker] ${errorLine}`);
        }
      }
      if (processingResult.failedItems > 0 || processingResult.processedItems !== processingResult.totalItems) {
        await finalizeTask(supabase, taskId, SELECTION_AVAILABLE_STATUS);
        console.warn(
          `[worker] Task ${taskId} left in ${SELECTION_AVAILABLE_STATUS}; ${processingResult.failedItems} of ${processingResult.totalItems} bracket(s) failed.`
        );
        continue;
      }
      const taskRoot = path.join(getShootFoldersRoot(), localFolderName);
      const expectedComfyJobs = Number(processingResult.expectedComfyJobs ?? 0);
      const queuedComfyJobs = Number(processingResult.comfyQueuedCount ?? 0);
      const failedComfyJobs = Number(processingResult.comfyFailedCount ?? 0);
      const noMergeNeeded = expectedComfyJobs === 0;
      let comfyResult = { copied: 0, timedOut: false };

      if (processingResult.comfyQueuedCount > 0 && expectedComfyJobs > 0) {
        comfyResult = await waitForComfyOutputs(
          taskRoot,
          expectedComfyJobs,
          Number(processingResult.processingStartedAtMs ?? Date.now())
        );
        if (comfyResult.timedOut) {
          console.warn(`[worker] Continuing task ${taskId} after Comfy timeout.`);
        }
      } else {
        console.warn(
          `[worker] Skipping Comfy wait for task ${taskId} (queued=${processingResult.comfyQueuedCount}, failed=${processingResult.comfyFailedCount}, expected=${expectedComfyJobs}).`
        );
      }

      const fullyMerged =
        processingResult.failedItems === 0 &&
        processingResult.processedItems === processingResult.totalItems &&
        expectedComfyJobs > 0 &&
        queuedComfyJobs === expectedComfyJobs &&
        failedComfyJobs === 0 &&
        comfyResult.timedOut === false &&
        Number(comfyResult.copied ?? 0) >= expectedComfyJobs;

      if (fullyMerged) {
        await uploadMergedAndFinalsForReview(supabase, localFolderName);
        await finalizeTask(supabase, taskId, READY_FOR_REVIEW_STATUS);
        console.info(`[worker] Task ${taskId} marked as ${READY_FOR_REVIEW_STATUS}.`);
      } else {
        const reasonParts = [
          noMergeNeeded ? "no-merge-needed" : null,
          queuedComfyJobs !== expectedComfyJobs
            ? `queued-mismatch(${queuedComfyJobs}/${expectedComfyJobs})`
            : null,
          failedComfyJobs > 0 ? `failed=${failedComfyJobs}` : null,
          comfyResult.timedOut ? "timeout" : null,
          expectedComfyJobs > 0 && Number(comfyResult.copied ?? 0) < expectedComfyJobs
            ? `copied-mismatch(${Number(comfyResult.copied ?? 0)}/${expectedComfyJobs})`
            : null,
        ].filter(Boolean);
        await finalizeTask(supabase, taskId, SELECTION_AVAILABLE_STATUS);
        console.info(
          `[worker] Task ${taskId} left in ${SELECTION_AVAILABLE_STATUS}; merge completion not 100% (${reasonParts.join(", ") || "unknown-reason"}).`
        );
      }
    } catch (err) {
      console.error("RAW COMFY ERROR:", err);
      console.error(`[worker] Task ${taskId} failed:`, err instanceof Error ? err.message : err);
      try {
        await finalizeTask(supabase, taskId, SELECTION_AVAILABLE_STATUS);
      } catch (statusErr) {
        console.error(
          `[worker] Could not set fallback status for ${taskId}:`,
          statusErr instanceof Error ? statusErr.message : statusErr
        );
      }
      // Continue processing the remaining queue items even when one item fails.
      continue;
    } finally {
      if (activeMergeTaskId === taskId) {
        clearActiveMergeContext();
      }
    }
  }
}

async function recoverOrphanedWorkerTasksOnStartup(supabase) {
  const { data: processingTasks, error: processingError } = await supabase
    .from("tasks")
    .select("id, local_folder_name")
    .eq("status", ACTIVE_STATUS)
    .order("id", { ascending: true })
    .limit(50);

  if (processingError) {
    console.warn(`[worker] Orphaned ${ACTIVE_STATUS} recovery query failed: ${processingError.message}`);
  } else {
    for (const task of processingTasks ?? []) {
      const taskId = String(task.id);
      const localFolderName = String(task.local_folder_name ?? "").trim();
      const { error } = await supabase.from("tasks").update({ status: CLAIM_STATUS }).eq("id", taskId);
      if (error) {
        console.error(`[worker] Could not recover orphaned ${ACTIVE_STATUS} task ${taskId}:`, error.message);
        continue;
      }
      console.warn(
        `[worker] Recovered orphaned ${ACTIVE_STATUS} task ${taskId}${localFolderName ? ` (${localFolderName})` : ""} -> ${CLAIM_STATUS}.`
      );
    }
  }

  const { data: syncingTasks, error: syncingError } = await supabase
    .from("tasks")
    .select("id, local_folder_name, gallery_selection")
    .eq("status", SELECTION_SYNCING_STATUS)
    .order("id", { ascending: true })
    .limit(50);

  if (syncingError) {
    console.warn(`[worker] Orphaned ${SELECTION_SYNCING_STATUS} recovery query failed: ${syncingError.message}`);
  } else {
    for (const task of syncingTasks ?? []) {
      const taskId = String(task.id);
      const localFolderName = String(task.local_folder_name ?? "").trim();
      const { selectedChunkIndices } = parseSelectionPayload(task.gallery_selection);
      if (selectedChunkIndices.length === 0) {
        continue;
      }
      const { error } = await supabase
        .from("tasks")
        .update({ status: SELECTION_AVAILABLE_STATUS })
        .eq("id", taskId);
      if (error) {
        console.error(`[worker] Could not recover orphaned ${SELECTION_SYNCING_STATUS} task ${taskId}:`, error.message);
        continue;
      }
      console.warn(
        `[worker] Recovered orphaned ${SELECTION_SYNCING_STATUS} task ${taskId}${localFolderName ? ` (${localFolderName})` : ""} -> ${SELECTION_AVAILABLE_STATUS}.`
      );
    }
  }
}

async function recoverStaleSelectionSyncTasks(supabase) {
  const { data, error } = await supabase
    .from("tasks")
    .select("id, gallery_selection")
    .eq("status", SELECTION_SYNCING_STATUS)
    .order("id", { ascending: true })
    .limit(20);

  if (error) {
    console.warn(`[worker] Stale selection-sync recovery query failed: ${error.message}`);
    return;
  }

  for (const task of data ?? []) {
    const taskId = String(task.id);
    const { selectedChunkIndices } = parseSelectionPayload(task.gallery_selection);
    if (selectedChunkIndices.length > 0) {
      continue;
    }

    console.warn(
      `[worker] Recovering task ${taskId} stuck in ${SELECTION_SYNCING_STATUS} with invalid gallery_selection.`
    );
    try {
      await resolveSelectionSyncFailure(
        supabase,
        taskId,
        new Error("No selected_chunk_indices in gallery_selection.")
      );
    } catch (statusErr) {
      console.error(
        `[worker] Could not recover stale selection sync for ${taskId}:`,
        statusErr instanceof Error ? statusErr.message : statusErr
      );
    }
  }
}

async function processSelectionAvailable(supabase) {
  await recoverStaleSelectionSyncTasks(supabase);

  const { data, error } = await supabase
    .from("tasks")
    .select("id, local_folder_name, gallery_selection, status")
    .eq("status", SELECTION_AVAILABLE_STATUS)
    .order("id", { ascending: true })
    .limit(20);

  if (error) {
    throw new Error(`Selection sync poll failed: ${error.message}`);
  }

  const queue = sortTasksByMergePriority(data ?? []);
  if (queue.length === 0) {
    console.info(`[worker] No ${SELECTION_AVAILABLE_STATUS} tasks found.`);
    return;
  }

  console.info(`[worker] Found ${queue.length} task(s) waiting for selection sync.`);
  for (const task of queue) {
    const taskId = String(task.id);
    const localFolderName = String(task.local_folder_name ?? "").trim();
    if (!localFolderName) {
      console.warn(`[worker] Skipping task ${taskId}: missing local_folder_name.`);
      continue;
    }

    const claimed = await claimTaskForStatus(
      supabase,
      taskId,
      SELECTION_AVAILABLE_STATUS,
      SELECTION_SYNCING_STATUS
    );
    if (!claimed) {
      console.info(`[worker] Task ${taskId} selection sync already claimed by another worker.`);
      continue;
    }

    setActiveMergeContext(taskId, localFolderName, "selection-sync");

    try {
      const syncResult = await syncSelectedRawFilesToSelects(localFolderName, task.gallery_selection);
      await withRetry(`set pending_processing after selection sync for task ${taskId}`, async () => {
        const { error: updateError } = await supabase
          .from("tasks")
          .update({
            status: CLAIM_STATUS,
            gallery_selection: {
              ...(task.gallery_selection && typeof task.gallery_selection === "object"
                ? task.gallery_selection
                : {}),
              synced_at: new Date().toISOString(),
              synced_selected_files: syncResult.copiedFiles,
            },
          })
          .eq("id", taskId);
        if (updateError) {
          throw new Error(updateError.message);
        }
      });

      console.info(
        `[worker] Synced ${syncResult.copiedFiles.length} selected RAW file(s) into 2_Selects for task ${taskId}.`
      );
    } catch (err) {
      console.error(`[worker] Selection sync failed for task ${taskId}:`, err instanceof Error ? err.message : err);
      try {
        await resolveSelectionSyncFailure(supabase, taskId, err);
      } catch (statusErr) {
        console.error(
          `[worker] Could not update task status after selection sync failure for ${taskId}:`,
          statusErr instanceof Error ? statusErr.message : statusErr
        );
      }
    } finally {
      if (activeMergeTaskId === taskId) {
        clearActiveMergeContext();
      }
    }
  }
}

async function main() {
  console.info("[worker] Starting processing worker...");
  console.info(`[worker] Shoot folders root: ${getShootFoldersRoot()}`);
  console.info(
    `[worker] Retry config: attempts=${RETRY_ATTEMPTS}, base_ms=${RETRY_BASE_MS}, processing_poll_ms=${PROCESSING_POLL_INTERVAL_MS}`
  );
  console.info(
    `[worker] Retry env raw values: WORKER_RETRY_ATTEMPTS=${process.env.WORKER_RETRY_ATTEMPTS ?? "(unset)"}, WORKER_RETRY_BASE_MS=${process.env.WORKER_RETRY_BASE_MS ?? "(unset)"}`
  );
  console.info(
    `[worker] Preview retry config: attempts=${PREVIEW_RETRY_ATTEMPTS}, base_ms=${PREVIEW_RETRY_BASE_MS}, grouping=timestamp-dynamic, bucket=${SUPABASE_PREVIEWS_BUCKET}`
  );
  console.info(
    `[worker] Preview env raw values: PREVIEW_RETRY_ATTEMPTS=${process.env.PREVIEW_RETRY_ATTEMPTS ?? "(unset)"}, PREVIEW_RETRY_BASE_MS=${process.env.PREVIEW_RETRY_BASE_MS ?? "(unset)"}, SUPABASE_PREVIEWS_BUCKET=${process.env.SUPABASE_PREVIEWS_BUCKET ?? "(unset)"}`
  );
  console.info(
    `[worker] Comfy output dir: ${COMFY_OUTPUT_DIR}; wait_timeout_ms=${COMFY_WAIT_TIMEOUT_MS}; SUPABASE_FINALS_BUCKET=${SUPABASE_FINALS_BUCKET}`
  );
  console.info(
    `[worker] Merge timeouts: single_item_ms=${LOCAL_PROCESS_TIMEOUT_MS_EFFECTIVE}, priority_poll_ms=${PRIORITY_POLL_INTERVAL_MS}`
  );
  await logExiftoolStartupStatus();
  await processInitialPreviewSync(getSupabaseClient()).catch((err) => {
    console.error("[worker] Initial full preview sync failed:", err instanceof Error ? err.message : err);
  });
  startRawFolderWatcher();
  startSelectsFolderWatcher();
  startWorkerHeartbeat();

  await processAwaitingFolderCreation(getSupabaseClient()).catch((err) => {
    console.error("[worker] Initial folder run failed:", err instanceof Error ? err.message : err);
  });

  setInterval(() => {
    void processAwaitingFolderCreation(getSupabaseClient()).catch((err) => {
      console.error("[worker] Folder poll failed:", err instanceof Error ? err.message : err);
    });
  }, FOLDER_POLL_INTERVAL_MS);

  const supabase = getSupabaseClient();
  await recoverOrphanedWorkerTasksOnStartup(supabase).catch((err) => {
    console.error(
      "[worker] Orphaned worker task recovery failed:",
      err instanceof Error ? err.message : err
    );
  });

  await runProcessingPipeline(supabase, { reason: "startup" }).catch((err) => {
    console.error("[worker] Initial processing run failed:", err instanceof Error ? err.message : err);
  });

  setInterval(() => {
    void runProcessingPipeline(getSupabaseClient(), { reason: "scheduled-poll" }).catch((err) => {
      console.error("[worker] Processing poll failed:", err instanceof Error ? err.message : err);
    });
  }, PROCESSING_POLL_INTERVAL_MS);

  setInterval(() => {
    void (async () => {
      if (isMergePipelineBusy()) {
        return;
      }
      const supabase = getSupabaseClient();
      if (!(await hasPriorityMergeQueued(supabase))) {
        return;
      }
      await runProcessingPipeline(supabase, { reason: "priority-poll" });
    })().catch((err) => {
      console.error("[worker] Priority poll failed:", err instanceof Error ? err.message : err);
    });
  }, PRIORITY_POLL_INTERVAL_MS);

  setInterval(() => {
    void processInitialPreviewSync(getSupabaseClient()).catch((err) => {
      console.error("[worker] Preview fallback sync failed:", err instanceof Error ? err.message : err);
    });
  }, PREVIEW_FALLBACK_SYNC_INTERVAL_MS);
}

process.on("unhandledRejection", (reason) => {
  console.error(
    "[worker] Unhandled promise rejection (worker continues):",
    reason instanceof Error ? reason.message : reason
  );
});

process.on("uncaughtException", (error) => {
  console.error("[worker] Uncaught exception (worker continues):", error);
});

void main();
