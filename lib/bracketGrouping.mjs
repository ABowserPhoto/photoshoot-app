import fs from "node:fs";
import path from "node:path";
import ExifReader from "exifreader";

const BRACKET_GAP_THRESHOLD_SEC = 4;
/** RAW files are often 50MB+; never read the full file just to group brackets. */
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

function parseExifDateTimeToMs(dateTime) {
  if (!dateTime) return null;
  const s = String(dateTime).trim();
  const m = s.match(/^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
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

async function loadPhotoMeta(dirPath, fileName) {
  const fullPath = path.join(dirPath, fileName);
  const ext = path.extname(fileName).toLowerCase();
  let exposureSec = 0;
  let startMs = null;

  if (!RAW_BRACKET_EXTENSIONS.has(ext)) {
    try {
      const buffer = await fs.promises.readFile(fullPath);
      const tags = ExifReader.load(buffer);
      const dtRaw =
        readStringTagDescription(tags["DateTimeOriginal"]) ?? readStringTagDescription(tags["DateTime"]);
      startMs = parseExifDateTimeToMs(dtRaw);
      exposureSec = parseExposureSeconds(tags["ExposureTime"]);
    } catch {
      // Fall through to mtime fallback below.
    }
  }

  const stat = await fs.promises.stat(fullPath);
  if (startMs === null) {
    startMs = stat.mtimeMs;
  }

  return { fileName, startMs, exposureSec };
}

function buildBracketsByTripodRule(sortedMeta) {
  if (sortedMeta.length === 0) {
    return [];
  }
  const brackets = [];
  let current = [sortedMeta[0]];

  for (let i = 0; i < sortedMeta.length - 1; i += 1) {
    const a = sortedMeta[i];
    const b = sortedMeta[i + 1];
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
        "[worker] Skipping file due to error:",
        fileName,
        error instanceof Error ? error.message : error
      );
    }
  }
  if (metaList.length === 0) {
    return [];
  }
  metaList.sort((a, b) => a.startMs - b.startMs);
  return buildBracketsByTripodRule(metaList).map((group) => group.map((item) => item.fileName));
}

