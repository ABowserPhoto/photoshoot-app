import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import sharp from "sharp";

import { PHOTOS_ROOT } from "@/lib/photosPaths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WorkflowNode = {
  inputs?: Record<string, unknown>;
  class_type?: string;
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

function loadWorkflowTemplate(): Record<string, WorkflowNode> {
  const workflowPath = path.join(process.cwd(), "lib", "comfy", "workflow_api.json");
  const raw = fs.readFileSync(workflowPath, "utf8");
  return JSON.parse(raw) as Record<string, WorkflowNode>;
}

function validateMergedFile(localFolderName: string, filename: string): string {
  const safeFolder = localFolderName.trim();
  const safeFile = path.basename(filename.trim());
  if (!safeFolder || !safeFile || safeFile !== filename.trim()) {
    throw new Error("Invalid local_folder_name or filename.");
  }
  if (safeFolder.includes("..") || /[<>:"|?*]/.test(safeFolder)) {
    throw new Error("Invalid local_folder_name.");
  }
  const mergedPath = path.resolve(PHOTOS_ROOT, safeFolder, "3_merge", safeFile);
  const rootResolved = path.resolve(PHOTOS_ROOT);
  if (!mergedPath.toLowerCase().startsWith(rootResolved.toLowerCase() + path.sep)) {
    throw new Error("Access denied.");
  }
  if (!fs.existsSync(mergedPath) || !fs.statSync(mergedPath).isFile()) {
    throw new Error("Merged image not found.");
  }
  return mergedPath;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      local_folder_name?: string;
      filename?: string;
    };

    const localFolderName =
      typeof body.local_folder_name === "string" ? body.local_folder_name.trim() : "";
    const filename = typeof body.filename === "string" ? body.filename.trim() : "";

    if (!localFolderName || !filename) {
      return NextResponse.json(
        { error: "local_folder_name and filename are required." },
        { status: 400 }
      );
    }

    const sourcePath = validateMergedFile(localFolderName, filename);

    const comfyInputDir = process.env.COMFYUI_INPUT_DIR?.trim();
    const comfyBase = process.env.COMFYUI_BASE_URL?.trim() || "http://127.0.0.1:8188";

    if (!comfyInputDir) {
      return NextResponse.json(
        {
          error:
            "COMFYUI_INPUT_DIR is not configured. Set it to your ComfyUI installation's input folder so merged images can be copied for LoadImage.",
          comfyQueued: false,
        },
        { status: 503 }
      );
    }

    const inputRoot = path.resolve(comfyInputDir);
    fs.mkdirSync(inputRoot, { recursive: true });
    const safeFilename = path.basename(filename);
    const resizedFilename = `resized_${safeFilename}`.replace(/[^a-zA-Z0-9._-]/g, "_");
    const resizedPath = path.join(inputRoot, resizedFilename);
    await sharp(sourcePath)
      .resize({ width: 2048, height: 2048, fit: "inside" })
      .toFile(resizedPath);

    const outputBaseName = path.basename(safeFilename, path.extname(safeFilename));
    const outputPrefix = path.join(
      PHOTOS_ROOT,
      localFolderName,
      "4_Final",
      `AI_${outputBaseName}`
    );

    const workflow = loadWorkflowTemplate();
    if (!workflow["1"]?.inputs || !workflow["9"]?.inputs || !workflow["11"]?.inputs) {
      return NextResponse.json({ error: "Workflow template is missing required nodes." }, { status: 500 });
    }

    workflow["9"].inputs.seed = Math.floor(Math.random() * 1000000000000000);
    workflow["1"].inputs.image = resizedFilename;
    workflow["11"].inputs.filename_prefix = outputPrefix;

    const clientId = randomUUID();
    const promptUrl = `${comfyBase.replace(/\/$/, "")}/prompt`;

    let comfyQueued = false;
    let promptId: string | undefined;

    try {
      console.info(`[ai-edit] Triggering ComfyUI prompt for ${localFolderName}/${filename} at ${promptUrl}`);
      const comfyResponse = await fetch(promptUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: workflow,
          client_id: clientId,
        }),
      });

      const comfyPayload = (await comfyResponse.json().catch(() => null)) as
        | {
            prompt_id?: string;
            error?: unknown;
            detail?: unknown;
            message?: unknown;
          }
        | null;

      if (!comfyResponse.ok) {
        const comfyErrorMessage = normalizeErrorMessage(
          comfyPayload?.message ?? comfyPayload?.detail ?? comfyPayload?.error ?? comfyPayload,
          `ComfyUI error (${comfyResponse.status}).`
        );
        return NextResponse.json(
          {
            error: comfyErrorMessage,
            comfyQueued: false,
          },
          { status: 502 }
        );
      }

      comfyQueued = true;
      promptId = comfyPayload?.prompt_id;
      console.info(
        `[ai-edit] ComfyUI prompt accepted for ${localFolderName}/${filename}${promptId ? ` (prompt ${promptId})` : ""}.`
      );
    } catch (err) {
      console.warn(
        "[ai-edit] ComfyUI API failed/not running:",
        err instanceof Error ? err.message : err
      );
      return NextResponse.json(
        {
          error:
            err instanceof Error
              ? err.message
              : "Could not reach ComfyUI. Check COMFYUI_BASE_URL and that the server is running.",
          comfyQueued: false,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      comfyQueued,
      promptId,
      local_folder_name: localFolderName,
      filename,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI edit failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
