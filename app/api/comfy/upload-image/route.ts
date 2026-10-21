import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMFY_DEFAULT_ROOT = process.env.COMFYUI_PATH?.trim() || "C:/ComfyUI_windows_portable/ComfyUI";
const COMFY_INPUT_DIR = process.env.COMFYUI_INPUT_DIR?.trim() || path.join(COMFY_DEFAULT_ROOT, "input");

function sanitizeUploadName(rawName: string, mimeType: string): string {
  const normalized = rawName.trim().replace(/\\/g, "/");
  const base = normalized.split("/").filter(Boolean).at(-1) ?? "";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "");
  const hasExt = /\.[a-z0-9]+$/i.test(cleaned);
  if (cleaned && hasExt && !cleaned.includes("..")) {
    return cleaned;
  }
  const ext = mimeType.includes("png")
    ? "png"
    : mimeType.includes("webp")
      ? "webp"
      : mimeType.includes("gif")
        ? "gif"
        : "jpg";
  const stem = cleaned.replace(/\.[^.]*$/, "") || `upload_image_${Date.now()}`;
  return `${stem}.${ext}`;
}

export async function POST(request: Request) {
  try {
    const incoming = await request.formData();
    const image = incoming.get("image");
    const isBlob = typeof Blob !== "undefined" && image instanceof Blob;
    if (!isBlob || image.size === 0) {
      return NextResponse.json({ error: "An image file is required to upload to ComfyUI." }, { status: 400 });
    }

    const bytes = Buffer.from(await image.arrayBuffer());
    if (bytes.length === 0) {
      return NextResponse.json({ error: "The uploaded image is empty." }, { status: 400 });
    }

    const mimeType = image.type || "application/octet-stream";
    const rawName = image instanceof File && image.name.trim() ? image.name : "upload_image.png";
    const uploadName = sanitizeUploadName(rawName, mimeType);

    // Write directly into ComfyUI's input folder. Forwarding multipart through
    // undici/Node fetch to ComfyUI's /upload/image has been returning bare HTTP 400
    // with an empty body even when the filename and byte length look valid.
    const inputDir = path.resolve(COMFY_INPUT_DIR);
    fs.mkdirSync(inputDir, { recursive: true });
    const destination = path.join(inputDir, uploadName);
    if (!destination.toLowerCase().startsWith(inputDir.toLowerCase() + path.sep)) {
      return NextResponse.json({ error: "Invalid upload filename." }, { status: 400 });
    }
    fs.writeFileSync(destination, bytes);

    console.info("[comfy/upload-image] wrote", {
      uploadName,
      byteLength: bytes.length,
      mimeType,
      destination,
    });

    return NextResponse.json({ name: uploadName });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to upload the image to ComfyUI.";
    console.error("[comfy/upload-image]", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
