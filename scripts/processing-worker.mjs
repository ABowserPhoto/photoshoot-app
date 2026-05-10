import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import chokidar from "chokidar";
import sharp from "sharp";

import { buildLocalFolderNameFromTask } from "./localFolderName.mjs";
import { buildTimestampBracketsFromDir } from "../lib/bracketGrouping.mjs";
import { sanitizeStoragePath } from "../lib/sanitizeStoragePath.mjs";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const execFileAsync = promisify(execFile);

const FOLDER_POLL_INTERVAL_MS = 15 * 1000;
const PROCESSING_POLL_INTERVAL_MS = 5 * 60 * 1000;
const PREVIEW_FALLBACK_SYNC_INTERVAL_MS = 4 * 60 * 1000;
const LOCAL_PROCESS_TIMEOUT_MS = 2 * 60 * 60 * 1000;

const AWAITING_FOLDER_STATUS = "awaiting_folder_creation";
const BOOKING_STATUS = "Booking";
const SELECTION_AVAILABLE_STATUS = "Selection Available";
const SELECTION_SYNCING_STATUS = "syncing_selection";

const CLAIM_STATUS = "pending_processing";
const ACTIVE_STATUS = "Processing";
const READY_FOR_REVIEW_STATUS = "Ready for Review";
const FAILED_STATUS = "Failed";
const PREVIEW_DEBOUNCE_MS = 1500;
const PREVIEW_WIDTH = 1080;
const PREVIEW_QUALITY = 45;

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
const COMFY_WAIT_TIMEOUT_MS = readPositiveIntEnv("COMFY_WAIT_TIMEOUT_MS", 12 * 60 * 1000);

