import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

import { PHOTOS_ROOT } from "@/lib/photosPaths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXT_TO_CONTENT_TYPE: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawPath = searchParams.get("path")?.trim() ?? searchParams.get("filepath")?.trim() ?? "";
  if (!rawPath) {
    return NextResponse.json({ error: "path query parameter is required." }, { status: 400 });
  }

  const absolutePath = path.resolve(rawPath);
  const rootResolved = path.resolve(PHOTOS_ROOT);
  if (!absolutePath.toLowerCase().startsWith(rootResolved.toLowerCase() + path.sep)) {
    return NextResponse.json({ error: "Access denied." }, { status: 403 });
  }

  const ext = path.extname(absolutePath).toLowerCase();
  const contentType = EXT_TO_CONTENT_TYPE[ext];
  if (!contentType) {
    return NextResponse.json({ error: "Unsupported image type." }, { status: 400 });
  }
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    return NextResponse.json({ error: "Local image not found.", absolutePath }, { status: 404 });
  }

  const fileBuffer = fs.readFileSync(absolutePath);
  return new NextResponse(fileBuffer, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=60",
    },
  });
}
