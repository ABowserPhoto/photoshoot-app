import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { resolveSourceImagePath } from "@/lib/comfy/resolveSourceImagePath";
import { fetchWithTimeout } from "@/lib/server/fetchWithTimeout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMFY_BASE_URL = process.env.COMFYUI_BASE_URL?.trim() || "http://127.0.0.1:8188";
const COMFY_DEFAULT_ROOT = process.env.COMFYUI_PATH?.trim() || "C:/ComfyUI_windows_portable/ComfyUI";
const COMFY_INPUT_DIR = process.env.COMFYUI_INPUT_DIR?.trim() || path.join(COMFY_DEFAULT_ROOT, "input");

type WorkflowNode = {
  inputs?: Record<string, unknown>;
  class_type?: string;
  _meta?: { title?: string };
};

function loadImageToVideoWorkflowTemplate(): Record<string, WorkflowNode> {
  const workflowPath = path.join(process.cwd(), "lib", "comfy", "image2VideoWorkflow.json");
  const raw = fs.readFileSync(workflowPath, "utf8");
  return JSON.parse(raw) as Record<string, WorkflowNode>;
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

    const sourceImagePath = resolveSourceImagePath(filename, taskId);
    const sourceExt = path.extname(sourceImagePath).toLowerCase() || ".jpg";
    const uniqueBase = `temp_image_to_video_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const comfyInputFilename = `${uniqueBase}${sourceExt}`;
    const comfyInputDirResolved = path.resolve(COMFY_INPUT_DIR);
    fs.mkdirSync(comfyInputDirResolved, { recursive: true });
    const comfyInputFilePath = path.join(comfyInputDirResolved, comfyInputFilename);
    fs.copyFileSync(sourceImagePath, comfyInputFilePath);

    const workflow = loadImageToVideoWorkflowTemplate();
    const loadImageNode = workflow["52"];
    const promptNode = workflow["6"];
    const samplerNode = workflow["3"];
    if (!loadImageNode?.inputs || !promptNode?.inputs || !samplerNode?.inputs) {
      return NextResponse.json(
        { error: "Image-to-video workflow template missing required nodes: 52, 6, or 3." },
        { status: 500 }
      );
    }

    loadImageNode.inputs.image = comfyInputFilename;
    promptNode.inputs.text = prompt;
    samplerNode.inputs.seed = random15DigitInteger();

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
      15_000
    );
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
    const message = error instanceof Error ? error.message : "Failed to trigger image-to-video workflow.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
