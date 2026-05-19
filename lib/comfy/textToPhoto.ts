import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const COMFY_BASE_URL = process.env.COMFYUI_BASE_URL?.trim() || "http://127.0.0.1:8188";
const COMFY_DEFAULT_ROOT = process.env.COMFYUI_PATH?.trim() || "C:/ComfyUI_windows_portable/ComfyUI";
const COMFY_OUTPUT_DIR = process.env.COMFYUI_OUTPUT_DIR?.trim() || path.join(COMFY_DEFAULT_ROOT, "output");

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

function loadTextToPhotoWorkflowTemplate(): Record<string, WorkflowNode> {
  const workflowPath = path.join(process.cwd(), "lib", "comfy", "Text_to_Image.json");
  const raw = fs.readFileSync(workflowPath, "utf8");
  return JSON.parse(raw) as Record<string, WorkflowNode>;
}

function random15DigitInteger(): number {
  return Math.floor(100_000_000_000_000 + Math.random() * 900_000_000_000_000);
}

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function triggerTextToPhotoWorkflow(
  prompt: string
): Promise<{ ok: true; promptId: string } | { ok: false; error: string }> {
  const workflow = loadTextToPhotoWorkflowTemplate();
  const promptNode = workflow["4"];
  const samplerNode = workflow["6"];
  if (!promptNode?.inputs || !samplerNode?.inputs) {
    return { ok: false, error: "Text-to-photo workflow template missing required nodes: 4 or 6." };
  }

  promptNode.inputs.text = prompt;
  samplerNode.inputs.seed = random15DigitInteger();

  const response = await fetch(`${COMFY_BASE_URL.replace(/\/$/, "")}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: workflow,
      client_id: randomUUID(),
    }),
  });
  const payload = (await response.json().catch(() => null)) as
    | {
        prompt_id?: string;
        error?: unknown;
        detail?: unknown;
      }
    | null;

  if (!response.ok) {
    return {
      ok: false,
      error:
        (typeof payload?.detail === "string" && payload.detail) ||
        (typeof payload?.error === "string" && payload.error) ||
        `ComfyUI request failed (${response.status}).`,
    };
  }

  const promptId = payload?.prompt_id?.trim() ?? "";
  if (!promptId) {
    return { ok: false, error: "ComfyUI did not return a prompt_id." };
  }

  return { ok: true, promptId };
}

async function resolveComfyPreviewUrl(promptId: string): Promise<
  | { status: "processing" }
  | { status: "completed"; previewUrl: string }
  | { status: "error"; error: string }
> {
  const historyUrl = `${COMFY_BASE_URL.replace(/\/$/, "")}/history/${encodeURIComponent(promptId)}`;
  const historyResponse = await fetch(historyUrl, { cache: "no-store" });
  if (!historyResponse.ok) {
    if (historyResponse.status === 404) {
      return { status: "processing" };
    }
    return { status: "error", error: `Failed to fetch ComfyUI history (${historyResponse.status}).` };
  }

  const historyPayload = (await historyResponse.json().catch(() => null)) as
    | Record<string, ComfyHistoryEntry>
    | null;
  const entry = historyPayload?.[promptId];
  if (!entry?.outputs || Object.keys(entry.outputs).length === 0) {
    return { status: "processing" };
  }

  const outputImage = findOutputImage(entry);
  if (!outputImage?.filename) {
    return { status: "processing" };
  }

  const outputRoot = path.resolve(COMFY_OUTPUT_DIR);
  const sourcePath = path.resolve(
    outputRoot,
    (outputImage.subfolder ?? "").trim(),
    path.basename(outputImage.filename)
  );
  if (!sourcePath.toLowerCase().startsWith(outputRoot.toLowerCase() + path.sep)) {
    return { status: "error", error: "Invalid ComfyUI output path." };
  }
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    return { status: "processing" };
  }

  const tempDir = path.join(process.cwd(), "public", "temp_ai");
  fs.mkdirSync(tempDir, { recursive: true });
  const copiedName = `${promptId}_${path.basename(outputImage.filename)}`;
  const destinationPath = path.join(tempDir, copiedName);
  fs.copyFileSync(sourcePath, destinationPath);

  return {
    status: "completed",
    previewUrl: `/temp_ai/${encodeURIComponent(copiedName)}`,
  };
}

export async function waitForTextToPhotoPreview(
  promptId: string,
  options?: { intervalMs?: number; timeoutMs?: number }
): Promise<{ ok: true; previewUrl: string } | { ok: false; error: string }> {
  const intervalMs = options?.intervalMs ?? 2500;
  const timeoutMs = options?.timeoutMs ?? 180_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await resolveComfyPreviewUrl(promptId);
    if (result.status === "completed") {
      return { ok: true, previewUrl: result.previewUrl };
    }
    if (result.status === "error") {
      return { ok: false, error: result.error };
    }
    await sleep(intervalMs);
  }

  return { ok: false, error: "Image generation timed out after 3 minutes." };
}
