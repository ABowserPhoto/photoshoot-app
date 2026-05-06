import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

import { PHOTOS_ROOT } from "@/lib/photosPaths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  ".nef",
]);

function isImageFile(name: string): boolean {
  return IMAGE_EXT.has(path.extname(name).toLowerCase());
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const localFolderName = searchParams.get("local_folder_name")?.trim() ?? "";
  if (!localFolderName) {
    return NextResponse.json({ error: "local_folder_name is required." }, { status: 400 });
  }
  if (localFolderName.includes("..") || /[<>:"|?*]/.test(localFolderName)) {
    return NextResponse.json({ error: "Invalid local_folder_name." }, { status: 400 });
  }

  const rawDir = path.join(PHOTOS_ROOT, localFolderName, "1_RAW");
  const resolvedRaw = path.resolve(rawDir);
  const allowedRoot = path.resolve(PHOTOS_ROOT);
  if (!resolvedRaw.toLowerCase().startsWith(allowedRoot.toLowerCase() + path.sep)) {
    return NextResponse.json({ error: "Invalid path." }, { status: 403 });
  }

  if (!fs.existsSync(resolvedRaw)) {
    return NextResponse.json({ thumbnailUrl: null });
  }

  const firstImage = fs
    .readdirSync(resolvedRaw, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isImageFile(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))[0];

  if (!firstImage) {
    return NextResponse.json({ thumbnailUrl: null });
  }

  const filePath = path.join(resolvedRaw, firstImage);
  const thumbnailUrl = `/api/local-image?filepath=${encodeURIComponent(filePath)}`;
  return NextResponse.json({ thumbnailUrl });
}
