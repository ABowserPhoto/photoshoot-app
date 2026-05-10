import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

import { PHOTOS_ROOT } from "@/lib/photosPaths";
import { sanitizeStoragePath } from "@/lib/sanitizeStoragePath.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const SUPABASE_FINALS_BUCKET = process.env.SUPABASE_FINALS_BUCKET?.trim() || "finals";

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

function normalizeFilenameInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const safeDecode = (raw: string): string => {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  };
  try {
    const parsed = new URL(trimmed);
    const decodedPath = safeDecode(parsed.pathname);
    const parts = decodedPath.split("/").filter(Boolean);
    return (parts.at(-1) ?? "").trim();
  } catch {
    const normalized = trimmed.replace(/\\/g, "/");
    const parts = normalized.split("/").filter(Boolean);
    const last = parts.at(-1) ?? trimmed;
    const [withoutQuery] = last.split("?");
    const [withoutHash] = withoutQuery.split("#");
    return safeDecode(withoutHash).trim();
  }
}

async function resolveMergedSource(
  localFolderName: string,
  filename: string,
  taskId?: string
): Promise<{
  sourceInput: string | Buffer;
  resolvedLocalFolderName: string;
  sourceType: "local" | "supabase";
  sourceRef: string;
}> {
  const attemptedLocalPaths: string[] = [];
  const attemptedStoragePaths: string[] = [];
  let safeFolder = localFolderName.trim();
  const safeFile = path.basename(filename.trim());
  if (!safeFile || safeFile !== filename.trim()) {
    throw new Error("Invalid filename.");
  }
  const ext = path.extname(safeFile).toLowerCase();
  if (!ext || ![".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp", ".bmp", ".gif"].includes(ext)) {
    throw new Error("Invalid filename extension for merged image.");
  }
  if (safeFolder && (safeFolder.includes("..") || /[<>:"|?*]/.test(safeFolder))) {
    throw new Error("Invalid local_folder_name.");
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const supabase =
    supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } }) : null;
  if (!safeFolder && taskId && supabase) {
    const { data: taskRow } = await supabase
      .from("tasks")
      .select("local_folder_name")
      .eq("id", taskId)
      .maybeSingle();
    const maybeLocal = (taskRow as { local_folder_name?: unknown } | null)?.local_folder_name;
    safeFolder = typeof maybeLocal === "string" ? maybeLocal.trim() : "";
  }

  if (safeFolder) {
    const imagePath = path.resolve(PHOTOS_ROOT, safeFolder, "3_Merged", safeFile);
    attemptedLocalPaths.push(imagePath);
    console.info(`[ai-edit] Trying local merged source path: ${imagePath}`);
    const rootResolved = path.resolve(PHOTOS_ROOT);
    if (!imagePath.toLowerCase().startsWith(rootResolved.toLowerCase() + path.sep)) {
      throw new Error("Access denied.");
    }
    if (fs.existsSync(imagePath) && fs.statSync(imagePath).isFile()) {
      return {
        sourceInput: imagePath,
        resolvedLocalFolderName: safeFolder,
        sourceType: "local",
        sourceRef: imagePath,
      };
    }
  }

  if (supabase) {
    const folderPrefixes = [
      safeFolder ? sanitizeStoragePath(`${safeFolder}/3_Merged`) : "",
      taskId ? sanitizeStoragePath(`${taskId}/3_Merged`) : "",
    ].filter(Boolean);
    for (const prefix of folderPrefixes) {
      const storagePath = sanitizeStoragePath(`${prefix}/${safeFile}`);
      attemptedStoragePaths.push(storagePath);
      const { data, error } = await supabase.storage.from(SUPABASE_FINALS_BUCKET).download(storagePath);
      if (!error && data) {
        const buffer = Buffer.from(await data.arrayBuffer());
        return {
          sourceInput: buffer,
          resolvedLocalFolderName: safeFolder,
          sourceType: "supabase",
          sourceRef: storagePath,
        };
      }
    }
  }

  console.error("[ai-edit] Merged source lookup failed.", {
    localPaths: attemptedLocalPaths,
    storagePaths: attemptedStoragePaths,
  });
  throw new Error(
    `Merged image not found. attempted_local_paths=${attemptedLocalPaths.join(" | ") || "(none)"}`
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      local_folder_name?: string;
      task_id?: string;
      filename?: string;
    };

    const localFolderName =
      typeof body.local_folder_name === "string" ? body.local_folder_name.trim() : "";
    const taskId = typeof body.task_id === "string" ? body.task_id.trim() : "";
    const filenameRaw = typeof body.filename === "string" ? body.filename.trim() : "";
    const filename = normalizeFilenameInput(filenameRaw);

    if ((!localFolderName && !taskId) || !filename) {
      return NextResponse.json(
        { error: "filename and either local_folder_name or task_id are required." },
        { status: 400 }
      );
    }

    const { sourceInput, resolvedLocalFolderName, sourceType, sourceRef } = await resolveMergedSource(
      localFolderName,
      filename,
      taskId
    );
    console.info(
      `[ai-edit] source_lookup task_id=${taskId || "(none)"} filename=${filename} source=${sourceType} ref=${sourceRef}`
    );

    const comfyInputDir = process.env.COMFYUI_INPUT_DIR?.trim();

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
    await sharp(sourceInput)
      .resize({ width: 2048, height: 2048, fit: "inside" })
      .toFile(resizedPath);

    const outputBaseName = path.basename(safeFilename, path.extname(safeFilename));
    const effectiveFolderForOutput = resolvedLocalFolderName || localFolderName || taskId;
    const outputPrefix = path.join(PHOTOS_ROOT, effectiveFolderForOutput, "4_Final", `AI_${outputBaseName}`);

    const workflow = loadWorkflowTemplate();
    if (!workflow["1"]?.inputs || !workflow["9"]?.inputs || !workflow["11"]?.inputs) {
      return NextResponse.json({ error: "Workflow template is missing required nodes." }, { status: 500 });
    }

    workflow["9"].inputs.seed = Math.floor(Math.random() * 1000000000000000);
    workflow["1"].inputs.image = resizedFilename;
    workflow["11"].inputs.filename_prefix = outputPrefix;

    const clientId = randomUUID();
    const promptUrl = "http://127.0.0.1:8188/prompt";

    let comfyQueued = false;
    let promptId: string | undefined;

    try {
      console.info(
        `[ai-edit] Triggering ComfyUI prompt for ${effectiveFolderForOutput || "(unknown-folder)"}/${filename} at ${promptUrl}`
      );
      const promptPayload = {
        prompt: workflow,
        client_id: clientId,
      };
      console.info(
        `[ai-edit] ComfyUI payload debug: url=${promptUrl}, nodes=${Object.keys(workflow).length}, bytes=${Buffer.byteLength(
          JSON.stringify(promptPayload),
          "utf8"
        )}`
      );
      const comfyResponse = await fetch(promptUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(promptPayload),
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
        `[ai-edit] ComfyUI prompt accepted for ${effectiveFolderForOutput || "(unknown-folder)"}/${filename}${promptId ? ` (prompt ${promptId})` : ""}.`
      );
    } catch (err) {
      console.error("ComfyUI fetch error:", err);
      console.warn("[ai-edit] ComfyUI API failed/not running");
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
      task_id: taskId,
      filename,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI edit failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
