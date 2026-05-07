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

  const mergedDir = path.join(PHOTOS_ROOT, localFolderName, "3_merge");
  const resolvedMerged = path.resolve(mergedDir);
  const allowedRoot = path.resolve(PHOTOS_ROOT);
  if (!resolvedMerged.toLowerCase().startsWith(allowedRoot.toLowerCase() + path.sep)) {
    return NextResponse.json({ error: "Invalid path." }, { status: 403 });
  }

  if (!fs.existsSync(resolvedMerged)) {
    return NextResponse.json({ files: [] as string[], mergedDir: resolvedMerged });
  }

  const entries = fs.readdirSync(resolvedMerged, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && isImageFile(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

  return NextResponse.json({ files, mergedDir: resolvedMerged });
}
