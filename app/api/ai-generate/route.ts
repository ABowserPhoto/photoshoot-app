import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { resolveSourceImagePath } from "@/lib/comfy/resolveSourceImagePath";
import { PHOTOS_ROOT } from "@/lib/photosPaths";
import { fetchWithTimeout } from "@/lib/server/fetchWithTimeout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

const COMFY_BASE_URL = process.env.COMFYUI_BASE_URL?.trim() || "http://127.0.0.1:8188";
const COMFY_DEFAULT_ROOT = process.env.COMFYUI_PATH?.trim() || "C:/ComfyUI_windows_portable/ComfyUI";
const COMFY_OUTPUT_DIR = process.env.COMFYUI_OUTPUT_DIR?.trim() || path.join(COMFY_DEFAULT_ROOT, "output");

const IMAGE_POLL_INTERVAL_MS = 2500;
const IMAGE_POLL_TIMEOUT_MS = 180_000;
const VIDEO_POLL_INTERVAL_MS = 5000;
const VIDEO_POLL_TIMEOUT_MS = 600_000;

type GenerateMode = "text2image" | "text2video" | "image2video";

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

type ComfyOutputNode = {
  images?: ComfyOutputImage[];
  gifs?: ComfyOutputImage[];
};

type ComfyHistoryEntry = {
  outputs?: Record<string, ComfyOutputNode>;
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

function roundToMultipleOf8(value: number): number {
  if (!Number.isFinite(value)) {
    return 512;
  }
  return Math.max(8, Math.round(value / 8) * 8);
}

function randomSeed(): number {
  return Math.floor(100_000_000_000_000 + Math.random() * 900_000_000_000_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadWorkflow(relativePath: string): Record<string, WorkflowNode> {
  const workflowPath = path.join(process.cwd(), "lib", "comfy", relativePath);
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

async function uploadImageToComfy(buffer: Buffer, filename: string): Promise<string> {
  const formData = new FormData();
  const blob = new Blob([buffer], { type: "application/octet-stream" });
  formData.append("image", blob, filename);
  formData.append("overwrite", "true");
  formData.append("type", "input");

  const uploadUrl = `${COMFY_BASE_URL.replace(/\/$/, "")}/upload/image`;
  const response = await fetchWithTimeout(
    uploadUrl,
    {
      method: "POST",
      body: formData,
    },
    20_000
  );
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

async function submitComfyPrompt(workflow: Record<string, WorkflowNode>): Promise<string> {
  const response = await fetchWithTimeout(
    `${COMFY_BASE_URL.replace(/\/$/, "")}/prompt`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: workflow,
        client_id: randomUUID(),
      }),
    },
    20_000
  );

  const responseText = await response.text();
  let payload: {
    prompt_id?: string;
    error?: unknown;
    detail?: unknown;
    message?: unknown;
  } | null = null;
  try {
    payload = JSON.parse(responseText) as typeof payload;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(
      normalizeErrorMessage(
        payload?.message ?? payload?.detail ?? payload?.error ?? responseText,
        `ComfyUI request failed (${response.status}).`
      )
    );
  }

  const promptId = payload?.prompt_id?.trim() ?? "";
  if (!promptId) {
    throw new Error("ComfyUI did not return a prompt_id.");
  }
  return promptId;
}

function findWorkflowNodeIds(
  workflow: Record<string, WorkflowNode>,
  classType: string
): string[] {
  return Object.entries(workflow)
    .filter(([, node]) => node.class_type === classType)
    .map(([nodeId]) => nodeId);
}

function findOutputImage(entry: ComfyHistoryEntry): ComfyOutputImage | null {
  for (const node of Object.values(entry.outputs ?? {})) {
    const imageCandidate = node.images?.find((item) => Boolean(item?.filename));
    if (imageCandidate?.filename) {
      return imageCandidate;
    }
  }
  return null;
}

function findVideoOutput(
  entry: ComfyHistoryEntry,
  workflow: Record<string, WorkflowNode>
): ComfyOutputImage | null {
  const videoCombineIds = findWorkflowNodeIds(workflow, "VHS_VideoCombine");
  for (const nodeId of videoCombineIds) {
    const nodeOutput = entry.outputs?.[nodeId];
    const gifCandidate = nodeOutput?.gifs?.find((item) => Boolean(item?.filename));
    if (gifCandidate?.filename) {
      return gifCandidate;
    }
  }

  for (const node of Object.values(entry.outputs ?? {})) {
    const gifCandidate = node.gifs?.find((item) => Boolean(item?.filename));
    if (gifCandidate?.filename) {
      return gifCandidate;
    }
  }

  for (const node of Object.values(entry.outputs ?? {})) {
    const webpCandidate = node.images?.find((item) => {
      const name = item.filename?.toLowerCase() ?? "";
      return name.endsWith(".webp") || name.endsWith(".mp4");
    });
    if (webpCandidate?.filename) {
      return webpCandidate;
    }
  }

  return null;
}

async function fetchComfyViewBuffer(output: ComfyOutputImage): Promise<Buffer> {
  const filename = output.filename?.trim() ?? "";
  if (!filename) {
    throw new Error("ComfyUI output is missing a filename.");
  }

  const viewParams = new URLSearchParams({
    filename,
    subfolder: (output.subfolder ?? "").trim(),
    type: (output.type ?? "output").trim() || "output",
  });
  const viewUrl = `${COMFY_BASE_URL.replace(/\/$/, "")}/view?${viewParams.toString()}`;
  const viewResponse = await fetchWithTimeout(
    viewUrl,
    { cache: "no-store" },
    30_000
  );
  if (viewResponse.ok) {
    return Buffer.from(await viewResponse.arrayBuffer());
  }

  const outputRoot = path.resolve(COMFY_OUTPUT_DIR);
  const fallbackPath = path.resolve(outputRoot, (output.subfolder ?? "").trim(), path.basename(filename));
  if (!fallbackPath.toLowerCase().startsWith(outputRoot.toLowerCase() + path.sep)) {
    throw new Error("Invalid ComfyUI output path.");
  }
  if (!fs.existsSync(fallbackPath) || !fs.statSync(fallbackPath).isFile()) {
    throw new Error(`Failed to fetch ComfyUI output (${viewResponse.status}).`);
  }
  return fs.readFileSync(fallbackPath);
}

async function waitForComfyImageOutput(promptId: string): Promise<ComfyOutputImage> {
  const historyUrl = `${COMFY_BASE_URL.replace(/\/$/, "")}/history/${encodeURIComponent(promptId)}`;
  const deadline = Date.now() + IMAGE_POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const historyResponse = await fetchWithTimeout(
      historyUrl,
      { cache: "no-store" },
      20_000
    );
    if (historyResponse.ok) {
      const historyPayload = (await historyResponse.json().catch(() => null)) as
        | Record<string, ComfyHistoryEntry>
        | null;
      const entry = historyPayload?.[promptId];
      const outputImage = entry?.outputs ? findOutputImage(entry) : null;
      if (outputImage?.filename) {
        return outputImage;
      }
    } else if (historyResponse.status !== 404) {
      throw new Error(`Failed to fetch ComfyUI history (${historyResponse.status}).`);
    }
    await sleep(IMAGE_POLL_INTERVAL_MS);
  }

  throw new Error("Image generation timed out after 3 minutes.");
}

async function waitForComfyVideoOutput(
  promptId: string,
  workflow: Record<string, WorkflowNode>
): Promise<ComfyOutputImage> {
  const historyUrl = `${COMFY_BASE_URL.replace(/\/$/, "")}/history/${encodeURIComponent(promptId)}`;
  const deadline = Date.now() + VIDEO_POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const historyResponse = await fetchWithTimeout(
      historyUrl,
      { cache: "no-store" },
      20_000
    );
    if (historyResponse.ok) {
      const historyPayload = (await historyResponse.json().catch(() => null)) as
        | Record<string, ComfyHistoryEntry>
        | null;
      const entry = historyPayload?.[promptId];
      const outputVideo = entry?.outputs ? findVideoOutput(entry, workflow) : null;
      if (outputVideo?.filename) {
        return outputVideo;
      }
    } else if (historyResponse.status !== 404) {
      throw new Error(`Failed to fetch ComfyUI history (${historyResponse.status}).`);
    }
    await sleep(VIDEO_POLL_INTERVAL_MS);
  }

  throw new Error("Video generation timed out after 10 minutes.");
}

