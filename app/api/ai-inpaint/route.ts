import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { readComfyUploadFilename } from "@/lib/comfy/comfyImageName";
import { fetchWithTimeout } from "@/lib/server/fetchWithTimeout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMFY_BASE_URL = process.env.COMFYUI_BASE_URL?.trim() || "http://127.0.0.1:8188";
const COMFY_DEFAULT_ROOT = process.env.COMFYUI_PATH?.trim() || "C:/ComfyUI_windows_portable/ComfyUI";
const COMFY_OUTPUT_DIR = process.env.COMFYUI_OUTPUT_DIR?.trim() || path.join(COMFY_DEFAULT_ROOT, "output");
const SAVE_IMAGE_NODE_ID = "9";
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

function loadObjectRemovalWorkflowTemplate(): Record<string, WorkflowNode> {
  const workflowPath = path.join(process.cwd(), "lib", "comfy", "remove_objects.json");
  const raw = fs.readFileSync(workflowPath, "utf8");
  return JSON.parse(raw) as Record<string, WorkflowNode>;
}

function selectPositivePrompt(removalTarget: string): string {
  const t = removalTarget.toLowerCase();
  if (t.includes("car") || t.includes("vehicle") || t.includes("trash") || t.includes("bin")) {
    return "empty street, bare concrete driveway, asphalt, empty space, highly detailed texture";
  }
  if (t.includes("cable") || t.includes("wire")) {
    return "background, wall texture, seamless, highly detailed";
  }
  if (t.includes("picture") || t.includes("frame") || t.includes("clutter") || t.includes("counter")) {
    return "background, wall texture, seamless, highly detailed";
  }
  return "background, wall texture, seamless, empty space, highly detailed texture";
}

function selectNegativePrompt(removalTarget: string): string {
  const target = removalTarget.trim() || "object";
  return `${target}, blurry, distorted, artifacts, low quality, watermark`;
}

/**
 * remove_objects.json graph:
 * - "1" LoadImage ← source photo
 * - "2" GroundingDinoSAMSegment ← text mask prompt (text mode)
 * - "5" GrowMask ← expands mask before inpaint
 * - "17" Checkpoint / "20" positive / "21" negative / "23" VAEEncodeForInpaint / "24" KSampler / "25" VAEDecode
 * - "9" SaveImage
 *
 * Manual mode replaces the segmenter mask with an uploaded mask LoadImage → ImageToMask → GrowMask.
 */
function buildObjectRemovalWorkflow(
  comfyImageName: string,
  comfyMaskName: string,
  prompt: string
): Record<string, WorkflowNode> {
  const workflow = loadObjectRemovalWorkflowTemplate();
  const sourceNode = workflow["1"];
  const segmentNode = workflow["2"];
  const growMaskNode = workflow["5"];
  const positiveNode = workflow["20"];
  const negativeNode = workflow["21"];
  const encodeNode = workflow["23"];
  const samplerNode = workflow["24"];
  const saveNode = workflow["9"];

  if (
    !sourceNode?.inputs ||
    !segmentNode?.inputs ||
    !growMaskNode?.inputs ||
    !positiveNode?.inputs ||
    !negativeNode?.inputs ||
    !encodeNode?.inputs ||
    !samplerNode?.inputs ||
    !saveNode?.inputs
  ) {
    throw new Error(
      "Object removal workflow is missing required nodes (1, 2, 5, 9, 20, 21, 23, or 24)."
    );
  }

  sourceNode.inputs.image = comfyImageName;
  saveNode.inputs.filename_prefix = "wf";
  samplerNode.inputs.seed = Math.floor(Math.random() * 1_000_000_000_000_000);

  const removalTarget = prompt.trim() || "unwanted object";
  positiveNode.inputs.text = selectPositivePrompt(removalTarget);
  negativeNode.inputs.text = selectNegativePrompt(removalTarget);

  if (comfyMaskName) {
    workflow["30"] = {
      inputs: {
        image: comfyMaskName,
      },
      class_type: "LoadImage",
      _meta: { title: "Load Manual Mask" },
    };
    workflow["31"] = {
      inputs: {
        image: ["30", 0],
        channel: "red",
      },
      class_type: "ImageToMask",
      _meta: { title: "Manual Mask" },
    };
    growMaskNode.inputs.mask = ["31", 0];
    // Drop text-segmentation from the executed graph so only the drawn mask is used.
    delete workflow["2"];
    delete workflow["3"];
    delete workflow["10"];
    delete workflow["11"];
    delete workflow["12"];
    delete workflow["13"];
    delete workflow["15"];
    return workflow;
  }

  segmentNode.inputs.prompt = removalTarget;
  segmentNode.inputs.image = ["1", 0];
  growMaskNode.inputs.mask = ["2", 1];
  encodeNode.inputs.mask = ["5", 0];
  return workflow;
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
    const historyResponse = await fetchWithTimeout(
      historyUrl,
      { cache: "no-store" },
      20_000
    );
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
  const viewResponse = await fetchWithTimeout(
    viewUrl,
    { cache: "no-store" },
    30_000
  );
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
      comfyImageName?: string;
      comfyMaskName?: string;
      prompt?: string;
    };

    const comfyImageName = readComfyUploadFilename(body.comfyImageName);
    const comfyMaskName = readComfyUploadFilename(body.comfyMaskName);
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";

    if (!comfyImageName) {
      return NextResponse.json(
        { error: "Upload the source image to ComfyUI before removing an object." },
        { status: 400 }
      );
    }
    if (!comfyMaskName && !prompt) {
      return NextResponse.json(
        { error: "Draw a mask or enter a prompt describing what to remove." },
        { status: 400 }
      );
    }

    const workflow = buildObjectRemovalWorkflow(comfyImageName, comfyMaskName, prompt);

    const promptResponse = await fetchWithTimeout(
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

    const promptText = await promptResponse.text();
    const promptPayload = (() => {
      try {
        return JSON.parse(promptText) as {
          prompt_id?: string;
          error?: unknown;
          detail?: unknown;
          message?: unknown;
        } | null;
      } catch {
        return null;
      }
    })();

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
      `[ai-inpaint] prompt_id=${promptId} comfy_source=${comfyImageName} comfy_mask=${comfyMaskName || "(text)"} prompt=${prompt || "(none)"}`
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
