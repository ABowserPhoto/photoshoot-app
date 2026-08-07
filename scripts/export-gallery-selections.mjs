/**
 * Export client gallery selection filenames for a shoot.
 *
 * Usage:
 *   node scripts/export-gallery-selections.mjs <shootId>
 *   node scripts/export-gallery-selections.mjs --name "partial folder or title"
 *
 * Writes Desktop/selections.txt and prints the list to the console.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

import { buildTimestampBracketsFromDir } from "../lib/bracketGrouping.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_PHOTOS_ROOT = "D:\\Photos_2026";

function loadEnvFiles() {
  const candidates = [
    process.env.PHOTOSHOOT_ENV_FILE?.trim(),
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), ".env"),
    path.resolve(__dirname, "..", ".env.local"),
    path.resolve(__dirname, "..", ".env"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    dotenv.config({ path: candidate, override: false });
  }
}

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter((entry) => entry.length > 0)
    )
  );
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const nameFlagIndex = args.findIndex((arg) => arg === "--name" || arg === "-n");
  if (nameFlagIndex >= 0) {
    const name = args[nameFlagIndex + 1]?.trim() ?? "";
    if (!name) {
      throw new Error('Pass a value after --name, e.g. --name "Portrait - Client - City"');
    }
    return { mode: "name", value: name };
  }
  const shootId = args[0]?.trim() ?? "";
  if (!shootId) {
    throw new Error(
      [
        "Usage:",
        "  node scripts/export-gallery-selections.mjs <shootId>",
        '  node scripts/export-gallery-selections.mjs --name "partial title or folder"',
      ].join("\n")
    );
  }
  return { mode: "id", value: shootId };
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)."
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

async function findTask(supabase, query) {
  const columns =
    "id, title, local_folder_name, photoshoot_type, status, gallery_selection, gallery_previews";

  if (query.mode === "id") {
    const { data, error } = await supabase
      .from("tasks")
      .select(columns)
      .eq("id", query.value)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error(`No task found for id=${query.value}`);
    return data;
  }

  const needle = query.value;
  const { data, error } = await supabase
    .from("tasks")
    .select(columns)
    .or(`title.ilike.%${needle}%,local_folder_name.ilike.%${needle}%`)
    .limit(20);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  if (rows.length === 0) {
    throw new Error(`No tasks matched name/folder containing "${needle}".`);
  }
  if (rows.length > 1) {
    console.error("Multiple matches — re-run with an exact shootId:\n");
    for (const row of rows) {
      console.error(
        `- ${row.id} | ${row.status ?? "?"} | ${row.local_folder_name || row.title || "(untitled)"}`
      );
    }
    throw new Error("Ambiguous name match.");
  }
  return rows[0];
}

function parseGalleryPreviewItems(galleryPreviews) {
  const items = Array.isArray(galleryPreviews?.items) ? galleryPreviews.items : [];
  const byChunkIndex = new Map();

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const chunkIndex = Number(item.chunkIndex);
    const firstFilename =
      typeof item.firstFilename === "string"
        ? item.firstFilename.trim()
        : typeof item.middleFilename === "string"
          ? item.middleFilename.trim()
          : "";
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || !firstFilename) continue;
    byChunkIndex.set(chunkIndex, firstFilename);
  }

  return byChunkIndex;
}

function filenamesFromChunkIndices(selectedChunkIndices, previewByChunkIndex) {
  const filenames = [];
  const missingChunkIndices = [];

  for (const chunkIndex of selectedChunkIndices) {
    const filename = previewByChunkIndex.get(chunkIndex);
    if (!filename) {
      missingChunkIndices.push(chunkIndex);
      continue;
    }
    filenames.push(filename);
  }

  return { filenames, missingChunkIndices };
}

function getShootFoldersRoot() {
  const configured =
    process.env.BASE_DIR?.trim() || process.env.PHOTOS_ROOT?.trim() || DEFAULT_PHOTOS_ROOT;
  return path.resolve(configured);
}

/**
 * Rebuild the same timestamp-bracket scene list the gallery/worker use from 1_Raw,
 * then take the representative (first) filename for each selected chunk index.
 */
async function filenamesFromLocalRawBrackets(localFolderName, selectedChunkIndices) {
  const folder = String(localFolderName ?? "").trim();
  if (!folder || selectedChunkIndices.length === 0) {
    return { filenames: [], missingChunkIndices: [...selectedChunkIndices], rawDir: null };
  }

  const rawDir = path.join(getShootFoldersRoot(), folder, "1_Raw");
  if (!fs.existsSync(rawDir)) {
    return { filenames: [], missingChunkIndices: [...selectedChunkIndices], rawDir };
  }

  const chunks = await buildTimestampBracketsFromDir(rawDir);
  const filenames = [];
  const missingChunkIndices = [];

  for (const chunkIndex of selectedChunkIndices) {
    const chunk = chunks[chunkIndex];
    const firstFilename = Array.isArray(chunk)
      ? chunk.find((name) => typeof name === "string" && name.trim())
      : null;
    if (!firstFilename) {
      missingChunkIndices.push(chunkIndex);
      continue;
    }
    filenames.push(firstFilename);
  }

  return { filenames, missingChunkIndices, rawDir };
}

