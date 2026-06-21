import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { fetchWithTimeout } from "@/lib/server/fetchWithTimeout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMFY_BASE_URL = process.env.COMFYUI_BASE_URL?.trim() || "http://127.0.0.1:8188";
const COMFY_DEFAULT_ROOT = process.env.COMFYUI_PATH?.trim() || "C:/ComfyUI_windows_portable/ComfyUI";
const COMFY_OUTPUT_DIR = process.env.COMFYUI_OUTPUT_DIR?.trim() || path.join(COMFY_DEFAULT_ROOT, "output");
const MASK_SAVE_IMAGE_NODE_ID = "3";

type ComfyOutputImage = {
  filename?: string;
  subfolder?: string;
  type?: string;
};

type ComfyHistoryEntry = {
  outputs?: Record<string, { images?: ComfyOutputImage[] }>;
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const promptId = searchParams.get("prompt_id")?.trim() ?? "";
    if (!promptId) {
      return NextResponse.json({ error: "prompt_id is required." }, { status: 400 });
    }

    const historyUrl = `${COMFY_BASE_URL.replace(/\/$/, "")}/history/${encodeURIComponent(promptId)}`;
    const historyResponse = await fetchWithTimeout(
      historyUrl,
      { cache: "no-store" },
      15_000
    );
    if (!historyResponse.ok) {
      if (historyResponse.status === 404) {
        return NextResponse.json({ status: "processing" });
      }
      return NextResponse.json(
        { error: `Failed to fetch ComfyUI history (${historyResponse.status}).` },
        { status: 502 }
      );
    }

    const data = (await historyResponse.json().catch(() => null)) as Record<string, ComfyHistoryEntry> | null;
    if (!data || Object.keys(data).length === 0) {
      return NextResponse.json({ status: "processing" });
    }

    const entry = data[promptId];
    if (!entry?.outputs) {
      return NextResponse.json({ status: "processing" });
    }

    const saveImageOutput = entry.outputs[MASK_SAVE_IMAGE_NODE_ID];
    const outputImage = saveImageOutput?.images?.[0];
    const filename = outputImage?.filename?.trim() ?? "";
    if (!filename || !outputImage) {
      return NextResponse.json({ status: "processing" });
    }

    const outputRoot = path.resolve(COMFY_OUTPUT_DIR);
    const maskPath = path.resolve(outputRoot, (outputImage.subfolder ?? "").trim(), path.basename(filename));
    if (!maskPath.toLowerCase().startsWith(outputRoot.toLowerCase() + path.sep)) {
      return NextResponse.json({ error: "Invalid ComfyUI output path." }, { status: 400 });
    }
    if (!fs.existsSync(maskPath) || !fs.statSync(maskPath).isFile()) {
      return NextResponse.json({ status: "processing" });
    }

    return NextResponse.json({
      status: "done",
      maskPath,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to check mask generation status.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
