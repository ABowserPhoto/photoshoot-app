import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { resolveSourceImagePath } from "@/lib/comfy/resolveSourceImagePath";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMFY_BASE_URL = process.env.COMFYUI_BASE_URL?.trim() || "http://127.0.0.1:8188";
const COMFY_DEFAULT_ROOT = process.env.COMFYUI_PATH?.trim() || "C:/ComfyUI_windows_portable/ComfyUI";
const COMFY_INPUT_DIR = process.env.COMFYUI_INPUT_DIR?.trim() || path.join(COMFY_DEFAULT_ROOT, "input");
const VALID_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"]);

type WorkflowNode = {
  inputs?: Record<string, unknown>;
  class_type?: string;
  _meta?: { title?: string };
};

function loadMaterialReplacementWorkflowTemplate(): Record<string, WorkflowNode> {
  const workflowPath = path.join(process.cwd(), "lib", "comfy", "image_qwen_image_materialSwitch_2511.json");
  const raw = fs.readFileSync(workflowPath, "utf8");
  return JSON.parse(raw) as Record<string, WorkflowNode>;
}

function ensureImageExtension(name: string, fallback = ".jpg"): string {
  const ext = path.extname(name).toLowerCase();
  return VALID_IMAGE_EXTENSIONS.has(ext) ? ext : fallback;
}

function random15DigitInteger(): number {
  return Math.floor(100_000_000_000_000 + Math.random() * 900_000_000_000_000);
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const filenameEntry = formData.get("filename");
    const promptEntry = formData.get("prompt");
    const taskIdEntry = formData.get("taskId") ?? formData.get("task_id");
    const filename = typeof filenameEntry === "string" ? filenameEntry.trim() : "";
    const prompt = typeof promptEntry === "string" ? promptEntry.trim() : "";
    const taskId = typeof taskIdEntry === "string" ? taskIdEntry.trim() : "";

    if (!filename) {
      return NextResponse.json({ error: "filename is required." }, { status: 400 });
    }

    const referenceEntries = formData.getAll("referenceImages");
    const firstReferenceFile = referenceEntries.find((entry) => entry instanceof File);
    if (!(firstReferenceFile instanceof File)) {
      return NextResponse.json(
        { error: "Material replacement requires at least one reference image." },
        { status: 400 }
      );
    }

    const sourceImagePath = resolveSourceImagePath(filename, taskId);
    const sourceExt = path.extname(sourceImagePath).toLowerCase() || ".jpg";
    const comfyInputDirResolved = path.resolve(COMFY_INPUT_DIR);
    fs.mkdirSync(comfyInputDirResolved, { recursive: true });

    const mainTempFilename = `temp_material_main_${Date.now()}_${randomUUID().slice(0, 8)}${sourceExt}`;
    const mainTargetPath = path.join(comfyInputDirResolved, mainTempFilename);
    fs.copyFileSync(sourceImagePath, mainTargetPath);

    const refExt = ensureImageExtension(firstReferenceFile.name || "", ".jpg");
    const refTempFilename = `ref_mat_${Date.now()}_${randomUUID().slice(0, 8)}${refExt}`;
    const refTargetPath = path.join(comfyInputDirResolved, refTempFilename);
    const refBytes = Buffer.from(await firstReferenceFile.arrayBuffer());
    fs.writeFileSync(refTargetPath, refBytes);

    const workflow = loadMaterialReplacementWorkflowTemplate();
    const mainLoadNode = workflow["41"];
    const refLoadNode = workflow["83"];
    const promptNode = workflow["170:151"];
    const samplerNode = workflow["170:169"];
    if (!mainLoadNode?.inputs || !refLoadNode?.inputs || !promptNode?.inputs || !samplerNode?.inputs) {
      return NextResponse.json(
        { error: "Material replacement workflow template missing required nodes: 41, 83, 170:151, or 170:169." },
        { status: 500 }
      );
    }

    mainLoadNode.inputs.image = mainTempFilename;
    refLoadNode.inputs.image = refTempFilename;
    promptNode.inputs.prompt = prompt;
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
    const message = error instanceof Error ? error.message : "Failed to trigger material-replacement workflow.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