async function saveOutputToTempAi(
  promptId: string,
  output: ComfyOutputImage,
  buffer: Buffer
): Promise<string> {
  const tempDir = path.join(process.cwd(), "public", "temp_ai");
  fs.mkdirSync(tempDir, { recursive: true });
  const outputFilename = `${promptId}_${path.basename(output.filename ?? "output")}`;
  const destinationPath = path.join(tempDir, outputFilename);
  fs.writeFileSync(destinationPath, buffer);
  return `/temp_ai/${encodeURIComponent(outputFilename)}`;
}

function patchTextToImageWorkflow(
  workflow: Record<string, WorkflowNode>,
  prompt: string,
  width: number,
  height: number
): void {
  const promptNode = workflow["4"];
  const samplerNode = workflow["6"];
  const latentNode = workflow["7"];
  const fluxSamplingNode = workflow["5"];

  if (!promptNode?.inputs || !samplerNode?.inputs || !latentNode?.inputs) {
    throw new Error("Text-to-image workflow template missing required nodes: 4, 6, or 7.");
  }

  promptNode.inputs.text = prompt;
  samplerNode.inputs.seed = randomSeed();
  latentNode.inputs.width = width;
  latentNode.inputs.height = height;
  if (fluxSamplingNode?.inputs) {
    fluxSamplingNode.inputs.width = width;
    fluxSamplingNode.inputs.height = height;
  }
}

