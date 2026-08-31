import fs from "node:fs";
import path from "node:path";
import ExifReader from "exifreader";

/** Gap (seconds) between end of exposure N and start of exposure N+1 to stay in one bracket. */
export const BRACKET_GAP_THRESHOLD_SEC = 4;

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

function isImageFile(fileName) {
  const normalized = fileName.toLowerCase();
  if (normalized === ".ds_store" || normalized === "thumbs.db") {
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
  if (!tag) return 0;
  const raw = tag.description ?? tag.value;
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

async function getExiftool() {
  if (!exiftoolSingleton) {
    const { exiftool } = await import("exiftool-vendored");
    exiftoolSingleton = exiftool;
  }
  return exiftoolSingleton;
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
  try {
    const et = await getExiftool();
    const tags = await et.read(fullPath);
    return {
      startMs: pickCaptureTimeMsFromExiftoolTags(tags),
      exposureSec: parseExposureTimeValue(tags.ExposureTime),
    };
  } catch (error) {
    console.warn(
      "[bracketGrouping] exiftool read failed:",
      path.basename(fullPath),
      error instanceof Error ? error.message : error
    );
    return { startMs: null, exposureSec: 0 };
  }
}

async function readCaptureMetaViaExifReader(fullPath) {
  try {
    const buffer = await fs.promises.readFile(fullPath);
    const tags = ExifReader.load(buffer, { expanded: true });

    const dtRaw =
      readStringTagDescription(tags.DateTimeOriginal) ??
      readStringTagDescription(tags.DateTimeDigitized) ??
      readStringTagDescription(tags.DateTime);

    let startMs = parseExifDateTimeToMs(dtRaw);
    if (startMs != null) {
      const subSec =
        readSubSecFraction(tags.SubSecTimeOriginal) ||
        readSubSecFraction(tags.SubSecTimeDigitized) ||
        readSubSecFraction(tags.SubSecTime);
      if (subSec > 0) {
        startMs += subSec * 1000;
      }
    }

    return {
      startMs,
      exposureSec: parseExposureSeconds(tags.ExposureTime),
    };
  } catch {
    return { startMs: null, exposureSec: 0 };
  }
}

async function loadPhotoMeta(dirPath, fileName) {
  const fullPath = path.join(dirPath, fileName);
  const ext = path.extname(fileName).toLowerCase();
  let startMs = null;
  let exposureSec = 0;

  if (RAW_BRACKET_EXTENSIONS.has(ext)) {
    ({ startMs, exposureSec } = await readCaptureMetaViaExiftool(fullPath));
  } else {
    ({ startMs, exposureSec } = await readCaptureMetaViaExifReader(fullPath));
    if (startMs === null) {
      ({ startMs, exposureSec } = await readCaptureMetaViaExiftool(fullPath));
    }
  }

  if (startMs === null) {
    const stat = await fs.promises.stat(fullPath);
    startMs = stat.mtimeMs;
    console.warn(
      `[bracketGrouping] No capture timestamp for ${fileName}; using file mtime (bracket grouping may be inaccurate).`
    );
  }

  return { fileName, startMs, exposureSec };
}

/**
 * Group chronologically sorted captures into brackets using the tripod rule:
 * gap from end of shot A to start of shot B must stay under BRACKET_GAP_THRESHOLD_SEC.
 */
export function buildBracketsByTripodRule(sortedMeta) {
  if (sortedMeta.length === 0) {
    return [];
  }

  const brackets = [];
  let current = [sortedMeta[0]];

  for (let i = 0; i < sortedMeta.length - 1; i += 1) {
    const a = sortedMeta[i];
    const b = sortedMeta[i + 1];
    // startMs is epoch milliseconds; exposureSec is seconds — convert delta to seconds before subtracting.
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

function sortMetaChronologically(metaList) {
  return [...metaList].sort((a, b) => {
    const delta = a.startMs - b.startMs;
    if (delta !== 0) {
      return delta;
    }
    return a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: "base" });
  });
}

export async function buildTimestampBracketsFromDir(dirPath) {
  const fileNames = readNaturallySortedImageFiles(dirPath);
  if (fileNames.length === 0) {
    return [];
  }

  const metaList = [];
  for (const fileName of fileNames) {
    try {
      metaList.push(await loadPhotoMeta(dirPath, fileName));
    } catch (error) {
      console.warn(
        "[bracketGrouping] Skipping file due to error:",
        fileName,
        error instanceof Error ? error.message : error
      );
    }
  }

  if (metaList.length === 0) {
    return [];
  }

  const sortedMeta = sortMetaChronologically(metaList);
  return buildBracketsByTripodRule(sortedMeta).map((group) => group.map((item) => item.fileName));
}
