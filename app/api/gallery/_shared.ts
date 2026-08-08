import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

import { buildLocalFolderNameFromTask } from "@/lib/localFolderName";
import { PHOTOS_ROOT } from "@/lib/photosPaths";

export const DEFAULT_BRACKET_SIZE = 3;

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
]);

export function parseBracketSize(raw: unknown): number {
  const numeric = Number(raw);
  const bracketSize = Number.isInteger(numeric) ? numeric : DEFAULT_BRACKET_SIZE;
  if (bracketSize < 1 || bracketSize > 15) {
    throw new Error("bracketSize must be an integer between 1 and 15.");
  }
  return bracketSize;
}

export function resolveTaskDir(localFolderName: string, stage: "1_Raw" | "2_Selects"): string {
  const trimmed = localFolderName.trim();
  if (!trimmed) {
    throw new Error("local_folder_name is required.");
  }
  if (trimmed.includes("..") || /[<>:"|?*]/.test(trimmed)) {
    throw new Error("Invalid local_folder_name.");
  }

  const resolved = path.resolve(PHOTOS_ROOT, trimmed, stage);
  const rootResolved = path.resolve(PHOTOS_ROOT);
  const rel = path.relative(rootResolved, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Invalid path.");
  }

  return resolved;
}

export function readNaturallySortedImageFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && IMAGE_EXT.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

export function chunkFiles(files: string[], bracketSize: number): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < files.length; i += bracketSize) {
    const chunk = files.slice(i, i + bracketSize);
    if (chunk.length === bracketSize) {
      chunks.push(chunk);
    }
  }
  return chunks;
}

export async function resolveLocalFolderName(params: {
  localFolderName?: string;
  shootId?: string;
}): Promise<string> {
  const provided = params.localFolderName?.trim() ?? "";
  if (provided) {
    return provided;
  }

  const shootId = params.shootId?.trim() ?? "";
  if (!shootId) {
    throw new Error("shootId or local_folder_name is required.");
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (supabaseUrl && supabaseKey) {
    // Gallery helpers run without an end-user JWT; service_role bypasses RLS.
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });
    const { data } = await supabase
      .from("tasks")
      .select("local_folder_name, title, company_name, shoot_location, photoshoot_date")
      .eq("id", shootId)
      .maybeSingle();

    if (data?.local_folder_name?.trim()) {
      return data.local_folder_name.trim();
    }

    if (data) {
      const derived = buildLocalFolderNameFromTask(data);
      if (derived) {
        return derived;
      }
    }
  }

  // Fallback for installations where the route param already matches the folder name.
  return shootId;
}
