import { exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { PHOTOS_ROOT } from "@/lib/photosPaths";
import { sanitizeStoragePath } from "@/lib/sanitizeStoragePath.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execAsync = promisify(exec);

// Assembled at runtime so Node File Tracing doesn't try to bundle the ComfyUI install.
const COMFY_DEFAULT_ROOT =
  process.env.COMFYUI_PATH?.trim() || ["C:", "ComfyUI_windows_portable", "ComfyUI"].join("/");
const COMFY_OUTPUT_DIR =
  process.env.COMFYUI_OUTPUT_DIR?.trim() || [COMFY_DEFAULT_ROOT, "output"].join("/");
const SUPABASE_FINALS_BUCKET = process.env.SUPABASE_FINALS_BUCKET?.trim() || "finals";

type AdjustmentOptions = {
  brightness: number;
  saturation: number;
  hue: number;
  contrast: number;
  blur: number;
  shadows: number;
  highlights: number;
};

function isPathUnderRoot(resolvedPath: string, rootPath: string): boolean {
  const normalizedRoot = path.resolve(rootPath);
  return resolvedPath.toLowerCase().startsWith(normalizedRoot.toLowerCase() + path.sep);
}

function extractPathFromLocalImageUrl(rawPath: string): string | null {
  const trimmed = rawPath.trim();
  if (!trimmed.includes("local-image")) {
    return null;
  }

  try {
    const url = trimmed.startsWith("http://") || trimmed.startsWith("https://")
      ? new URL(trimmed)
      : new URL(trimmed, "http://localhost");
    const embedded = url.searchParams.get("path")?.trim() ?? url.searchParams.get("filepath")?.trim() ?? "";
    return embedded ? decodeURIComponent(embedded) : null;
  } catch {
    return null;
  }
}

/**
 * Normalize client-supplied paths to an absolute filesystem path under PHOTOS_ROOT when possible.
 * Accepts true absolute paths, paths relative to PHOTOS_ROOT, and /api/local-image proxy URLs.
 */
function resolveLocalImagePathInput(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    throw new Error("absoluteLocalPath is required.");
  }

  const fromProxyUrl = extractPathFromLocalImageUrl(trimmed);
  if (fromProxyUrl) {
    return resolveLocalImagePathInput(fromProxyUrl);
  }

  const photosRoot = path.resolve([PHOTOS_ROOT].join(""));
  const directResolved = path.resolve(trimmed);

  if (isPathUnderRoot(directResolved, photosRoot)) {
    return directResolved;
  }

  const withoutLeadingSeparators = trimmed.replace(/^[\\/]+/, "");
  const underPhotosRoot = path.resolve(photosRoot, withoutLeadingSeparators);
  if (isPathUnderRoot(underPhotosRoot, photosRoot)) {
    return underPhotosRoot;
  }

  return directResolved;
}

async function tryMaterializeLocalImageFromSupabase(
  resolvedPath: string,
  hints: { storagePath?: string | null; taskId?: string | null }
): Promise<boolean> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !supabaseKey) {
    return false;
  }

  const photosRoot = path.resolve([PHOTOS_ROOT].join(""));
  if (!isPathUnderRoot(resolvedPath, photosRoot)) {
    return false;
  }

  const fileName = path.basename(resolvedPath);
  const relativePath = path.relative(photosRoot, resolvedPath);
  const candidatePaths = Array.from(
    new Set(
      [
        hints.storagePath?.trim(),
        sanitizeStoragePath(relativePath.split(path.sep).join("/")),
        hints.taskId?.trim() ? sanitizeStoragePath(`${hints.taskId.trim()}/3_Merged/${fileName}`) : null,
      ].filter((value): value is string => Boolean(value?.trim()))
    )
  );

  if (candidatePaths.length === 0) {
    return false;
  }

  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

  for (const storagePath of candidatePaths) {
    const { data, error } = await supabase.storage.from(SUPABASE_FINALS_BUCKET).download(storagePath);
    if (error || !data) {
      console.warn("[sharp-edit] Supabase download miss", { storagePath, error: error?.message });
      continue;
    }

    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    fs.writeFileSync(resolvedPath, Buffer.from(await data.arrayBuffer()));
    console.log("[sharp-edit] Materialized local image from Supabase storage", {
      storagePath,
      resolvedPath,
    });
    return true;
  }

  return false;
}

async function resolveSourceImagePath(
  imagePath: string,
  hints: { storagePath?: string | null; taskId?: string | null }
): Promise<string> {
  const resolved = resolveLocalImagePathInput(imagePath);
  const rootResolved = path.resolve([PHOTOS_ROOT].join(""));
  if (!isPathUnderRoot(resolved, rootResolved)) {
    console.error("[sharp-edit] Failing because image path is outside PHOTOS_ROOT", {
      input: imagePath,
      resolved,
      photosRoot: rootResolved,
    });
    throw new Error("Access denied.");
  }

  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    return resolved;
  }

  const materialized = await tryMaterializeLocalImageFromSupabase(resolved, hints);
  if (materialized && fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    return resolved;
  }

  console.error("[sharp-edit] Failing because image file not found locally or in Supabase storage", {
    input: imagePath,
    resolved,
    hints,
  });
  throw new Error(`Image not found. attempted_local_path=${resolved}`);
}

