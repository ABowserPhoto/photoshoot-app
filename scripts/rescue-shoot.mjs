/**
 * One-off rescue: copy the 5-frame RAW brackets for the Westhellweg 128 selection
 * from 1_Raw into 2_Selects. The gallery payload listed 30 representative files
 * and stored bracket_size: 3; this shoot was captured as 5-exposure sequences.
 *
 * Usage (from repo root):
 *   node scripts/rescue-shoot.mjs
 *   node scripts/rescue-shoot.mjs --dry-run
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

import { buildTimestampBracketsFromDir } from "../lib/bracketGrouping.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOCAL_FOLDER_NAME = "Immobilien - Sparkasse Dortmund - Westhellweg 128, Schwerte";
const FORCED_BRACKET_SIZE = 5;
const DEFAULT_PHOTOS_ROOT = "D:\\Photos_2026";

const SELECTED_FILES = [
  "Westhellweg128_Schwerte_299.NEF",
  "Westhellweg128_Schwerte_294.NEF",
  "Westhellweg128_Schwerte_279.NEF",
  "Westhellweg128_Schwerte_254.NEF",
  "Westhellweg128_Schwerte_229.NEF",
  "Westhellweg128_Schwerte_219.NEF",
  "Westhellweg128_Schwerte_214.NEF",
  "Westhellweg128_Schwerte_209.NEF",
  "Westhellweg128_Schwerte_199.NEF",
  "Westhellweg128_Schwerte_194.NEF",
  "Westhellweg128_Schwerte_189.NEF",
  "Westhellweg128_Schwerte_179.NEF",
  "Westhellweg128_Schwerte_174.NEF",
  "Westhellweg128_Schwerte_164.NEF",
  "Westhellweg128_Schwerte_154.NEF",
  "Westhellweg128_Schwerte_144.NEF",
  "Westhellweg128_Schwerte_134.NEF",
  "Westhellweg128_Schwerte_109.NEF",
  "Westhellweg128_Schwerte_104.NEF",
  "Westhellweg128_Schwerte_94.NEF",
  "Westhellweg128_Schwerte_74.NEF",
  "Westhellweg128_Schwerte_69.NEF",
  "Westhellweg128_Schwerte_59.NEF",
  "Westhellweg128_Schwerte_49.NEF",
  "Westhellweg128_Schwerte_44.NEF",
  "Westhellweg128_Schwerte_34.NEF",
  "Westhellweg128_Schwerte_24.NEF",
  "Westhellweg128_Schwerte_19.NEF",
  "Westhellweg128_Schwerte_14.NEF",
  "Westhellweg128_Schwerte_4.NEF",
];

function loadEnvFiles() {
  for (const candidate of [
    process.env.PHOTOSHOOT_ENV_FILE?.trim(),
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), ".env"),
    path.resolve(__dirname, "..", ".env.local"),
    path.resolve(__dirname, "..", ".env"),
  ].filter(Boolean)) {
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate, override: false });
    }
  }
}

function getShootFoldersRoot() {
  const configured =
    process.env.BASE_DIR?.trim() || process.env.PHOTOS_ROOT?.trim() || DEFAULT_PHOTOS_ROOT;
  const defaultResolved = path.resolve(DEFAULT_PHOTOS_ROOT);
  const configuredResolved = path.resolve(configured);
  const rel = path.relative(defaultResolved, configuredResolved);
  const isWithinDefaultRoot = rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  return isWithinDefaultRoot ? configuredResolved : DEFAULT_PHOTOS_ROOT;
}

function lookupKey(value) {
  return String(value ?? "")
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.toLowerCase() ?? "";
}

async function main() {
  loadEnvFiles();
  const dryRun = process.argv.includes("--dry-run");
  const root = getShootFoldersRoot();
  const rawDir = path.join(root, LOCAL_FOLDER_NAME, "1_Raw");
  const selectsDir = path.join(root, LOCAL_FOLDER_NAME, "2_Selects");

  console.log(`[rescue-shoot] folder = ${LOCAL_FOLDER_NAME}`);
  console.log(`[rescue-shoot] 1_Raw  = ${rawDir}`);
  console.log(`[rescue-shoot] 2_Selects = ${selectsDir}`);
  console.log(`[rescue-shoot] forced bracket size = ${FORCED_BRACKET_SIZE}`);
  console.log(`[rescue-shoot] selected representatives = ${SELECTED_FILES.length}`);
  console.log(`[rescue-shoot] mode = ${dryRun ? "dry-run (no copies)" : "copy"}`);

  if (!fs.existsSync(rawDir)) {
    throw new Error(`1_Raw not found: ${rawDir}`);
  }
  fs.mkdirSync(selectsDir, { recursive: true });

  const chunks = await buildTimestampBracketsFromDir(rawDir, {
    taskBracketSize: FORCED_BRACKET_SIZE,
  });
  console.log(`[rescue-shoot] grouped ${chunks.length} chunk(s) from 1_Raw`);

  const chunkByFile = new Map();
  for (const chunk of chunks) {
    for (const fileName of chunk) {
      chunkByFile.set(lookupKey(fileName), chunk);
    }
  }

  const planned = new Map();
  const unmatched = [];
  for (const selected of SELECTED_FILES) {
    const chunk = chunkByFile.get(lookupKey(selected));
    if (!chunk?.length) {
      unmatched.push(selected);
      continue;
    }
    if (chunk.length !== FORCED_BRACKET_SIZE) {
      console.warn(
        `[rescue-shoot] chunk for ${selected} has ${chunk.length} file(s), expected ${FORCED_BRACKET_SIZE}:`,
        chunk
      );
    }
    for (const fileName of chunk) {
      planned.set(lookupKey(fileName), fileName);
    }
  }

  const copied = [];
  const existed = [];
  const missingOnDisk = [];

  for (const fileName of planned.values()) {
    const sourcePath = path.join(rawDir, fileName);
    const targetPath = path.join(selectsDir, fileName);
    if (!fs.existsSync(sourcePath)) {
      missingOnDisk.push(fileName);
      continue;
    }
    if (fs.existsSync(targetPath)) {
      existed.push(fileName);
      continue;
    }
    if (!dryRun) {
      fs.copyFileSync(sourcePath, targetPath);
    }
    copied.push(fileName);
  }

  console.log(`[rescue-shoot] unique files to copy: ${planned.size}`);
  console.log(`[rescue-shoot] copied: ${copied.length}${dryRun ? " (would copy)" : ""}`);
  console.log(`[rescue-shoot] already in 2_Selects: ${existed.length}`);
  console.log(`[rescue-shoot] missing on disk: ${missingOnDisk.length}`);
  console.log(`[rescue-shoot] unmatched selected files: ${unmatched.length}`);
  if (unmatched.length) {
    console.warn("[rescue-shoot] unmatched:", unmatched);
  }
  if (missingOnDisk.length) {
    console.warn("[rescue-shoot] missing:", missingOnDisk);
  }
  if (planned.size !== SELECTED_FILES.length * FORCED_BRACKET_SIZE) {
    console.warn(
      `[rescue-shoot] expected ${SELECTED_FILES.length * FORCED_BRACKET_SIZE} files (30×5); got ${planned.size}.`
    );
  }
  console.log("[rescue-shoot] done.");
}

main().catch((error) => {
  console.error("[rescue-shoot] FAILED:", error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
