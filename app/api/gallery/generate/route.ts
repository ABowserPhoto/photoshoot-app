import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import sharp from "sharp";

import {
  chunkFiles,
  DEFAULT_BRACKET_SIZE,
  parseBracketSize,
  readNaturallySortedImageFiles,
  resolveLocalFolderName,
  resolveTaskDir,
} from "@/app/api/gallery/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GalleryItem = {
  chunkIndex: number;
  middleFilename: string;
  previewUrl: string;
};

const PREVIEWS_DIR = path.join(process.cwd(), "public", "previews");
const WATERMARK_PATH = path.join(process.cwd(), "public", "watermark.png");

function safePreviewStem(localFolderName: string, middleFilename: string, chunkIndex: number): string {
  const stem = `${localFolderName}_${chunkIndex}_${path.basename(middleFilename, path.extname(middleFilename))}`;
  return stem.replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function createProxyPreview(
  rawDir: string,
  localFolderName: string,
  middleFilename: string,
  chunkIndex: number
): Promise<string> {
  fs.mkdirSync(PREVIEWS_DIR, { recursive: true });
  const sourcePath = path.join(rawDir, middleFilename);
  const previewName = `${safePreviewStem(localFolderName, middleFilename, chunkIndex)}.jpg`;
  const outputPath = path.join(PREVIEWS_DIR, previewName);

  // Materialize resized pixels first so overlay sizing is based on final dimensions.
  const resizedBuffer = await sharp(sourcePath)
    .resize({ width: 1080, fit: "inside", withoutEnlargement: true })
    .toBuffer();

  const resizedMetadata = await sharp(resizedBuffer).metadata();
  const baseWidth = resizedMetadata.width;
  const baseHeight = resizedMetadata.height;
  if (!baseWidth || !baseHeight) {
    throw new Error(`Could not read resized image dimensions for "${middleFilename}".`);
  }

  if (!fs.existsSync(WATERMARK_PATH)) {
    throw new Error(`Watermark file not found at "${WATERMARK_PATH}".`);
  }

  const watermarkImage = sharp(WATERMARK_PATH, { failOn: "none" });
  const watermarkMetadata = await watermarkImage.metadata();
  if (!watermarkMetadata.width || !watermarkMetadata.height) {
    throw new Error("Could not read watermark dimensions.");
  }

  const watermarkBuffer = await sharp(WATERMARK_PATH, { failOn: "none" })
    .resize({
      width: baseWidth,
      height: baseHeight,
      fit: "fill",
    })
    .ensureAlpha(0.2)
    .png()
    .toBuffer();

  await sharp(resizedBuffer)
    .composite([{ input: watermarkBuffer, blend: "soft-light" }])
    .jpeg({ quality: 45, mozjpeg: true, chromaSubsampling: "4:2:0" })
    .toFile(outputPath);

  return `/previews/${previewName}`;
}

async function generateGallery(localFolderName: string, bracketSize: number) {
  const rawDir = resolveTaskDir(localFolderName, "1_Raw");
  const sortedFiles = readNaturallySortedImageFiles(rawDir);
  const chunks = chunkFiles(sortedFiles, bracketSize);

  const gallery: GalleryItem[] = [];
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex];
    const middleIndex = Math.floor(chunk.length / 2);
    const middleFilename = chunk[middleIndex];
    const previewUrl = await createProxyPreview(rawDir, localFolderName, middleFilename, chunkIndex);
    gallery.push({
      chunkIndex,
      middleFilename,
      previewUrl,
    });
  }

  return {
    success: true,
    localFolderName,
    bracketSize,
    totalFiles: sortedFiles.length,
    totalChunks: chunks.length,
    gallery,
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const localFolderName = await resolveLocalFolderName({
      shootId: searchParams.get("shootId")?.trim() ?? "",
      localFolderName: searchParams.get("local_folder_name")?.trim() ?? "",
    });
    const bracketSize = parseBracketSize(searchParams.get("bracketSize"));
    return NextResponse.json(await generateGallery(localFolderName, bracketSize));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate gallery.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      local_folder_name?: string;
      shootId?: string;
      bracketSize?: number;
    };
    const localFolderName = await resolveLocalFolderName({
      shootId: typeof body.shootId === "string" ? body.shootId : "",
      localFolderName: typeof body.local_folder_name === "string" ? body.local_folder_name : "",
    });
    const bracketSize = parseBracketSize(body.bracketSize ?? DEFAULT_BRACKET_SIZE);
    return NextResponse.json(await generateGallery(localFolderName, bracketSize));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate gallery.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
