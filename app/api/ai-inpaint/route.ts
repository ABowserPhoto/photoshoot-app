import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { resolveSourceImagePath } from "@/lib/comfy/resolveSourceImagePath";
import { PHOTOS_ROOT } from "@/lib/photosPaths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMFY_BASE_URL = process.env.COMFYUI_BASE_URL?.trim() || "http://127.0.0.1:8188";
const COMFY_DEFAULT_ROOT = process.env.COMFYUI_PATH?.trim() || "C:/ComfyUI_windows_portable/ComfyUI";
const COMFY_OUTPUT_DIR = process.env.COMFYUI_OUTPUT_DIR?.trim() || path.join(COMFY_DEFAULT_ROOT, "output");
const SAVE_IMAGE_NODE_ID = "4";
const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 180_000;

type WorkflowNode = {
  inputs?: Record<string, unknown>;
  class_type?: string;
  _meta?: { title?: string };
};

type ComfyOutputImage = {
  filename?: string;
  subfolder?: string;
  type?: string;
};

type ComfyHistoryEntry = {
  outputs?: Record<string, { images?: ComfyOutputImage[] }>;
};

type ComfyUploadResponse = {
  name?: string;
  subfolder?: string;
  type?: string;
};

function normalizeErrorMessage(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const msg = record.message;
    if (typeof msg === "string" && msg.trim()) {
      return msg;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function loadDrawMaskRemoveWorkflowTemplate(): Record<string, WorkflowNode> {
  const workflowPath = path.join(process.cwd(), "lib", "comfy", "draw_mask_remove_workflow.json");
  const raw = fs.readFileSync(workflowPath, "utf8");
  return JSON.parse(raw) as Record<string, WorkflowNode>;
}

function resolveAndValidateAbsoluteImagePath(imagePath: string): string {
  const resolved = path.resolve(imagePath.trim());
  const rootResolved = path.resolve(PHOTOS_ROOT);
  if (!resolved.toLowerCase().startsWith(rootResolved.toLowerCase() + path.sep)) {
    throw new Error("Access denied.");
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`Image not found. attempted_local_path=${resolved}`);
  }
  return resolved;
}

function resolveLocalSourcePath(
  sourceImagePath: string,
  filename: string,
  taskId: string
): string {
  const trimmedPath = sourceImagePath.trim();
  if (trimmedPath) {
    return resolveAndValidateAbsoluteImagePath(trimmedPath);
  }
  if (!filename.trim()) {
    throw new Error("sourceImagePath or filename is required.");
  }
  return resolveSourceImagePath(filename, taskId);
}

function decodeMaskBase64(maskBase64: string): Buffer {
  const trimmed = maskBase64.trim();
  if (!trimmed) {
    throw new Error("maskBase64 is required.");
  }
  const dataUrlMatch = /^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/i.exec(trimmed);
  const base64Payload = dataUrlMatch?.[1] ?? trimmed;
  const buffer = Buffer.from(base64Payload, "base64");
  if (buffer.length === 0) {
    throw new Error("maskBase64 is invalid or empty.");
  }
  return buffer;
}

function patchWorkflowImageNodes(
  workflow: Record<string, WorkflowNode>,
  mainImageFilename: string,
  maskImageFilename: string
): void {
  let mainLoadNode: WorkflowNode | null = null;
  let maskLoadNode: WorkflowNode | null = null;

  for (const node of Object.values(workflow)) {
    if (!node.inputs || typeof node.inputs.image !== "string") {
      continue;
    }
    if (node.class_type === "LoadImage") {
      mainLoadNode = node;
    } else if (node.class_type === "LoadImageMask") {
      maskLoadNode = node;
    }
  }

  if (!mainLoadNode?.inputs) {
    throw new Error('Workflow template is missing a LoadImage node with "inputs.image".');
  }
  if (!maskLoadNode?.inputs) {
    throw new Error('Workflow template is missing a LoadImageMask node with "inputs.image".');
  }

  mainLoadNode.inputs.image = mainImageFilename;
  maskLoadNode.inputs.image = maskImageFilename;
}

async function uploadImageToComfy(buffer: Buffer, filename: string): Promise<string> {
  const formData = new FormData();
  const blob = new Blob([buffer], { type: "application/octet-stream" });
  formData.append("image", blob, filename);
  formData.append("overwrite", "true");
  formData.append("type", "input");

  const uploadUrl = `${COMFY_BASE_URL.replace(/\/$/, "")}/upload/image`;
  const response = await fetch(uploadUrl, {
    method: "POST",
    body: formData,
  });
  const responseText = await response.text();
  let payload: ComfyUploadResponse | null = null;
  try {
    payload = JSON.parse(responseText) as ComfyUploadResponse;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(
      normalizeErrorMessage(payload, `ComfyUI image upload failed (${response.status}).`)
    );
  }

  const uploadedName = payload?.name?.trim() ?? "";
  if (!uploadedName) {
    throw new Error("ComfyUI image upload did not return a filename.");
  }
  return uploadedName;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findOutputImage(entry: ComfyHistoryEntry): ComfyOutputImage | null {
  const saveNodeOutput = entry.outputs?.[SAVE_IMAGE_NODE_ID];
  const saveNodeImage = saveNodeOutput?.images?.find((item) => Boolean(item?.filename));
  if (saveNodeImage?.filename) {
    return saveNodeImage;
  }

  for (const node of Object.values(entry.outputs ?? {})) {
    const imageCandidate = node.images?.find((item) => Boolean(item?.filename));
    if (imageCandidate?.filename) {
      return imageCandidate;
    }
  }
  return null;
}

async function waitForComfyOutput(promptId: string): Promise<ComfyOutputImage> {
  const historyUrl = `${COMFY_BASE_URL.replace(/\/$/, "")}/history/${encodeURIComponent(promptId)}`;
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const historyResponse = await fetch(historyUrl, { cache: "no-store" });
    if (!historyResponse.ok) {
      if (historyResponse.status !== 404) {
        throw new Error(`Failed to fetch ComfyUI history (${historyResponse.status}).`);
      }
    } else {
      const historyPayload = (await historyResponse.json().catch(() => null)) as
        | Record<string, ComfyHistoryEntry>
        | null;
      const entry = historyPayload?.[promptId];
      const outputImage = entry?.outputs ? findOutputImage(entry) : null;
      if (outputImage?.filename) {
        return outputImage;
      }
    }
    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error("Object removal timed out after 3 minutes.");
}

async function fetchComfyViewImage(outputImage: ComfyOutputImage): Promise<Buffer> {
  const filename = outputImage.filename?.trim() ?? "";
  if (!filename) {
    throw new Error("ComfyUI output is missing a filename.");
  }

  const viewParams = new URLSearchParams({
    filename,
    subfolder: (outputImage.subfolder ?? "").trim(),
    type: (outputImage.type ?? "output").trim() || "output",
  });
  const viewUrl = `${COMFY_BASE_URL.replace(/\/$/, "")}/view?${viewParams.toString()}`;
  const viewResponse = await fetch(viewUrl, { cache: "no-store" });
  if (viewResponse.ok) {
    return Buffer.from(await viewResponse.arrayBuffer());
  }

  const outputRoot = path.resolve(COMFY_OUTPUT_DIR);
  const fallbackPath = path.resolve(outputRoot, (outputImage.subfolder ?? "").trim(), path.basename(filename));
  if (!fallbackPath.toLowerCase().startsWith(outputRoot.toLowerCase() + path.sep)) {
    throw new Error("Invalid ComfyUI output path.");
  }
  if (!fs.existsSync(fallbackPath) || !fs.statSync(fallbackPath).isFile()) {
    throw new Error(`Failed to fetch ComfyUI output image (${viewResponse.status}).`);
  }
  return fs.readFileSync(fallbackPath);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      sourceImagePath?: string;
      maskBase64?: string;
      filename?: string;
      taskId?: string;
      task_id?: string;
    };

    const sourceImagePath = typeof body.sourceImagePath === "string" ? body.sourceImagePath.trim() : "";
    const maskBase64 = typeof body.maskBase64 === "string" ? body.maskBase64.trim() : "";
    const filename = typeof body.filename === "string" ? body.filename.trim() : "";
    const taskId =
      (typeof body.taskId === "string" ? body.taskId.trim() : "") ||
      (typeof body.task_id === "string" ? body.task_id.trim() : "");

    if (!maskBase64) {
      return NextResponse.json({ error: "maskBase64 is required." }, { status: 400 });
    }

    const localSourcePath = resolveLocalSourcePath(sourceImagePath, filename, taskId);
    const sourceBuffer = fs.readFileSync(localSourcePath);
    const maskBuffer = decodeMaskBase64(maskBase64);

    const uniqueBase = `inpaint_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const sourceExt = path.extname(localSourcePath).toLowerCase() || ".jpg";
    const sourceUploadName = `${uniqueBase}_source${sourceExt}`;
    const maskUploadName = `${uniqueBase}_mask.png`;

    const [uploadedSourceName, uploadedMaskName] = await Promise.all([
      uploadImageToComfy(sourceBuffer, sourceUploadName),
      uploadImageToComfy(maskBuffer, maskUploadName),
    ]);

    const workflow = loadDrawMaskRemoveWorkflowTemplate();
    patchWorkflowImageNodes(workflow, uploadedSourceName, uploadedMaskName);

    const promptResponse = await fetch(`${COMFY_BASE_URL.replace(/\/$/, "")}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: workflow,
        client_id: randomUUID(),
      }),
    });

    const promptText = await promptResponse.text();
    let promptPayload: {
      prompt_id?: string;
      error?: unknown;
      detail?: unknown;
      message?: unknown;
    } | null = null;
    try {
      promptPayload = JSON.parse(promptText) as typeof promptPayload;
    } catch {
      promptPayload = null;
    }

    if (!promptResponse.ok) {
      return NextResponse.json(
        {
          error: normalizeErrorMessage(
            promptPayload?.message ?? promptPayload?.detail ?? promptPayload?.error ?? promptText,
            `ComfyUI request failed (${promptResponse.status}).`
          ),
        },
        { status: 502 }
      );
    }

    const promptId = promptPayload?.prompt_id?.trim() ?? "";
    if (!promptId) {
      return NextResponse.json({ error: "ComfyUI did not return a prompt_id." }, { status: 502 });
    }

    console.info(
      `[ai-inpaint] prompt_id=${promptId} source=${localSourcePath} comfy_source=${uploadedSourceName} comfy_mask=${uploadedMaskName}`
    );

    const outputImage = await waitForComfyOutput(promptId);
    const outputBuffer = await fetchComfyViewImage(outputImage);

    const tempDir = path.join(process.cwd(), "public", "temp_ai");
    fs.mkdirSync(tempDir, { recursive: true });
    const outputFilename = `${promptId}_${path.basename(outputImage.filename ?? "inpaint.png")}`;
    const destinationPath = path.join(tempDir, outputFilename);
    fs.writeFileSync(destinationPath, outputBuffer);

    return NextResponse.json({
      success: true,
      promptId,
      imageUrl: `/temp_ai/${encodeURIComponent(outputFilename)}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI inpaint failed.";
    console.error("[ai-inpaint]", message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
