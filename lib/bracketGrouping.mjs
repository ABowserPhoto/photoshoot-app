import fs from "node:fs";
import path from "node:path";
import ExifReader from "exifreader";
import exifr from "exifr";

/** Gap (seconds) between end of exposure N and start of exposure N+1 to stay in one bracket. */
export const BRACKET_GAP_THRESHOLD_SEC = 4;

/**
 * Hard cap on files per bracket (0 = disabled). Fallback when no task bracket_size is set.
 * Override via BRACKET_MAX_FILES env.
 */
export const BRACKET_MAX_FILES = readPositiveIntEnv("BRACKET_MAX_FILES", 7);

/** Valid booking bracket sizes for Immobilien (used to cap timestamp grouping). */
export const TASK_BRACKET_SIZES = new Set([3, 5, 7]);

/**
 * Per-file EXIF read budget. A single wedged RAW read must never stall the merge
 * pipeline, so every metadata read races this timeout and falls back to mtime.
 */
export const EXIF_READ_TIMEOUT_MS = readPositiveIntEnv("BRACKET_EXIF_TIMEOUT_MS", 5000);

/**
 * exiftool is only a last-resort fallback now, so it gets a very short leash.
 * A vendored exiftool child that cannot start burns this budget per file.
 */
export const EXIFTOOL_READ_TIMEOUT_MS = readPositiveIntEnv("BRACKET_EXIFTOOL_TIMEOUT_MS", 200);

/** Consecutive exiftool timeouts before the process is killed and bypassed. */
export const EXIFTOOL_FAILURE_THRESHOLD = readPositiveIntEnv("BRACKET_EXIFTOOL_MAX_FAILURES", 3);

/**
 * Header slice covering IFD0 + EXIF SubIFD on Nikon/Canon/Sony RAW. Nikon NEF
 * needs ~64KB; 128KB keeps margin while limiting cold-disk I/O on big folders.
 * Anything that misses gets one wider retry before other backends.
 */
const EXIF_HEADER_BYTES = readPositiveIntEnv("BRACKET_EXIF_HEADER_BYTES", 128 * 1024);

const EXIFR_OPTIONS = {
  tiff: true,
  ifd0: true,
  exif: true,
  gps: false,
  interop: false,
  jfif: false,
  iptc: false,
  xmp: false,
  icc: false,
  // Raw EXIF strings keep timestamp parsing identical across every backend.
  // (exifr's revived Dates treat EXIF local time as UTC, which would shift
  // gaps whenever two files were read by different backends.)
  reviveValues: false,
  mergeOutput: true,
};

function readPositiveIntEnv(name, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Normalize tasks.bracket_size from the database (3, 5, or 7). Returns 0 when unset/invalid.
 */
export function normalizeTaskBracketSize(value) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (TASK_BRACKET_SIZES.has(parsed)) {
    return parsed;
  }
  return 0;
}

/**
 * Max files per timestamp bracket: prefer task booking size, else BRACKET_MAX_FILES env.
 */
export function resolveMaxFilesPerBracket(taskBracketSize) {
  const fromTask = normalizeTaskBracketSize(taskBracketSize);
  if (fromTask > 0) {
    return fromTask;
  }
  return BRACKET_MAX_FILES;
}

/** RAW files are often 50MB+; read capture times via exiftool, not full-buffer ExifReader. */
const RAW_BRACKET_EXTENSIONS = new Set([
  ".nef",
  ".arw",
  ".cr2",
  ".cr3",
  ".dng",
  ".raf",
  ".rw2",
  ".orf",
]);
const IMAGE_EXTENSIONS = new Set([
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
]);

let exiftoolSingleton = null;
let exiftoolConsecutiveFailures = 0;
let exiftoolDisabled = false;

function isImageFile(fileName) {
  const normalized = fileName.toLowerCase();
  if (normalized === ".ds_store" || normalized === "thumbs.db") {
    return false;
  }
  // Skip bracket work dirs / hidden noise if anything lands as a file at folder root.
  if (normalized.startsWith(".") || normalized.startsWith("_")) {
    return false;
  }
  return IMAGE_EXTENSIONS.has(path.extname(normalized));
}

function readNaturallySortedImageFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isImageFile(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

function readStringTagDescription(value) {
  if (!value) return null;
  const description = value.description;
  if (Array.isArray(description)) {
    return description[0] ?? null;
  }
  return typeof description === "string" && description.trim() ? description : null;
}

function readSubSecFraction(tag) {
  if (tag == null) return 0;
  // ExifReader yields {description,value} objects; exifr yields plain strings.
  const raw =
    typeof tag === "string" || typeof tag === "number" ? tag : (tag.description ?? tag.value);
  if (raw == null) return 0;
  const token = String(Array.isArray(raw) ? raw[0] : raw).trim();
  if (!token) return 0;
  const n = Number(token);
  if (!Number.isFinite(n) || n < 0) return 0;
  // EXIF SubSecTime* is the fractional part of a second (typically 0–999 ms).
  if (token.length >= 3) {
    return n / 1000;
  }
  if (token.length === 2) {
    return n / 100;
  }
  return n / 10;
}

/**
 * Parse EXIF-style timestamps to epoch ms.
 * Supports `YYYY:MM:DD HH:MM:SS`, ISO-like strings, and Date.parse fallbacks.
 */
export function parseExifDateTimeToMs(dateTime) {
  if (dateTime == null) return null;
  const s = String(dateTime).trim();
  if (!s) return null;

  const exifMatch = s.match(/^(\d{4})[:/-](\d{2})[:/-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (exifMatch) {
    const y = Number(exifMatch[1]);
    const mo = Number(exifMatch[2]);
    const d = Number(exifMatch[3]);
    const h = Number(exifMatch[4]);
    const mi = Number(exifMatch[5]);
    const sec = Number(exifMatch[6]);
    if ([y, mo, d, h, mi, sec].every((n) => Number.isFinite(n))) {
      return new Date(y, mo - 1, d, h, mi, sec).getTime();
    }
  }

  const parsed = Date.parse(s);
  return Number.isFinite(parsed) ? parsed : null;
}

function exiftoolDateToMs(value) {
  if (value == null) return null;
  if (typeof value.toMillis === "function") {
    const ms = value.toMillis();
    return Number.isFinite(ms) ? ms : null;
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === "string") {
    return parseExifDateTimeToMs(value);
  }
  return null;
}

function parseExposureSeconds(tag) {
  if (!tag) return 0;
  if (typeof tag.computed === "number" && Number.isFinite(tag.computed)) {
    return Math.max(0, tag.computed);
  }
  if (!Array.isArray(tag.value) || tag.value.length < 2) {
    return 0;
  }
  const num = Number(tag.value[0]);
  const denom = Number(tag.value[1]);
  if (!denom || !Number.isFinite(num) || !Number.isFinite(denom)) {
    return 0;
  }
  return Math.max(0, num / denom);
}

function parseExposureTimeValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, value);
  }
  if (typeof value === "string") {
    const frac = value.trim().match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
    if (frac) {
      const num = Number(frac[1]);
      const denom = Number(frac[2]);
      if (denom && Number.isFinite(num)) {
        return Math.max(0, num / denom);
      }
    }
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, parsed);
    }
  }
  return 0;
}

class ExifReadTimeoutError extends Error {
  constructor(label, timeoutMs) {
    super(`${label} exceeded ${timeoutMs}ms EXIF read budget`);
    this.name = "ExifReadTimeoutError";
  }
}

/**
 * Race a metadata read against a hard timeout. The underlying read may keep
 * running in the background, but the caller is never blocked indefinitely.
 */
function withExifTimeout(promise, label, timeoutMs = EXIF_READ_TIMEOUT_MS) {
  let timer = null;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new ExifReadTimeoutError(label, timeoutMs)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  });
}

async function getExiftool() {
  if (!exiftoolSingleton) {
    const module = await import("exiftool-vendored");
    const { ExifTool, exiftool } = module;
    // A dedicated instance lets us bound each task; the shared singleton has no
    // task timeout, so one stuck RAW read can wedge every later read.
    if (typeof ExifTool === "function") {
      try {
        exiftoolSingleton = new ExifTool({
          taskTimeoutMillis: EXIFTOOL_READ_TIMEOUT_MS,
          maxTasksPerProcess: 500,
        });
      } catch (error) {
        console.warn(
          "[BracketGrouping] Could not create bounded ExifTool instance; using shared singleton:",
          error instanceof Error ? error.message : error
        );
        exiftoolSingleton = exiftool;
      }
    } else {
      exiftoolSingleton = exiftool;
    }
  }
  return exiftoolSingleton;
}

/**
 * Circuit breaker: after EXIFTOOL_FAILURE_THRESHOLD consecutive timeouts the
 * exiftool child is killed and skipped for the rest of the process, so a broken
 * vendored binary costs one short burst instead of minutes per folder.
 */
