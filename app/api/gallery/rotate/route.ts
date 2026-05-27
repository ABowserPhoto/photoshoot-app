import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import sharp from "sharp";

import { resolveTaskDir } from "@/app/api/gallery/_shared";
import { sanitizeStoragePath } from "@/lib/sanitizeStoragePath.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_PREVIEWS_BUCKET = process.env.SUPABASE_PREVIEWS_BUCKET?.trim() || "previews";
const ROTATABLE_LOCAL_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"]);

type GalleryPreviewItem = {
  chunkIndex?: unknown;
  firstFilename?: unknown;
  middleFilename?: unknown;
  previewUrl?: unknown;
  storagePath?: unknown;
};

type RotateDirection = "cw" | "ccw";

function getSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) {
    return null;
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function rotateDegrees(direction: RotateDirection): number {
  return direction === "ccw" ? -90 : 90;
}

async function rotateBufferWithSharp(input: Buffer, direction: RotateDirection): Promise<Buffer> {
  return sharp(input).rotate(rotateDegrees(direction)).toBuffer();
}

async function rotateImageInPlaceWithSharp(filePath: string, direction: RotateDirection): Promise<void> {
  const inputBuffer = await fs.promises.readFile(filePath);
  const rotatedBuffer = await rotateBufferWithSharp(inputBuffer, direction);
  await fs.promises.writeFile(filePath, rotatedBuffer);
}

function getPreviewItemByChunk(itemsRaw: unknown, chunkIndex: number): {
  firstFilename: string;
  storagePath: string;
} | null {
  const items = Array.isArray(itemsRaw) ? itemsRaw : [];
  for (const item of items) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as GalleryPreviewItem;
    const rowChunk = Number(row.chunkIndex);
    if (!Number.isInteger(rowChunk) || rowChunk !== chunkIndex) {
      continue;
    }
    const firstFilename =
      typeof row.firstFilename === "string"
        ? row.firstFilename
        : typeof row.middleFilename === "string"
          ? row.middleFilename
          : "";
    const storagePath =
      typeof row.storagePath === "string" ? sanitizeStoragePath(row.storagePath) : "";
    if (!firstFilename || !storagePath) {
      return null;
    }
    return { firstFilename, storagePath };
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | { shootId?: unknown; chunkIndex?: unknown; direction?: unknown }
      | null;
    const shootId = typeof body?.shootId === "string" ? body.shootId.trim() : "";
    const chunkIndex = Number(body?.chunkIndex);
    const direction = body?.direction === "ccw" ? "ccw" : body?.direction === "cw" ? "cw" : null;
    if (!shootId) {
      return NextResponse.json({ error: "shootId is required." }, { status: 400 });
    }
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
      return NextResponse.json({ error: "chunkIndex must be a non-negative integer." }, { status: 400 });
    }
    if (!direction) {
      return NextResponse.json({ error: "direction must be 'cw' or 'ccw'." }, { status: 400 });
    }

    const supabase = getSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json({ error: "Supabase server credentials are not configured." }, { status: 503 });
    }

    const { data: task, error: fetchError } = await supabase
      .from("tasks")
      .select("id, local_folder_name, gallery_previews")
      .eq("id", shootId)
      .maybeSingle();
    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }
    if (!task) {
      return NextResponse.json({ error: "Task not found." }, { status: 404 });
    }

    const localFolderName =
      typeof task.local_folder_name === "string" ? task.local_folder_name.trim() : "";
    if (!localFolderName) {
      return NextResponse.json({ error: "Task is missing local_folder_name." }, { status: 400 });
    }

    const previewItem = getPreviewItemByChunk(task.gallery_previews?.items, chunkIndex);
    if (!previewItem) {
      return NextResponse.json({ error: "Gallery preview item not found for chunkIndex." }, { status: 404 });
    }

    const { firstFilename, storagePath } = previewItem;
    const rawDir = resolveTaskDir(localFolderName, "1_Raw");
    const sourcePath = path.join(rawDir, firstFilename);
    const sourceExt = path.extname(firstFilename).toLowerCase();

    let rotatedPreviewBuffer: Buffer;
    let rotatedLocalSource = false;

    if (fs.existsSync(sourcePath) && fs.statSync(sourcePath).isFile() && ROTATABLE_LOCAL_EXTENSIONS.has(sourceExt)) {
      await rotateImageInPlaceWithSharp(sourcePath, direction);
      rotatedLocalSource = true;
    }

    const { data: existingPreview, error: downloadError } = await supabase.storage
      .from(SUPABASE_PREVIEWS_BUCKET)
      .download(storagePath);
    if (downloadError || !existingPreview) {
      return NextResponse.json(
        { error: `Failed to download preview object for rotation: ${downloadError?.message ?? "not found"}` },
        { status: 502 }
      );
    }

    const existingPreviewBuffer = Buffer.from(await existingPreview.arrayBuffer());
    rotatedPreviewBuffer = await rotateBufferWithSharp(existingPreviewBuffer, direction);

    const { error: uploadError } = await supabase.storage
      .from(SUPABASE_PREVIEWS_BUCKET)
      .upload(storagePath, rotatedPreviewBuffer, {
        upsert: true,
        contentType: "image/jpeg",
        cacheControl: "3600",
      });
    if (uploadError) {
      return NextResponse.json({ error: `Failed to upload rotated preview: ${uploadError.message}` }, { status: 502 });
    }

    const { data: publicData } = supabase.storage.from(SUPABASE_PREVIEWS_BUCKET).getPublicUrl(storagePath);
    const refreshedPreviewUrl = `${publicData?.publicUrl ?? ""}${(publicData?.publicUrl ?? "").includes("?") ? "&" : "?"}t=${Date.now()}`;

    return NextResponse.json({
      success: true,
      chunkIndex,
      firstFilename,
      storagePath,
      previewUrl: refreshedPreviewUrl,
      rotatedLocalSource,
      direction,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to rotate gallery image.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
