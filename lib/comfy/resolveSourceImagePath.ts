import fs from "node:fs";
import path from "node:path";

import { PHOTOS_ROOT } from "@/lib/photosPaths";

const VALID_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"]);

function normalizeFilenameInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const safeDecode = (raw: string): string => {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  };
  try {
    const parsed = new URL(trimmed);
    const decodedPath = safeDecode(parsed.pathname);
    const parts = decodedPath.split("/").filter(Boolean);
    return (parts.at(-1) ?? "").trim();
  } catch {
    const normalized = trimmed.replace(/\\/g, "/");
    const parts = normalized.split("/").filter(Boolean);
    const last = parts.at(-1) ?? trimmed;
    const [withoutQuery] = last.split("?");
    const [withoutHash] = withoutQuery.split("#");
    return safeDecode(withoutHash).trim();
  }
}

function listTopLevelDirs(rootPath: string): string[] {
  if (!fs.existsSync(rootPath)) {
    return [];
  }
  return fs
    .readdirSync(rootPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function findMatchingFileRecursive(rootPath: string, targetFilename: string): string | null {
  if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) {
    return null;
  }

  const directCandidate = path.resolve(rootPath, targetFilename);
  if (fs.existsSync(directCandidate) && fs.statSync(directCandidate).isFile()) {
    return directCandidate;
  }

  const recursiveEntries = fs.readdirSync(rootPath, { recursive: true });
  for (const entry of recursiveEntries) {
    const relativePath = String(entry);
    if (path.basename(relativePath) !== targetFilename) {
      continue;
    }
    const absolutePath = path.resolve(rootPath, relativePath);
    if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
      return absolutePath;
    }
  }
  return null;
}

function resolveAiPhotoRoots(): string[] {
  const configured = process.env.AI_PHOTOS_DIR?.trim();
  const roots = [
    configured ? path.resolve(configured) : null,
    path.resolve("D:/AIPhotos"),
    path.resolve(process.cwd(), "AIPhotos"),
  ].filter((value): value is string => Boolean(value));

  return Array.from(new Set(roots));
}

function resolvePhotosRoot(): string {
  const configured = process.env.PHOTOS_ROOT?.trim();
  return path.resolve(configured || PHOTOS_ROOT);
}

export function resolveSourceImagePath(filenameRaw: string, taskId?: string): string {
  const safeName = path.basename(normalizeFilenameInput(filenameRaw));
  if (!safeName) {
    throw new Error("Invalid filename.");
  }

  const ext = path.extname(safeName).toLowerCase();
  if (!VALID_IMAGE_EXTENSIONS.has(ext)) {
    throw new Error("Unsupported image extension.");
  }

  const searchedRoots: string[] = [];
  const normalizedTaskId = taskId?.trim() ?? "";
  const kanbanRoot = resolvePhotosRoot();
  searchedRoots.push(kanbanRoot);

  // Branch A: task-targeted search inside the matched Kanban folder.
  if (normalizedTaskId) {
    const kanbanTopLevelDirs = listTopLevelDirs(kanbanRoot);
    const matchedKanbanFolder = kanbanTopLevelDirs.find((entryName) => entryName.includes(normalizedTaskId));
    if (matchedKanbanFolder) {
      const kanbanFolderPath = path.resolve(kanbanRoot, matchedKanbanFolder);
      searchedRoots.push(kanbanFolderPath);
      const fromKanban = findMatchingFileRecursive(kanbanFolderPath, safeName);
      if (fromKanban) {
        return fromKanban;
      }
    }
  }

  // Branch B: global recursive search across full PHOTOS_ROOT.
  const fromGlobalPhotos = findMatchingFileRecursive(kanbanRoot, safeName);
  if (fromGlobalPhotos) {
    return fromGlobalPhotos;
  }

  // Branch C: generative fallback search roots.
  const aiRoots = resolveAiPhotoRoots();
  for (const aiRoot of aiRoots) {
    searchedRoots.push(aiRoot);
    const fromAi = findMatchingFileRecursive(aiRoot, safeName);
    if (fromAi) {
      return fromAi;
    }
  }

  const configuredPhotosRoot = process.env.PHOTOS_ROOT?.trim() || "(not set)";
  const configuredAiPhotosDir = process.env.AI_PHOTOS_DIR?.trim() || "(not set)";
  throw new Error(`Image not found for filename "${safeName}". Recursively searched roots: ${searchedRoots.join(" | ")}. PHOTOS_ROOT=${configuredPhotosRoot}, AI_PHOTOS_DIR=${configuredAiPhotosDir}`);
}
