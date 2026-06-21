import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { PHOTOS_ROOT } from "@/lib/photosPaths";
import { fetchWithTimeout } from "@/lib/server/fetchWithTimeout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMFY_BASE_URL = process.env.COMFYUI_BASE_URL?.trim() || "http://127.0.0.1:8188";
const COMFY_DEFAULT_ROOT = process.env.COMFYUI_PATH?.trim() || "C:/ComfyUI_windows_portable/ComfyUI";
const COMFY_INPUT_DIR = process.env.COMFYUI_INPUT_DIR?.trim() || path.join(COMFY_DEFAULT_ROOT, "input");
const MASK_INPUT_PREFIX = "mask_";
const MASK_INPUT_MAX_AGE_MS = 60 * 60 * 1000;

type WorkflowNode = {
  inputs?: Record<string, unknown>;
  class_type?: string;
  _meta?: { title?: string };
};

type TargetCoord = { x: number; y: number };

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

function parseTargetCoords(value: unknown): TargetCoord[] {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("targetCoords must be an array of { x, y } objects.");
  }

  const coords: TargetCoord[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      throw new Error("Each targetCoord must be an object with numeric x and y.");
    }
    const record = entry as Record<string, unknown>;
    const x = Number(record.x);
    const y = Number(record.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error("Each targetCoord must include finite numeric x and y values.");
    }
    coords.push({ x: Math.round(x), y: Math.round(y) });
  }
  return coords;
}

function loadPointsMaskWorkflowTemplate(): Record<string, WorkflowNode> {
  const workflowPath = path.join(process.cwd(), "lib", "comfy", "points_mask_detection.json");
  const raw = fs.readFileSync(workflowPath, "utf8");
  return JSON.parse(raw) as Record<string, WorkflowNode>;
}

function pruneStaleMaskInputFiles(inputDir: string, keepFilename?: string): void {
  if (!fs.existsSync(inputDir)) {
    return;
  }

  const cutoffMs = Date.now() - MASK_INPUT_MAX_AGE_MS;
  for (const entry of fs.readdirSync(inputDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.startsWith(MASK_INPUT_PREFIX)) {
      continue;
    }
    if (keepFilename && entry.name === keepFilename) {
      continue;
    }

    const filePath = path.join(inputDir, entry.name);
    try {
      const stats = fs.statSync(filePath);
      if (stats.mtimeMs < cutoffMs) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // Ignore cleanup failures for individual files.
    }
  }
}

function scheduleMaskInputCleanup(inputFilePath: string, delayMs = 10 * 60 * 1000): void {
  setTimeout(() => {
    fs.promises.unlink(inputFilePath).catch(() => {
      // ComfyUI may still be reading the file; stale-file pruning handles leftovers.
    });
  }, delayMs).unref?.();
}

export async function POST(request: Request) {
  let comfyInputFilePath: string | null = null;

  try {
    const body = (await request.json().catch(() => null)) as
      | {
          absoluteLocalPath?: unknown;
          targetCoords?: unknown;
          taskId?: unknown;
          samTextPrompt?: unknown;
        }
      | null;

    const absoluteLocalPath =
      typeof body?.absoluteLocalPath === "string" ? body.absoluteLocalPath.trim() : "";
    const taskId = typeof body?.taskId === "string" ? body.taskId.trim() : "";
    const samTextPrompt = typeof body?.samTextPrompt === "string" ? body.samTextPrompt.trim() : "";

    if (!absoluteLocalPath) {
      return NextResponse.json({ error: "absoluteLocalPath is required." }, { status: 400 });
    }

    const targetCoords = parseTargetCoords(body?.targetCoords);
    if (targetCoords.length === 0 && !samTextPrompt) {
      return NextResponse.json(
        { error: "Provide at least one targetCoord or a samTextPrompt." },
        { status: 400 }
      );
    }

    const sourceImagePath = resolveAndValidateAbsoluteImagePath(absoluteLocalPath);
    const sourceExt = path.extname(sourceImagePath).toLowerCase() || ".jpg";
    const uniqueBase = `${MASK_INPUT_PREFIX}${Date.now()}_${randomUUID().slice(0, 8)}`;
    const comfyInputFilename = `${uniqueBase}${sourceExt}`;
    const comfyInputDirResolved = path.resolve(COMFY_INPUT_DIR);
    fs.mkdirSync(comfyInputDirResolved, { recursive: true });
    comfyInputFilePath = path.join(comfyInputDirResolved, comfyInputFilename);

    pruneStaleMaskInputFiles(comfyInputDirResolved);
    fs.copyFileSync(sourceImagePath, comfyInputFilePath);

    const workflow = loadPointsMaskWorkflowTemplate();
    const loadImageNode = workflow["1"];
    const segmentationNode = workflow["4"];
    const promptCollectorNode = workflow["6"];

    if (!loadImageNode?.inputs || !segmentationNode?.inputs || !promptCollectorNode?.inputs) {
      return NextResponse.json(
        { error: "Mask workflow template missing required nodes: 1, 4, or 6." },
        { status: 500 }
      );
    }

    loadImageNode.inputs.image = comfyInputFilename;
    segmentationNode.inputs.text_prompt = samTextPrompt;
    segmentationNode.inputs.pipeline_mode = samTextPrompt ? "all" : "points_only";
    segmentationNode.inputs.confidence_threshold = 0.35;
    promptCollectorNode.inputs.image = ["1", 0];
    promptCollectorNode.inputs.positive_points =
      targetCoords.length === 0
        ? "[]"
        : JSON.stringify(
            targetCoords.map((coord) => ({
              x: Math.round(coord.x),
              y: Math.round(coord.y),
            }))
          );

    console.info(
      `[generate-mask] task_id=${taskId || "(none)"} source=${sourceImagePath} input=${comfyInputFilename} points=${targetCoords.length} pipeline_mode=${segmentationNode.inputs.pipeline_mode} text_prompt=${samTextPrompt ? `"${samTextPrompt}"` : "(none)"}`
    );

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

    if (!response.ok) {
      console.error(`[generate-mask] ComfyUI error (${response.status}): ${responseText}`);
      if (comfyInputFilePath) {
        fs.unlinkSync(comfyInputFilePath);
        comfyInputFilePath = null;
      }
      const payload = (() => {
        try {
          return JSON.parse(responseText) as {
            prompt_id?: string;
            error?: unknown;
            detail?: unknown;
            message?: unknown;
          } | null;
        } catch {
          return null;
        }
      })();
      const comfyError =
        payload?.message ?? payload?.detail ?? payload?.error ?? responseText ?? payload;

      return NextResponse.json(
        {
          error: normalizeErrorMessage(
            comfyError,
            `ComfyUI request failed (${response.status}).`
          ),
        },
        { status: 500 }
      );
    }

    const payload = (() => {
      try {
        return JSON.parse(responseText) as {
          prompt_id?: string;
          error?: unknown;
          detail?: unknown;
          message?: unknown;
        };
      } catch {
        return null;
      }
    })();

    if (comfyInputFilePath) {
      scheduleMaskInputCleanup(comfyInputFilePath);
    }

    return NextResponse.json({
      success: true,
      prompt_id: payload?.prompt_id ?? null,
    });
  } catch (error) {
    if (comfyInputFilePath) {
      try {
        fs.unlinkSync(comfyInputFilePath);
      } catch {
        // Ignore cleanup failures.
      }
    }
    const message = error instanceof Error ? error.message : "Failed to trigger mask generation workflow.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