function noteExiftoolSuccess() {
  exiftoolConsecutiveFailures = 0;
}

async function tripExiftoolCircuitBreaker(reason) {
  if (exiftoolDisabled) {
    return;
  }
  exiftoolDisabled = true;
  console.error(
    `[BracketGrouping] exiftool circuit breaker OPEN after ${exiftoolConsecutiveFailures} consecutive failures (${reason}). ` +
      "Falling back to exifr/mtime for all remaining files."
  );
  const instance = exiftoolSingleton;
  exiftoolSingleton = null;
  if (instance && typeof instance.end === "function") {
    try {
      await withExifTimeout(
        Promise.resolve(instance.end(true)),
        "exiftool shutdown",
        EXIFTOOL_READ_TIMEOUT_MS * 5
      );
      console.info("[BracketGrouping] exiftool process terminated by circuit breaker.");
    } catch (error) {
      console.warn(
        "[BracketGrouping] exiftool shutdown did not complete cleanly:",
        error instanceof Error ? error.message : error
      );
    }
  }
}

async function noteExiftoolFailure(reason) {
  exiftoolConsecutiveFailures += 1;
  if (exiftoolConsecutiveFailures >= EXIFTOOL_FAILURE_THRESHOLD) {
    await tripExiftoolCircuitBreaker(reason);
  }
}

/**
 * Read a bounded header slice with an explicitly closed file handle so no
 * descriptor stays open against a RAW the merge pipeline is about to read.
 */
async function readHeaderBuffer(fullPath, maxBytes = EXIF_HEADER_BYTES) {
  let handle = null;
  try {
    handle = await fs.promises.open(fullPath, "r");
    const info = await handle.stat();
    const size = Math.min(maxBytes, info.size);
    if (size <= 0) {
      return null;
    }
    const buffer = Buffer.allocUnsafe(size);
    await handle.read(buffer, 0, size, 0);
    return buffer;
  } finally {
    // Always release the descriptor: the merge pipeline opens these same RAWs
    // immediately afterwards and must not contend with a stale handle.
    if (handle) {
      await handle.close().catch(() => {});
    }
  }
}

function pickExifrCaptureString(tags) {
  const candidates = [tags?.DateTimeOriginal, tags?.CreateDate, tags?.ModifyDate];
  for (const candidate of candidates) {
    if (candidate instanceof Date) {
      const ms = candidate.getTime();
      if (Number.isFinite(ms)) {
        return { ms };
      }
    }
    if (typeof candidate === "string" && candidate.trim()) {
      const ms = parseExifDateTimeToMs(candidate);
      if (ms != null) {
        return { ms };
      }
    }
  }
  return null;
}

/**
 * ExifReader exposes rationals as `value: [numerator, denominator]` with a
 * display string in `description` (e.g. "+1/3"), so prefer the numeric pair.
 */
