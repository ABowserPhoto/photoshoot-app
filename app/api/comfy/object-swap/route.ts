import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import sharp from "sharp";

import { resolveSourceImagePath } from "@/lib/comfy/resolveSourceImagePath";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMFY_BASE_URL = process.env.COMFYUI_BASE_URL?.trim() || "http://127.0.0.1:8188";
const COMFY_DEFAULT_ROOT = process.env.COMFYUI_PATH?.trim() || "C:/ComfyUI_windows_portable/ComfyUI";
const COMFY_INPUT_DIR = process.env.COMFYUI_INPUT_DIR?.trim() || path.join(COMFY_DEFAULT_ROOT, "input");
const VALID_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"]);
const MAX_FLUX_INPUT_SIZE = 1536;

type WorkflowNode = {
  inputs?: Record<string, unknown>;
  class_type?: string;
  _meta?: { title?: string };
};

function loadObjectSwapWorkflowTemplate(): Record<string, WorkflowNode> {
  const workflowPath = path.join(process.cwd(), "lib", "comfy", "flux_fill_inpaint.json");
  const raw = fs.readFileSync(workflowPath, "utf8");
  return JSON.parse(raw) as Record<string, WorkflowNode>;
}

function ensureImageExtension(name: string, fallback = ".png"): string {
  const ext = path.extname(name).toLowerCase();
  return VALID_IMAGE_EXTENSIONS.has(ext) ? ext : fallback;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const filenameEntry = formData.get("filename");
    const promptEntry = formData.get("prompt");
    const taskIdEntry = formData.get("taskId") ?? formData.get("task_id");
    const maskFileEntry = formData.get("maskFile");
    const filename = typeof filenameEntry === "string" ? filenameEntry.trim() : "";
    const prompt = typeof promptEntry === "string" ? promptEntry.trim() : "";
    const taskId = typeof taskIdEntry === "string" ? taskIdEntry.trim() : "";

    if (!filename) {
      return NextResponse.json({ error: "filename is required." }, { status: 400 });
    }
    if (!(maskFileEntry instanceof File)) {
      return NextResponse.json({ error: "maskFile is required." }, { status: 400 });
    }

    const sourceImagePath = resolveSourceImagePath(filename, taskId);
    const comfyInputDirResolved = path.resolve(COMFY_INPUT_DIR);
    fs.mkdirSync(comfyInputDirResolved, { recursive: true });

    const mainExt = path.extname(sourceImagePath).toLowerCase() || ".png";
    const mainFilename = `temp_object_swap_main_${Date.now()}_${randomUUID().slice(0, 8)}${mainExt}`;
    const mainTargetPath = path.join(comfyInputDirResolved, mainFilename);
    await sharp(sourceImagePath)
      .resize({
        width: MAX_FLUX_INPUT_SIZE,
        height: MAX_FLUX_INPUT_SIZE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .toFile(mainTargetPath);

    const maskExt = ensureImageExtension(maskFileEntry.name || "", ".png");
    const maskFilename = `mask_${Date.now()}_${randomUUID().slice(0, 8)}${maskExt}`;
    const maskTargetPath = path.join(comfyInputDirResolved, maskFilename);
    const maskBytes = Buffer.from(await maskFileEntry.arrayBuffer());
    await sharp(maskBytes)
      .resize({
        width: MAX_FLUX_INPUT_SIZE,
        height: MAX_FLUX_INPUT_SIZE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .toFile(maskTargetPath);

    const workflow = loadObjectSwapWorkflowTemplate();
    const mainLoadNode = workflow["17"];
    const promptNode = workflow["47:23"];
    const samplerNode = workflow["47:3"];
    const inpaintConditioningNode = workflow["47:38"];
    if (!mainLoadNode?.inputs || !promptNode?.inputs || !samplerNode?.inputs || !inpaintConditioningNode?.inputs) {
      return NextResponse.json(
        { error: "Object swap workflow template missing required nodes: 17, 47:23, 47:3, or 47:38." },
        { status: 500 }
      );
    }

    promptNode.inputs.text = prompt;
    samplerNode.inputs.seed = Math.floor(Math.random() * 1_000_000_000_000_000);
    mainLoadNode.inputs.image = mainFilename;

    workflow["999"] = {
      inputs: {
        image: maskFilename,
        channel: "red",
      },
      class_type: "LoadImageMask",
      _meta: { title: "Load Mask" },
    };
    inpaintConditioningNode.inputs.mask = ["999", 0];

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
      return NextResponse.json(
        {
          error:
            (typeof payload?.detail === "string" && payload.detail) ||
            (typeof payload?.error === "string" && payload.error) ||
            `ComfyUI request failed (${response.status}).`,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      prompt_id: payload?.prompt_id ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to trigger object-swap workflow.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