function patchTextToVideoWorkflow(
  workflow: Record<string, WorkflowNode>,
  prompt: string,
  width: number,
  height: number,
  length: number,
  batchSize: number
): void {
  const promptNode = workflow["7"];
  const samplerNode = workflow["10"];
  const latentNode = workflow["13"];

  if (!promptNode?.inputs || !samplerNode?.inputs || !latentNode?.inputs) {
    throw new Error("Text-to-video workflow template missing required nodes: 7, 10, or 13.");
  }

  promptNode.inputs.text = prompt;
  samplerNode.inputs.seed = randomSeed();
  latentNode.inputs.width = width;
  latentNode.inputs.height = height;
  latentNode.inputs.length = length;
  latentNode.inputs.batch_size = batchSize;
}

function ensureImageToVideoCombineNode(
  workflow: Record<string, WorkflowNode>,
  frameSourceNodeId: string
): void {
  const existingId = findWorkflowNodeIds(workflow, "VHS_VideoCombine")[0];
  if (existingId && workflow[existingId]?.inputs) {
    workflow[existingId].inputs.images = [frameSourceNodeId, 0];
    return;
  }

  workflow["9912"] = {
    inputs: {
      frame_rate: 16,
      loop_count: 0,
      filename_prefix: "i2v",
      format: "video/h264-mp4",
      pix_fmt: "yuv420p",
      crf: 19,
      save_metadata: true,
      trim_to_audio: false,
      pingpong: false,
      save_output: true,
      images: [frameSourceNodeId, 0],
    },
    class_type: "VHS_VideoCombine",
    _meta: { title: "Video Combine" },
  };
}