async function extractSelection(gallerySelection, galleryPreviews, localFolderName) {
  const payload =
    gallerySelection && typeof gallerySelection === "object" ? gallerySelection : {};
  const selectedFiles = asStringArray(payload.selected_files);
  const syncedSelectedFiles = asStringArray(payload.synced_selected_files);
  const selectedChunkIndices = Array.from(
    new Set(
      (Array.isArray(payload.selected_chunk_indices) ? payload.selected_chunk_indices : [])
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value >= 0)
    )
  ).sort((a, b) => a - b);

  const previewByChunkIndex = parseGalleryPreviewItems(galleryPreviews);
  const mappedFromDb = filenamesFromChunkIndices(selectedChunkIndices, previewByChunkIndex);

  let filenames = [];
  let source = "none";
  let missingChunkIndices = mappedFromDb.missingChunkIndices;

  // 1) Map selected_chunk_indices → gallery_previews.items (what the client saw).
  if (
    selectedChunkIndices.length > 0 &&
    mappedFromDb.filenames.length === selectedChunkIndices.length
  ) {
    filenames = mappedFromDb.filenames;
    source = "gallery_previews.items via selected_chunk_indices";
  } else if (selectedChunkIndices.length > 0) {
    // 2) If previews were pruned after selection, rebuild from local 1_Raw brackets.
    const mappedFromRaw = await filenamesFromLocalRawBrackets(
      localFolderName,
      selectedChunkIndices
    );
    if (mappedFromRaw.filenames.length === selectedChunkIndices.length) {
      filenames = mappedFromRaw.filenames;
      source = "1_Raw timestamp brackets via selected_chunk_indices";
      missingChunkIndices = [];
    } else if (mappedFromDb.filenames.length > 0) {
      filenames = mappedFromDb.filenames;
      source = "gallery_previews.items via selected_chunk_indices (partial)";
      missingChunkIndices = mappedFromDb.missingChunkIndices;
    } else if (mappedFromRaw.filenames.length > 0) {
      filenames = mappedFromRaw.filenames;
      source = "1_Raw timestamp brackets via selected_chunk_indices (partial)";
      missingChunkIndices = mappedFromRaw.missingChunkIndices;
    } else if (selectedFiles.length > 0) {
      filenames = selectedFiles;
      source = "gallery_selection.selected_files";
    } else if (syncedSelectedFiles.length > 0) {
      filenames = syncedSelectedFiles;
      source = "gallery_selection.synced_selected_files";
    }
  } else if (selectedFiles.length > 0) {
    filenames = selectedFiles;
    source = "gallery_selection.selected_files";
  } else if (syncedSelectedFiles.length > 0) {
    filenames = syncedSelectedFiles;
    source = "gallery_selection.synced_selected_files";
  }

  return {
    filenames,
    source,
    selectedFiles,
    syncedSelectedFiles,
    selectedChunkIndices,
    galleryPreviewCount: previewByChunkIndex.size,
    missingChunkIndices,
    submittedAt: typeof payload.submitted_at === "string" ? payload.submitted_at : null,
    syncedAt: typeof payload.synced_at === "string" ? payload.synced_at : null,
  };
}

async function main() {
  loadEnvFiles();
  const query = parseArgs(process.argv);
  const supabase = getSupabase();
  const task = await findTask(supabase, query);
  const selection = await extractSelection(
    task.gallery_selection,
    task.gallery_previews,
    task.local_folder_name
  );

  const desktopDir = path.join(os.homedir(), "Desktop");
  const outPath = path.join(desktopDir, "selections.txt");
  const lines = [
    `# Shoot ID: ${task.id}`,
    `# Title: ${task.title ?? ""}`,
    `# Folder: ${task.local_folder_name ?? ""}`,
    `# Type: ${task.photoshoot_type ?? ""}`,
    `# Status: ${task.status ?? ""}`,
    `# Submitted at: ${selection.submittedAt ?? ""}`,
    `# Synced at: ${selection.syncedAt ?? ""}`,
    `# Filename source: ${selection.source}`,
    `# gallery_previews.items count: ${selection.galleryPreviewCount}`,
    `# selected_files count: ${selection.selectedFiles.length}`,
    `# synced_selected_files count: ${selection.syncedSelectedFiles.length}`,
    `# selected_chunk_indices count: ${selection.selectedChunkIndices.length}`,
    `# selected_chunk_indices: ${selection.selectedChunkIndices.join(", ")}`,
    `# missing_chunk_indices count: ${selection.missingChunkIndices.length}`,
    `# missing_chunk_indices: ${selection.missingChunkIndices.join(", ")}`,
    "",
    ...selection.filenames,
    "",
  ];

  fs.mkdirSync(desktopDir, { recursive: true });
  fs.writeFileSync(outPath, lines.join("\n"), "utf8");

  console.log("Task:");
  console.log(`  id:     ${task.id}`);
  console.log(`  title:  ${task.title ?? ""}`);
  console.log(`  folder: ${task.local_folder_name ?? ""}`);
  console.log(`  type:   ${task.photoshoot_type ?? ""}`);
  console.log("");
  console.log(`Filename source: ${selection.source}`);
  console.log(`gallery_previews.items: ${selection.galleryPreviewCount}`);
  console.log(`selected_files: ${selection.selectedFiles.length}`);
  console.log(`synced_selected_files: ${selection.syncedSelectedFiles.length}`);
  console.log(`selected_chunk_indices: ${selection.selectedChunkIndices.length}`);
  if (selection.missingChunkIndices.length > 0) {
    console.log(
      `WARNING: ${selection.missingChunkIndices.length} selected chunk index(es) not found in gallery_previews: ${selection.missingChunkIndices.join(", ")}`
    );
    console.log(
      "(After selection, the worker may drop selected scenes from gallery_previews on the next preview sync.)"
    );
  }
  console.log("");
  if (selection.filenames.length === 0) {
    console.log("No selected filenames could be resolved.");
  } else {
    console.log(`Selected filenames (${selection.filenames.length}):`);
    for (const name of selection.filenames) {
      console.log(`  ${name}`);
    }
  }
  console.log("");
  console.log(`Wrote ${outPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