function readExifReaderRational(tag) {
  if (!tag) return null;
  const value = tag.value;
  if (Array.isArray(value) && value.length === 2) {
    const [numerator, denominator] = value;
    if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0) {
      return numerator / denominator;
    }
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number(String(tag.description ?? "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function pickExposureBias(tags) {
  // Nikon/Canon expose EV offset as ExposureBiasValue (0x9204); exifr's
  // translated key for the same tag is ExposureCompensation.
  const raw = tags?.ExposureBiasValue ?? tags?.ExposureCompensation;
  const value = typeof raw === "string" ? Number(raw) : raw;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Primary metadata path: pure in-memory header parsing. Roughly 0.5ms/file on
 * Nikon NEF versus a multi-second exiftool round trip.
 */
async function readCaptureMetaViaExifr(fullPath) {
  const fileName = path.basename(fullPath);
  try {
    let tags = null;
    const header = await withExifTimeout(readHeaderBuffer(fullPath), `header read ${fileName}`);
    if (header) {
      tags = await withExifTimeout(
        exifr.parse(header, EXIFR_OPTIONS),
        `exifr header parse ${fileName}`
      );
    }
    // Some vendors push the EXIF SubIFD past our header slice. Retry with a
    // larger slice we own outright rather than letting exifr open the file,
    // so every descriptor is still closed by readHeaderBuffer's finally.
    if (!pickExifrCaptureString(tags)) {
      const wideHeader = await withExifTimeout(
        readHeaderBuffer(fullPath, EXIF_HEADER_BYTES * 16),
        `wide header read ${fileName}`
      );
      if (wideHeader && wideHeader.length > (header?.length ?? 0)) {
        tags = await withExifTimeout(
          exifr.parse(wideHeader, EXIFR_OPTIONS),
          `exifr wide parse ${fileName}`
        );
      }
    }

    const capture = pickExifrCaptureString(tags);
    if (!capture) {
      return null;
    }

    let startMs = capture.ms;
    const subSec = readSubSecFraction(
      tags?.SubSecTimeOriginal ?? tags?.SubSecTimeDigitized ?? tags?.SubSecTime
    );
    if (subSec > 0) {
      startMs += subSec * 1000;
    }

    return {
      startMs,
      exposureSec: parseExposureTimeValue(tags?.ExposureTime),
      evBias: pickExposureBias(tags),
    };
  } catch (error) {
    console.warn(
      `[BracketGrouping] exifr read failed for ${fileName}:`,
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

function pickCaptureTimeMsFromExiftoolTags(tags) {
  const candidates = [
    tags.SubSecDateTimeOriginal,
    tags.DateTimeOriginal,
    tags.CreateDate,
    tags.DateTimeDigitized,
  ];
  for (const candidate of candidates) {
    const ms = exiftoolDateToMs(candidate);
    if (ms != null) {
      return ms;
    }
  }
  return null;
}

async function readCaptureMetaViaExiftool(fullPath) {
  if (exiftoolDisabled) {
    return null;
  }
  const fileName = path.basename(fullPath);
  try {
    const et = await withExifTimeout(
      getExiftool(),
      `exiftool startup for ${fileName}`,
      EXIFTOOL_READ_TIMEOUT_MS
    );
    const tags = await withExifTimeout(
      et.read(fullPath),
      `exiftool read ${fileName}`,
      EXIFTOOL_READ_TIMEOUT_MS
    );
    const startMs = pickCaptureTimeMsFromExiftoolTags(tags);
    noteExiftoolSuccess();
    if (startMs == null) {
      return null;
    }
    return {
      startMs,
      exposureSec: parseExposureTimeValue(tags.ExposureTime),
      evBias: pickExposureBias(tags),
    };
  } catch (error) {
    const timedOut = error instanceof ExifReadTimeoutError;
    console.warn(
      `[BracketGrouping] exiftool read ${timedOut ? "TIMED OUT" : "failed"} for ${fileName}:`,
      error instanceof Error ? error.message : error
    );
    await noteExiftoolFailure(timedOut ? "timeout" : "error");
    return null;
  }
}

async function readCaptureMetaViaExifReader(fullPath) {
  const fileName = path.basename(fullPath);
  try {
    const buffer = await withExifTimeout(
      fs.promises.readFile(fullPath),
      `file read ${fileName}`
    );
    const loaded = ExifReader.load(buffer, { expanded: true });
    // `expanded: true` nests tags per segment (exif/file/xmp), so flatten the
    // blocks we care about before looking anything up.
    const tags = { ...(loaded.file ?? {}), ...(loaded.xmp ?? {}), ...(loaded.exif ?? {}) };

    const dtRaw =
      readStringTagDescription(tags.DateTimeOriginal) ??
      readStringTagDescription(tags.DateTimeDigitized) ??
      readStringTagDescription(tags.DateTime);

    let startMs = parseExifDateTimeToMs(dtRaw);
    if (startMs == null) {
      return null;
    }

    const subSec =
      readSubSecFraction(tags.SubSecTimeOriginal) ||
      readSubSecFraction(tags.SubSecTimeDigitized) ||
      readSubSecFraction(tags.SubSecTime);
    if (subSec > 0) {
      startMs += subSec * 1000;
    }

    return {
      startMs,
      exposureSec: parseExposureSeconds(tags.ExposureTime),
      evBias: readExifReaderRational(tags.ExposureBiasValue),
    };
  } catch (error) {
    if (error instanceof ExifReadTimeoutError) {
      console.warn(`[BracketGrouping] ExifReader read TIMED OUT: ${fileName}`);
    }
    return null;
  }
}

/**
 * Resolve capture metadata using the cheapest backend that works:
 * exifr header parse -> ExifReader -> exiftool (short leash) -> file mtime.
 */
async function loadPhotoMeta(dirPath, fileName) {
  const fullPath = path.join(dirPath, fileName);
  const ext = path.extname(fileName).toLowerCase();

  let meta = await readCaptureMetaViaExifr(fullPath);

  if (!meta && !RAW_BRACKET_EXTENSIONS.has(ext)) {
    meta = await readCaptureMetaViaExifReader(fullPath);
  }

  if (!meta) {
    meta = await readCaptureMetaViaExiftool(fullPath);
  }

  if (meta) {
    return {
      fileName,
      startMs: meta.startMs,
      exposureSec: meta.exposureSec ?? 0,
      evBias: meta.evBias ?? null,
    };
  }

  const stat = await withExifTimeout(fs.promises.stat(fullPath), `stat ${fileName}`);
  console.warn(
    `[BracketGrouping] No capture timestamp for ${fileName}; using file mtime (bracket grouping may be inaccurate).`
  );
  return { fileName, startMs: stat.mtimeMs, exposureSec: 0, evBias: null };
}

/**
 * Group chronologically sorted captures into brackets using the tripod rule:
 * gap from end of shot A to start of shot B must stay under BRACKET_GAP_THRESHOLD_SEC.
 * When BRACKET_MAX_FILES > 0, force a new bracket once the current group reaches that size
 * (even if the gap is small) to avoid merging multiple exposure cycles / rooms.
 */
export function buildBracketsByTripodRule(sortedMeta, options = {}) {
  if (sortedMeta.length === 0) {
    return [];
  }

  const maxFiles =
    typeof options.maxFilesPerBracket === "number" && options.maxFilesPerBracket >= 0
      ? options.maxFilesPerBracket
      : BRACKET_MAX_FILES;

  const brackets = [];
  let current = [sortedMeta[0]];
  // EV offsets are unique inside one bracket (e.g. 2, 1, -1, -2, 0), so a
  // repeated value means the camera started the next exposure cycle.
  let seenEv = new Set(
    typeof sortedMeta[0].evBias === "number" ? [sortedMeta[0].evBias] : []
  );

  // `i` advances unconditionally on every pass and the loop body never mutates
  // `sortedMeta` or `i`, so identical / non-monotonic timestamps cannot loop forever.
  for (let i = 0; i < sortedMeta.length - 1; i += 1) {
    const a = sortedMeta[i];
    const b = sortedMeta[i + 1];
    // startMs is epoch milliseconds; exposureSec is seconds — convert delta to seconds before subtracting.
    const rawGapSec = (b.startMs - a.startMs) / 1000 - a.exposureSec;
    // A missing/corrupt timestamp yields NaN. Treat it as a split rather than
    // letting NaN comparisons silently swallow every file into one mega-bracket.
    const gapSec = Number.isFinite(rawGapSec) ? Math.max(0, rawGapSec) : Number.POSITIVE_INFINITY;
    const gapTooLarge = gapSec >= BRACKET_GAP_THRESHOLD_SEC;
    const atMaxSize = maxFiles > 0 && current.length >= maxFiles;
    const evRepeats = typeof b.evBias === "number" && seenEv.has(b.evBias);

    if (!Number.isFinite(rawGapSec)) {
      console.warn(
        `[BracketGrouping] Non-finite timestamp gap between ${a.fileName} and ${b.fileName}; starting a new bracket.`
      );
    }

    if (atMaxSize || gapTooLarge || evRepeats) {
      if (atMaxSize && !gapTooLarge && !evRepeats) {
        console.warn(
          `[BracketGrouping] Splitting bracket at ${maxFiles} files (gap ${gapSec.toFixed(3)}s < ${BRACKET_GAP_THRESHOLD_SEC}s threshold).`
        );
      }
      brackets.push(current);
      current = [b];
      seenEv = new Set(typeof b.evBias === "number" ? [b.evBias] : []);
    } else {
      current.push(b);
      if (typeof b.evBias === "number") {
        seenEv.add(b.evBias);
      }
    }
  }

  brackets.push(current);
  return brackets;
}

/**
 * Log bracket contents for merge diagnostics (file count, extensions, mega-bracket warnings).
 */
export function logBracketGroupingSummary(dirPath, brackets, effectiveMaxFiles = BRACKET_MAX_FILES) {
  const label = path.basename(dirPath) || dirPath;
  const maxLabel =
    effectiveMaxFiles > 0 ? effectiveMaxFiles : BRACKET_MAX_FILES > 0 ? BRACKET_MAX_FILES : "off";
  console.log(
    `[BracketGrouping] ${label}: ${brackets.length} bracket(s) (gap≤${BRACKET_GAP_THRESHOLD_SEC}s, maxFiles=${maxLabel})`
  );
  brackets.forEach((files, index) => {
    const exts = files.map((name) => path.extname(name).toLowerCase() || "(no-ext)");
    const extSummary = [...new Set(exts)].join(", ");
    console.log(`[BracketGrouping] Bracket [${index + 1}] contains ${files.length} files:`, files);
    console.log(`[BracketGrouping] Bracket [${index + 1}] extensions: ${extSummary}`);
    const warnThreshold = effectiveMaxFiles > 0 ? effectiveMaxFiles : BRACKET_MAX_FILES > 0 ? BRACKET_MAX_FILES : 7;
    if (files.length > warnThreshold) {
      console.warn(
        `[BracketGrouping] MEGA-BRACKET: bracket [${index + 1}] has ${files.length} files — merge/HDR will be slow.`
      );
    }
  });
}

function sortMetaChronologically(metaList) {
  return [...metaList].sort((a, b) => {
    const delta = a.startMs - b.startMs;
    if (delta !== 0) {
      return delta;
    }
    return a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: "base" });
  });
}

export async function buildTimestampBracketsFromDir(dirPath, options = {}) {
  const startedAtMs = Date.now();
  const label = path.basename(dirPath) || dirPath;
  let completed = false;

  try {
    const fileNames = readNaturallySortedImageFiles(dirPath);
    if (fileNames.length === 0) {
      console.info(`[BracketGrouping] No image files found in ${dirPath}.`);
      completed = true;
      return [];
    }

    const maxFiles = resolveMaxFilesPerBracket(options.taskBracketSize);
    const total = fileNames.length;
    // Give exiftool a fresh strike count per batch; the breaker itself stays
    // latched for the process once it has proven the binary is unusable.
    exiftoolConsecutiveFailures = 0;
    console.info(
      `[BracketGrouping] Reading EXIF for ${total} file(s) in ${label} ` +
        `(exifr primary, exiftool fallback ${exiftoolDisabled ? "DISABLED" : `${EXIFTOOL_READ_TIMEOUT_MS}ms`}, maxFiles=${maxFiles})...`
    );

    const metaList = [];
    let timedOutCount = 0;
    // Header parsing is sub-millisecond, so only narrate small folders in full;
    // large folders get periodic checkpoints plus every slow file.
    const verbose = total <= 20;
    for (let index = 0; index < total; index += 1) {
      const fileName = fileNames[index];
      const fileStartedAtMs = Date.now();
      if (verbose || index === 0 || (index + 1) % 25 === 0 || index === total - 1) {
        console.log(`[BracketGrouping] Reading EXIF ${index + 1}/${total}: ${fileName}`);
      }
      try {
        metaList.push(await loadPhotoMeta(dirPath, fileName));
        const elapsed = Date.now() - fileStartedAtMs;
        if (!verbose && elapsed >= 250) {
          console.warn(
            `[BracketGrouping] Slow EXIF read ${index + 1}/${total}: ${fileName} took ${elapsed}ms`
          );
        }
      } catch (error) {
        if (error instanceof ExifReadTimeoutError) {
          timedOutCount += 1;
        }
        console.warn(
          `[BracketGrouping] Skipping file ${index + 1}/${total} due to error:`,
          fileName,
          error instanceof Error ? error.message : error
        );
      }
    }

    if (timedOutCount > 0) {
      console.warn(
        `[BracketGrouping] ${timedOutCount}/${total} file(s) in ${label} exceeded their EXIF read budget.`
      );
    }

    if (metaList.length === 0) {
      console.warn(
        `[BracketGrouping] No readable metadata for any of ${total} file(s) in ${label}; returning 0 brackets.`
      );
      completed = true;
      return [];
    }

    const sortedMeta = sortMetaChronologically(metaList);
    const bracketGroups = buildBracketsByTripodRule(sortedMeta, { maxFilesPerBracket: maxFiles });
    const brackets = bracketGroups.map((group) => group.map((item) => item.fileName));
    logBracketGroupingSummary(dirPath, brackets, maxFiles);
    completed = true;
    return brackets;
  } catch (error) {
    console.error(
      `[BracketGrouping] FAILED for ${dirPath}:`,
      error instanceof Error ? (error.stack ?? error.message) : error
    );
    throw error;
  } finally {
    console.info(
      `[BracketGrouping] ${completed ? "Finished" : "Aborted"} grouping ${label} in ${Date.now() - startedAtMs}ms.`
    );
  }
}