function patchImageToVideoWorkflow(
  workflow: Record<string, WorkflowNode>,
  uploadedImageName: string,
  width: number,
  height: number,
  length: number,
  batchSize: number
): void {
  const loadImageNode = workflow["52"];
  const wanNode = workflow["50"];
  const samplerNode = workflow["3"];

  if (!loadImageNode?.inputs || !wanNode?.inputs || !samplerNode?.inputs) {
    throw new Error("Image-to-video workflow template missing required nodes: 52, 50, or 3.");
  }

  loadImageNode.inputs.image = uploadedImageName;
  wanNode.inputs.width = width;
  wanNode.inputs.height = height;
  wanNode.inputs.length = length;
  wanNode.inputs.batch_size = batchSize;
  samplerNode.inputs.seed = randomSeed();
  ensureImageToVideoCombineNode(workflow, "8");
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.trunc(parsed));
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      mode?: GenerateMode;
      prompt?: string;
      width?: number;
      height?: number;
      length?: number;
      batchSize?: number;
      sourceImagePath?: string;
      filename?: string;
      taskId?: string;
      task_id?: string;
    };

    const mode = body.mode;
    if (mode !== "text2image" && mode !== "text2video" && mode !== "image2video") {
      return NextResponse.json(
        { error: 'mode must be "text2image", "text2video", or "image2video".' },
        { status: 400 }
      );
    }

    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const width = roundToMultipleOf8(
      parsePositiveInt(body.width, mode === "text2image" ? 1024 : mode === "image2video" ? 512 : 832)
    );
    const height = roundToMultipleOf8(
      parsePositiveInt(body.height, mode === "text2image" ? 1024 : mode === "image2video" ? 512 : 480)
    );
    const length = parsePositiveInt(body.length, 33);
    const batchSize = parsePositiveInt(body.batchSize, 1);
    const sourceImagePath = typeof body.sourceImagePath === "string" ? body.sourceImagePath.trim() : "";
    const filename = typeof body.filename === "string" ? body.filename.trim() : "";
    const taskId =
      (typeof body.taskId === "string" ? body.taskId.trim() : "") ||
      (typeof body.task_id === "string" ? body.task_id.trim() : "");

    if ((mode === "text2image" || mode === "text2video") && !prompt) {
      return NextResponse.json({ error: "prompt is required for this mode." }, { status: 400 });
    }

    let workflow: Record<string, WorkflowNode>;
    let promptId: string;
    let mediaType: "image" | "video";

    if (mode === "text2image") {
      workflow = loadWorkflow("Text_to_Image.json");
      patchTextToImageWorkflow(workflow, prompt, width, height);
      promptId = await submitComfyPrompt(workflow);
      console.info(`[ai-generate] mode=text2image prompt_id=${promptId} ${width}x${height}`);
      const outputImage = await waitForComfyImageOutput(promptId);
      const outputBuffer = await fetchComfyViewBuffer(outputImage);
      const mediaUrl = await saveOutputToTempAi(promptId, outputImage, outputBuffer);
      mediaType = "image";
      return NextResponse.json({ success: true, promptId, mediaUrl, type: mediaType });
    }

    if (mode === "text2video") {
      workflow = loadWorkflow("Text_to_Video.json");
      patchTextToVideoWorkflow(workflow, prompt, width, height, length, batchSize);
      promptId = await submitComfyPrompt(workflow);
      console.info(
        `[ai-generate] mode=text2video prompt_id=${promptId} ${width}x${height} length=${length} batch=${batchSize}`
      );
      const outputVideo = await waitForComfyVideoOutput(promptId, workflow);
      const outputBuffer = await fetchComfyViewBuffer(outputVideo);
      const mediaUrl = await saveOutputToTempAi(promptId, outputVideo, outputBuffer);
      mediaType = "video";
      return NextResponse.json({ success: true, promptId, mediaUrl, type: mediaType });
    }

    workflow = loadWorkflow("image2VideoWorkflow.json");
    const localSourcePath = resolveLocalSourcePath(sourceImagePath, filename, taskId);
    const sourceBuffer = fs.readFileSync(localSourcePath);
    const sourceExt = path.extname(localSourcePath).toLowerCase() || ".jpg";
    const uploadName = `i2v_${Date.now()}_${randomUUID().slice(0, 8)}${sourceExt}`;
    const uploadedImageName = await uploadImageToComfy(sourceBuffer, uploadName);
    patchImageToVideoWorkflow(workflow, uploadedImageName, width, height, length, batchSize);
    promptId = await submitComfyPrompt(workflow);
    console.info(
      `[ai-generate] mode=image2video prompt_id=${promptId} source=${localSourcePath} ${width}x${height} length=${length} batch=${batchSize}`
    );
    const outputVideo = await waitForComfyVideoOutput(promptId, workflow);
    const outputBuffer = await fetchComfyViewBuffer(outputVideo);
    const mediaUrl = await saveOutputToTempAi(promptId, outputVideo, outputBuffer);
    mediaType = "video";
    return NextResponse.json({ success: true, promptId, mediaUrl, type: mediaType });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI generation failed.";
    console.error("[ai-generate]", message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