const previewSyncTimers = new Map();
let rawWatcherStarted = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function safePreviewStem(localFolderName, firstFilename, chunkIndex) {
  const stem = `${localFolderName}_${chunkIndex}_${path.basename(firstFilename, path.extname(firstFilename))}`;
  return stem.replace(/[^a-zA-Z0-9._-]/g, "_");
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

/**
 * Clean Kanban cover: resize only, then same ImageMagick exposure pass as watermarked previews (no watermark).
 */
async function buildCoverThumbnailBuffer(sourcePath) {
  const resizedBuffer = await sharp(sourcePath)
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
  if (!fs.existsSync(WATERMARK_PATH)) {
    throw new Error(`Watermark file not found at "${WATERMARK_PATH}".`);
  }

  const resizedBuffer = await sharp(sourcePath)
    .resize({ width: PREVIEW_WIDTH, fit: "inside", withoutEnlargement: true })
    .toBuffer();
  const metadata = await sharp(resizedBuffer).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error(`Could not read resized image dimensions for "${sourcePath}".`);
  }

  const watermarkBuffer = await sharp(WATERMARK_PATH, { failOn: "none" })
    .resize({
      width: metadata.width,
      height: metadata.height,
      fit: "fill",
    })
    .ensureAlpha(0.2)
    .png()
    .toBuffer();

  const watermarked = await sharp(resizedBuffer)
    .composite([{ input: watermarkBuffer, blend: "soft-light" }])
    .jpeg({ quality: PREVIEW_QUALITY, mozjpeg: true, chromaSubsampling: "4:2:0" })
    .toBuffer();

  const tmpBase = path.join(os.tmpdir(), `preview-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const tempInput = `${tmpBase}-in.jpg`;
  const tempOutput = `${tmpBase}-out.jpg`;
  try {
    await fs.promises.writeFile(tempInput, watermarked);
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

async function uploadPreviewBuffer(supabase, params) {
  const storagePath = sanitizeStoragePath(
    `${params.localFolderName}/${safePreviewStem(
      params.localFolderName,
      params.firstFilename,
      params.chunkIndex
    )}.jpg`
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
  const { data } = supabase.storage.from(SUPABASE_PREVIEWS_BUCKET).getPublicUrl(storagePath);
  return { storagePath, previewUrl: data?.publicUrl ?? "" };
}

async function ensureCoverImageOnce(supabase, taskRow, rawDir, chunks) {
  const existing = taskRow.cover_image_url;
  if (existing != null && String(existing).trim()) {
    return;
  }
  if (!chunks.length) {
    return;
  }
  const firstChunk = chunks[0];
  const firstFilename = firstChunk[0];
  if (!firstFilename || !isPreviewSourceFile(firstFilename)) {
    return;
  }
  const sourcePath = path.join(rawDir, firstFilename);
  if (!fs.existsSync(sourcePath)) {
    return;
  }

  const taskId = String(taskRow.id);
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
  const { data } = supabase.storage.from(SUPABASE_PREVIEWS_BUCKET).getPublicUrl(storagePath);
  const publicUrl = data?.publicUrl ?? "";
  if (!publicUrl) {
    return;
  }

  await withPreviewRetry(`set cover_image_url for task ${taskId}`, async () => {
    const { error } = await supabase.from("tasks").update({ cover_image_url: publicUrl }).eq("id", taskId);
    if (error) {
      throw new Error(error.message);
    }
  });
  console.info(`[worker] Cover image set for task ${taskId}`);
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
  const existingItems = parsePreviewItems(taskRow.gallery_previews);
  const existingByChunk = new Map(existingItems.map((item) => [item.chunkIndex, item]));
  const nextItems = [];
  let processedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  await ensureCoverImageOnce(supabase, taskRow, rawDir, chunks).catch((err) => {
    console.warn(
      `[worker] Cover image skipped for task ${taskRow.id}:`,
      err instanceof Error ? err.message : err
    );
  });

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex];
    const firstFilename = chunk[0];
    if (!firstFilename || !isPreviewSourceFile(firstFilename)) {
      console.warn("[worker] Skipping file due to error:", firstFilename || "(missing filename)");
      skippedCount += 1;
      continue;
    }
    const existing = existingByChunk.get(chunkIndex);
    if (existing && existing.firstFilename === firstFilename && existing.previewUrl) {
      nextItems.push(existing);
      processedCount += 1;
      continue;
    }

    try {
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

  await withPreviewRetry(`persist gallery_previews for task ${taskRow.id}`, async () => {
    const { error } = await supabase
      .from("tasks")
      .update({
        gallery_previews: {
          updated_at: new Date().toISOString(),
          bracket_size: chunks[0]?.length ?? null,
          items: nextItems,
        },
      })
      .eq("id", taskRow.id);
    if (error) {
      throw new Error(error.message);
    }
  });
  console.info(
    `[worker] Folder [${localFolderName}] complete. Processed: ${processedCount} | Skipped: ${skippedCount} | Failed: ${failedCount}`
  );
}

async function syncPreviewsForLocalFolder(localFolderName) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("tasks")
    .select("id, local_folder_name, gallery_selection, gallery_previews, cover_image_url")
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
}

async function processInitialPreviewSync(supabase) {
  console.info("[worker] Starting initial full preview sync...");
  let offset = 0;
  const pageSize = 200;
  let processed = 0;
  let skipped = 0;
  let failed = 0;

  while (true) {
    const { data, error } = await supabase
      .from("tasks")
      .select("id, local_folder_name, gallery_selection, gallery_previews, cover_image_url")
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
      try {
        await syncTaskPreviews(supabase, row);
        processed += 1;
      } catch (error) {
        failed += 1;
        console.error(
          `[worker] Initial preview sync failed for task ${row.id} (${localFolderName}):`,
          error instanceof Error ? error.message : error
        );
      }
    }

    offset += rows.length;
    if (rows.length < pageSize) {
      break;
    }
  }

  console.info(
    `[worker] Initial full preview sync finished. processed=${processed}, skipped=${skipped}, failed=${failed}`
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

function startRawFolderWatcher() {
  if (rawWatcherStarted) {
    return;
  }
  rawWatcherStarted = true;

  const root = getShootFoldersRoot();
  const watcher = chokidar.watch(root, {
    ignoreInitial: false,
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 100,
    },
    usePolling: true,
  });

  watcher.on("all", (eventName, filePath) => {
    if (!["add", "change", "unlink", "addDir"].includes(eventName)) {
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
  const url = `${localOrigin.replace(/\/$/, "")}/api/worker/process-task`;
  console.info(
    `[worker] Calling local process-task endpoint: ${url} (timeout ${LOCAL_PROCESS_TIMEOUT_MS}ms)`
  );

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-worker-secret": workerSecret,
      },
      body: JSON.stringify({
        taskId: String(task.id),
        local_folder_name: task.local_folder_name,
      }),
      signal: AbortSignal.timeout(LOCAL_PROCESS_TIMEOUT_MS),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success) {
      const message =
        payload?.error || `Local processing failed for task ${task.id} (HTTP ${response.status}).`;
      throw new Error(message);
    }
    return {
      comfyQueuedCount: Number(payload?.comfyQueuedCount) || 0,
      comfyFailedCount: Number(payload?.comfyFailedCount) || 0,
      comfyErrors: Array.isArray(payload?.comfyErrors) ? payload.comfyErrors.map((v) => String(v)) : [],
    };
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    const isTimeout =
      errMessage.includes("UND_ERR_HEADERS_TIMEOUT") ||
      errMessage.includes("HeadersTimeoutError") ||
      errMessage.includes("The operation was aborted") ||
      errMessage.includes("aborted");
    if (isTimeout) {
      console.error(
        `[worker] process-task request timed out after ${LOCAL_PROCESS_TIMEOUT_MS}ms for task ${task.id}:`,
        err
      );
      throw new Error(
        `Local processing timed out after ${LOCAL_PROCESS_TIMEOUT_MS}ms for task ${task.id}.`
      );
    }
    console.error(`[worker] process-task request failed for task ${task.id}:`, err);
    throw err instanceof Error ? err : new Error(errMessage);
  }
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
    .select("id, local_folder_name, status")
    .eq("status", CLAIM_STATUS)
    .order("id", { ascending: true })
    .limit(20);

  if (error) {
    throw new Error(`Polling failed: ${error.message}`);
  }

  const queue = data ?? [];
  if (queue.length === 0) {
    console.info(`[worker] No ${CLAIM_STATUS} tasks found.`);
    return;
  }

  console.info(`[worker] Found ${queue.length} queued task(s).`);
  for (const task of queue) {
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
      const processingStartedAtMs = Date.now();
      const processingResult = await processTaskLocally({ id: taskId, local_folder_name: localFolderName });
      console.info(
        `[worker] Local Comfy trigger summary for task ${taskId}: queued=${processingResult.comfyQueuedCount}, failed=${processingResult.comfyFailedCount}`
      );
      if (processingResult.comfyErrors.length > 0) {
        for (const errorLine of processingResult.comfyErrors) {
          console.error(`[worker] ${errorLine}`);
        }
      }
      const taskRoot = path.join(getShootFoldersRoot(), localFolderName);
      const mergedDir = path.join(taskRoot, "3_Merged");
      const mergedFiles = readNaturallySortedImageFiles(mergedDir);
      const sqiMergedCount = mergedFiles.filter((name) => name.toLowerCase().includes("_sqi")).length;
      if (processingResult.comfyQueuedCount > 0 && sqiMergedCount > 0) {
        const comfyResult = await waitForComfyOutputs(taskRoot, sqiMergedCount, processingStartedAtMs);
        if (comfyResult.timedOut) {
          console.warn(`[worker] Continuing task ${taskId} after Comfy timeout.`);
        }
      } else {
        console.warn(
          `[worker] Skipping Comfy wait for task ${taskId} (queued=${processingResult.comfyQueuedCount}, failed=${processingResult.comfyFailedCount}, sqi=${sqiMergedCount}).`
        );
      }
      await uploadMergedAndFinalsForReview(supabase, localFolderName);
      await finalizeTask(supabase, taskId, READY_FOR_REVIEW_STATUS);
      console.info(`[worker] Task ${taskId} marked as ${READY_FOR_REVIEW_STATUS}.`);
    } catch (err) {
      console.error("RAW COMFY ERROR:", err);
      console.error(`[worker] Task ${taskId} failed:`, err instanceof Error ? err.message : err);
      try {
        await finalizeTask(supabase, taskId, FAILED_STATUS);
      } catch (statusErr) {
        console.error(
          `[worker] Could not set fallback status for ${taskId}:`,
          statusErr instanceof Error ? statusErr.message : statusErr
        );
      }
    }
  }
}

async function processSelectionAvailable(supabase) {
  const { data, error } = await supabase
    .from("tasks")
    .select("id, local_folder_name, gallery_selection, status")
    .eq("status", SELECTION_AVAILABLE_STATUS)
    .order("id", { ascending: true })
    .limit(20);

  if (error) {
    throw new Error(`Selection sync poll failed: ${error.message}`);
  }

  const queue = data ?? [];
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

    try {
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
        await withRetry(`restore Selection Available for task ${taskId}`, async () => {
          const { error: rollbackError } = await supabase
            .from("tasks")
            .update({ status: SELECTION_AVAILABLE_STATUS })
            .eq("id", taskId);
          if (rollbackError) {
            throw new Error(rollbackError.message);
          }
        });
      } catch (rollbackErr) {
        console.error(
          `[worker] Could not restore ${SELECTION_AVAILABLE_STATUS} for ${taskId}:`,
          rollbackErr instanceof Error ? rollbackErr.message : rollbackErr
        );
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
  await processInitialPreviewSync(getSupabaseClient()).catch((err) => {
    console.error("[worker] Initial full preview sync failed:", err instanceof Error ? err.message : err);
  });
  startRawFolderWatcher();

  await processAwaitingFolderCreation(getSupabaseClient()).catch((err) => {
    console.error("[worker] Initial folder run failed:", err instanceof Error ? err.message : err);
  });

  setInterval(() => {
    void processAwaitingFolderCreation(getSupabaseClient()).catch((err) => {
      console.error("[worker] Folder poll failed:", err instanceof Error ? err.message : err);
    });
  }, FOLDER_POLL_INTERVAL_MS);

  await processPendingProcessing(getSupabaseClient()).catch((err) => {
    console.error("[worker] Initial processing run failed:", err instanceof Error ? err.message : err);
  });
  await processSelectionAvailable(getSupabaseClient()).catch((err) => {
    console.error("[worker] Initial selection sync run failed:", err instanceof Error ? err.message : err);
  });

  setInterval(() => {
    void processSelectionAvailable(getSupabaseClient())
      .then(() => processPendingProcessing(getSupabaseClient()))
      .catch((err) => {
        console.error("[worker] Processing poll failed:", err instanceof Error ? err.message : err);
      });
  }, PROCESSING_POLL_INTERVAL_MS);

  setInterval(() => {
    void processInitialPreviewSync(getSupabaseClient()).catch((err) => {
      console.error("[worker] Preview fallback sync failed:", err instanceof Error ? err.message : err);
    });
  }, PREVIEW_FALLBACK_SYNC_INTERVAL_MS);
}

void main();
