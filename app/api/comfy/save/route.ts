import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

import { resolveSourceImagePath } from "@/lib/comfy/resolveSourceImagePath";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function resolvePreviewPath(previewUrl: string): string {
  const trimmed = previewUrl.trim();
  if (!trimmed) {
    throw new Error("previewUrl is required.");
  }
  const pathname = (() => {
    try {
      const parsed = new URL(trimmed, "http://localhost");
      return parsed.pathname;
    } catch {
      return trimmed.split("?")[0];
    }
  })();
  const normalized = pathname.replace(/\\/g, "/");
  if (!normalized.startsWith("/temp_ai/")) {
    throw new Error("previewUrl must point to /temp_ai/.");
  }

  const safeFile = path.basename(decodeURIComponent(normalized));
  const previewPath = path.resolve(process.cwd(), "public", "temp_ai", safeFile);
  const previewRoot = path.resolve(process.cwd(), "public", "temp_ai");
  if (!previewPath.toLowerCase().startsWith(previewRoot.toLowerCase() + path.sep)) {
    throw new Error("Invalid preview image path.");
  }
  if (!fs.existsSync(previewPath) || !fs.statSync(previewPath).isFile()) {
    throw new Error("Preview image file not found.");
  }
  return previewPath;
}

function buildWfFilename(originalFilename: string): string {
  const safeName = path.basename(normalizeFilenameInput(originalFilename));
  const ext = path.extname(safeName);
  const stem = path.basename(safeName, ext);
  const finalStem = stem.toLowerCase().endsWith("_wf") ? stem : `${stem}_wf`;
  return `${finalStem}${ext}`;
}

function resolveGeneratedMediaDir(): string {
  const configured = process.env.AI_PHOTOS_DIR?.trim();
  if (configured) {
    const configuredResolved = path.resolve(configured);
    fs.mkdirSync(configuredResolved, { recursive: true });
    return configuredResolved;
  }

  const windowsDefault = path.resolve("D:/AIPhotos");
  try {
    fs.mkdirSync(windowsDefault, { recursive: true });
    return windowsDefault;
  } catch {
    const projectFallback = path.resolve(process.cwd(), "AIPhotos");
    fs.mkdirSync(projectFallback, { recursive: true });
    return projectFallback;
  }
}

function deriveGeneratedFilename(previewPath: string): string {
  const ext = path.extname(path.basename(previewPath)).toLowerCase();
  const normalizedExt = ext || ".jpg";
  return `AI_Generated_${Date.now()}${normalizedExt}`;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      originalFilename?: string;
      previewUrl?: string;
      taskId?: string;
      task_id?: string;
    };
    const originalFilename = typeof body.originalFilename === "string" ? body.originalFilename.trim() : "";
    const previewUrl = typeof body.previewUrl === "string" ? body.previewUrl.trim() : "";
    const taskId =
      typeof body.taskId === "string"
        ? body.taskId.trim()
        : typeof body.task_id === "string"
          ? body.task_id.trim()
          : "";

    if (!previewUrl) {
      return NextResponse.json({ error: "previewUrl is required." }, { status: 400 });
    }

    const previewPath = resolvePreviewPath(previewUrl);

    // Edit mode: preserve the original save behavior in workflow folders.
    if (originalFilename) {
      const originalPath = resolveSourceImagePath(originalFilename, taskId);
      const targetDir = path.dirname(originalPath);
      const newFilename = buildWfFilename(originalFilename);
      const targetPath = path.join(targetDir, newFilename);
      fs.copyFileSync(previewPath, targetPath);

      return NextResponse.json({
        success: true,
        newFilename,
        newPhotoUrl: `/api/local-image?path=${encodeURIComponent(targetPath)}`,
      });
    }

    // Generative mode: write to AI_PHOTOS_DIR (or fallback location).
    const generatedDir = resolveGeneratedMediaDir();
    const generatedName = deriveGeneratedFilename(previewPath);
    const generatedPath = path.join(generatedDir, generatedName);
    fs.copyFileSync(previewPath, generatedPath);

    return NextResponse.json({
      success: true,
      newFilename: generatedName,
      newPhotoUrl: `/api/local-image?path=${encodeURIComponent(generatedPath)}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save final edit.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
