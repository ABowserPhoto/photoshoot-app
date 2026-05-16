import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMFY_BASE_URL = process.env.COMFYUI_BASE_URL?.trim() || "http://127.0.0.1:8188";
const COMFY_DEFAULT_ROOT = process.env.COMFYUI_PATH?.trim() || "C:/ComfyUI_windows_portable/ComfyUI";
const COMFY_OUTPUT_DIR = process.env.COMFYUI_OUTPUT_DIR?.trim() || path.join(COMFY_DEFAULT_ROOT, "output");

type ComfyOutputImage = {
  filename?: string;
  subfolder?: string;
  type?: string;
};

type ComfyOutputNode = {
  images?: ComfyOutputImage[];
  gifs?: ComfyOutputImage[];
};

type ComfyHistoryEntry = {
  outputs?: Record<string, ComfyOutputNode>;
};

function findOutputImage(entry: ComfyHistoryEntry): ComfyOutputImage | null {
  const outputs = entry.outputs ?? {};
  for (const node of Object.values(outputs)) {
    const imageCandidate = node.images?.find((item) => Boolean(item?.filename));
    if (imageCandidate?.filename) {
      return imageCandidate;
    }
    const gifCandidate = node.gifs?.find((item) => Boolean(item?.filename));
    if (gifCandidate?.filename) {
      return gifCandidate;
    }
  }
  return null;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const promptId = searchParams.get("prompt_id")?.trim() ?? "";
    if (!promptId) {
      return NextResponse.json({ error: "prompt_id is required." }, { status: 400 });
    }

    const historyUrl = `${COMFY_BASE_URL.replace(/\/$/, "")}/history/${encodeURIComponent(promptId)}`;
    const historyResponse = await fetch(historyUrl, { cache: "no-store" });
    if (!historyResponse.ok) {
      if (historyResponse.status === 404) {
        return NextResponse.json({ status: "processing" });
      }
      return NextResponse.json(
        { error: `Failed to fetch ComfyUI history (${historyResponse.status}).` },
        { status: 502 }
      );
    }

    const historyPayload = (await historyResponse.json().catch(() => null)) as
      | Record<string, ComfyHistoryEntry>
      | null;
    const entry = historyPayload?.[promptId];
    if (!entry || !entry.outputs || Object.keys(entry.outputs).length === 0) {
      return NextResponse.json({ status: "processing" });
    }

    const outputImage = findOutputImage(entry);
    if (!outputImage?.filename) {
      return NextResponse.json({ status: "processing" });
    }

    const outputRoot = path.resolve(COMFY_OUTPUT_DIR);
    const sourcePath = path.resolve(
      outputRoot,
      (outputImage.subfolder ?? "").trim(),
      path.basename(outputImage.filename)
    );
    if (!sourcePath.toLowerCase().startsWith(outputRoot.toLowerCase() + path.sep)) {
      return NextResponse.json({ error: "Invalid ComfyUI output path." }, { status: 400 });
    }
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      return NextResponse.json({ status: "processing" });
    }

    const tempDir = path.join(process.cwd(), "public", "temp_ai");
    fs.mkdirSync(tempDir, { recursive: true });
    const copiedName = `${promptId}_${path.basename(outputImage.filename)}`;
    const destinationPath = path.join(tempDir, copiedName);
    fs.copyFileSync(sourcePath, destinationPath);

    return NextResponse.json({
      status: "completed",
      previewUrl: `/temp_ai/${encodeURIComponent(copiedName)}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to check ComfyUI job status.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
