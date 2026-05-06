import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

import { PHOTOS_ROOT } from "@/lib/photosPaths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_ROOT = path.resolve(PHOTOS_ROOT);

function contentTypeForFile(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".tif":
    case ".tiff":
      return "image/tiff";
    case ".bmp":
      return "image/bmp";
    default:
      return "application/octet-stream";
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("filepath");
  if (!raw || !raw.trim()) {
    return NextResponse.json({ error: "filepath query parameter is required." }, { status: 400 });
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(raw.trim());
  } catch {
    return NextResponse.json({ error: "Invalid filepath encoding." }, { status: 400 });
  }

  const resolved = path.resolve(decoded);
  const rel = path.relative(ALLOWED_ROOT, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return NextResponse.json({ error: "Access denied: path must be under D:\\Photos_2026." }, { status: 403 });
  }

  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  const buffer = fs.readFileSync(resolved);
  const contentType = contentTypeForFile(resolved);
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=60",
    },
  });
}