function resolveAndValidateMaskPath(maskPath: string): string {
  const resolved = resolveLocalImagePathInput(maskPath);
  const allowedRoots = [
    path.resolve([PHOTOS_ROOT].join("")),
    path.resolve([COMFY_OUTPUT_DIR].join("")),
  ];
  if (!allowedRoots.some((root) => isPathUnderRoot(resolved, root))) {
    console.error("[sharp-edit] Failing because mask path is outside allowed roots", {
      input: maskPath,
      resolved,
      allowedRoots,
    });
    throw new Error("Access denied.");
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    console.error("[sharp-edit] Failing because mask file not found", {
      input: maskPath,
      resolved,
    });
    throw new Error(`Mask not found. attempted_local_path=${resolved}`);
  }
  return resolved;
}

function normalizeOptionalMaskPath(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseAdjustmentValue(value: unknown, name: string, fallback: number): number {
  if (value == null || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a finite number.`);
  }
  return parsed;
}

function buildEditedOutputPath(sourcePath: string): string {
  const ext = path.extname(sourcePath);
  const stem = path.basename(sourcePath, ext);
  return path.join(path.dirname(sourcePath), `${stem}_edited.jpg`);
}

function quotePath(filePath: string): string {
  return `"${filePath.replace(/"/g, '\\"')}"`;
}

function buildImageMagickEditArgs(options: AdjustmentOptions): string {
  const adjustments: string[] = [];

  if (options.saturation !== 1 || options.brightness !== 1 || options.hue !== 0) {
    adjustments.push(
      `-modulate ${options.brightness * 100},${options.saturation * 100},${(options.hue / 360) * 100 + 100}`
    );
  }

  if (options.blur > 0) {
    adjustments.push(`-blur 0x${options.blur}`);
  }

  if (options.contrast !== 1) {
    adjustments.push(`-sigmoidal-contrast ${Math.abs((options.contrast - 1) * 10)}x50%`);
  }

  if (options.shadows !== 0) {
    adjustments.push(`+sigmoidal-contrast ${Math.abs(options.shadows)}x0%`);
  }

  if (options.highlights !== 0) {
    adjustments.push(`+sigmoidal-contrast ${Math.abs(options.highlights)}x100%`);
  }

  return adjustments.join(" ");
}

type SharpEditBody = {
  absoluteLocalPath?: unknown;
  maskPath?: unknown;
  storagePath?: unknown;
  taskId?: unknown;
  brightness?: unknown;
  saturation?: unknown;
  hue?: unknown;
  contrast?: unknown;
  blur?: unknown;
  shadows?: unknown;
  highlights?: unknown;
} | null;

export async function POST(request: Request) {
  const body: SharpEditBody = await request.json().catch((error) => {
    console.error("[sharp-edit] Failing because request body JSON could not be parsed", error);
    return null;
  }) as SharpEditBody;

  try {
    if (!body) {
      console.error("[sharp-edit] Failing because request body is missing or invalid JSON");
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const absoluteLocalPath =
      typeof body.absoluteLocalPath === "string" ? body.absoluteLocalPath.trim() : "";
    const maskPath = normalizeOptionalMaskPath(body.maskPath);
    const storagePathHint = typeof body.storagePath === "string" ? body.storagePath.trim() : "";
    const taskIdHint = typeof body.taskId === "string" ? body.taskId.trim() : "";

    if (!absoluteLocalPath) {
      console.error("[sharp-edit] Failing because absoluteLocalPath is missing", body);
      return NextResponse.json({ error: "absoluteLocalPath is required." }, { status: 400 });
    }

    const adjustments: AdjustmentOptions = {
      brightness: parseAdjustmentValue(body.brightness, "brightness", 1),
      saturation: parseAdjustmentValue(body.saturation, "saturation", 1),
      hue: parseAdjustmentValue(body.hue, "hue", 0),
      contrast: parseAdjustmentValue(body.contrast, "contrast", 1),
      blur: parseAdjustmentValue(body.blur, "blur", 0),
      shadows: parseAdjustmentValue(body.shadows, "shadows", 0),
      highlights: parseAdjustmentValue(body.highlights, "highlights", 0),
    };

    console.log("[sharp-edit] received shadows/highlights:", body.shadows, body.highlights);
    console.log("[sharp-edit] parsed adjustments:", adjustments);
    console.log("[sharp-edit] absoluteLocalPath input:", absoluteLocalPath);
    console.log("[sharp-edit] maskPath input:", maskPath);

    const sourcePath = await resolveSourceImagePath(absoluteLocalPath, {
      storagePath: storagePathHint || null,
      taskId: taskIdHint || null,
    });
    const outputPath = buildEditedOutputPath(sourcePath);
    const resolvedMaskPath = maskPath ? resolveAndValidateMaskPath(maskPath) : null;
    const editArgs = buildImageMagickEditArgs(adjustments);

    const quotedSource = quotePath(sourcePath);
    const quotedOutput = quotePath(outputPath);
    const cmd = resolvedMaskPath
      ? `magick ${quotedSource} \\( ${quotedSource} ${editArgs} \\) ${quotePath(resolvedMaskPath)} -composite ${quotedOutput}`
      : `magick ${quotedSource} ${editArgs} ${quotedOutput}`;

    console.log("[sharp-edit] resolved sourcePath:", sourcePath);
    console.log("Executing IM Command:", cmd);

    await execAsync(cmd, {
      maxBuffer: 16 * 1024 * 1024,
    });

    return NextResponse.json({
      success: true,
      outputPath,
    });
  } catch (error) {
    const message =
      error instanceof Error && "stderr" in error && typeof error.stderr === "string" && error.stderr.trim()
        ? error.stderr.trim()
        : error instanceof Error
          ? error.message
          : "Failed to apply image edit.";

    console.error("[sharp-edit] request failed:", message, {
      body,
      error,
    });

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
