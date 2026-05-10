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
  _meta?: {
    title?: string;
  };
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

function resolveAndValidateAbsoluteImagePath(imagePath: string): string {
  const resolved = path.resolve(imagePath.trim());
  const rootResolved = path.resolve(PHOTOS_ROOT);
  if (!resolved.toLowerCase().startsWith(rootResolved.toLowerCase() + path.sep)) {
    throw new Error("Access denied.");
  }
  console.info(`[ai-remove] Trying absolute source path: ${resolved}`);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`Image not found. attempted_local_path=${resolved}`);
  }
  return resolved;
}

async function resolveMergedSourceByFilename(
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
  if (safeFolder && (safeFolder.includes("..") || /[<>:"|?*]/.test(safeFolder))) {
    throw new Error("Invalid local_folder_name.");
  }

  const safeFile = path.basename(normalizeFilenameInput(filename));
  if (!safeFile) {
    throw new Error("Invalid filename.");
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
    const localPath = path.resolve(PHOTOS_ROOT, safeFolder, "3_Merged", safeFile);
    attemptedLocalPaths.push(localPath);
    console.info(`[ai-remove] Trying local merged source path: ${localPath}`);
    const rootResolved = path.resolve(PHOTOS_ROOT);
    if (!localPath.toLowerCase().startsWith(rootResolved.toLowerCase() + path.sep)) {
      throw new Error("Access denied.");
    }
    if (fs.existsSync(localPath) && fs.statSync(localPath).isFile()) {
      return {
        sourceInput: localPath,
        resolvedLocalFolderName: safeFolder,
        sourceType: "local",
        sourceRef: localPath,
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

  console.error("[ai-remove] Merged source lookup failed.", {
    localPaths: attemptedLocalPaths,
    storagePaths: attemptedStoragePaths,
  });
  throw new Error(
    `Image not found. attempted_local_paths=${attemptedLocalPaths.join(" | ") || "(none)"}`
  );
}

function selectPositivePrompt(removalTarget: string): string {
  const t = removalTarget.toLowerCase();
  if (t.includes("car")) {
    return "empty street, bare concrete driveway, asphalt, empty space";
  }
  if (t.includes("cable") || t.includes("wire")) {
    return "clear sky, empty wall, seamless background, clean";
  }
  if (t.includes("picture") || t.includes("frame")) {
    return "blank wall, clean painted wall, seamless interior wall";
  }
  if (t.includes("clutter") || t.includes("counter")) {
    return "clean empty kitchen counter, bare table top, flat surface, wood grain, marble";
  }
  return "clean empty background, seamless matching texture";
}

function buildRemovalWorkflow(imageFilename: string, outputPrefix: string, removalTarget: string) {
  const workflow = {
      // If you re-paste workflow_remove.json later, replace this object.
      "1": {
        "inputs": {
          "image": "Drohne_Gottesbergstr10_Kamen_3 (2).jpg"
        },
        "class_type": "LoadImage",
        "_meta": {
          "title": "Load Image"
        }
      },
      "2": {
        "inputs": {
          "prompt": "car",
          "threshold": 0.3,
          "sam_model": [
            "10",
            0
          ],
          "grounding_dino_model": [
            "11",
            0
          ],
          "image": [
            "1",
            0
          ]
        },
        "class_type": "GroundingDinoSAMSegment (segment anything)",
        "_meta": {
          "title": "GroundingDinoSAMSegment (segment anything)"
        }
      },
      "3": {
        "inputs": {
          "mask": [
            "2",
            1
          ]
        },
        "class_type": "MaskToImage",
        "_meta": {
          "title": "Convert Mask to Image"
        }
      },
      "5": {
        "inputs": {
          "expand": 15,
          "tapered_corners": false,
          "mask": [
            "2",
            1
          ]
        },
        "class_type": "GrowMask",
        "_meta": {
          "title": "Grow Mask"
        }
      },
      "9": {
        "inputs": {
          "filename_prefix": "ComfyUI",
          "images": [
            "25",
            0
          ]
        },
        "class_type": "SaveImage",
        "_meta": {
          "title": "Save Image"
        }
      },
      "10": {
        "inputs": {
          "model_name": "sam_vit_b_01ec64.pth",
          "device_mode": "AUTO"
        },
        "class_type": "SAMLoader",
        "_meta": {
          "title": "SAMLoader (Impact)"
        }
      },
      "11": {
        "inputs": {
          "model_name": "GroundingDINO_SwinT_OGC (694MB)"
        },
        "class_type": "GroundingDinoModelLoader (segment anything)",
        "_meta": {
          "title": "GroundingDinoModelLoader (segment anything)"
        }
      },
      "12": {
        "inputs": {
          "mask": [
            "5",
            0
          ]
        },
        "class_type": "MaskPreview",
        "_meta": {
          "title": "Preview Mask"
        }
      },
      "13": {
        "inputs": {
          "images": [
            "3",
            0
          ]
        },
        "class_type": "PreviewImage",
        "_meta": {
          "title": "Preview Image"
        }
      },
      "15": {
        "inputs": {
          "x": 0,
          "y": 0,
          "resize_source": false,
          "destination": [
            "1",
            0
          ],
          "source": [
            "1",
            0
          ],
          "mask": [
            "5",
            0
          ]
        },
        "class_type": "ImageCompositeMasked",
        "_meta": {
          "title": "ImageCompositeMasked"
        }
      },
      "17": {
        "inputs": {
          "ckpt_name": "Realistic_Vision_V5.1-inpainting.safetensors"
        },
        "class_type": "CheckpointLoaderSimple",
        "_meta": {
          "title": "Load Checkpoint"
        }
      },
      "20": {
        "inputs": {
          "text": "empty street, bare concrete driveway, asphalt, empty space, highly detailed texture",
          "clip": [
            "17",
            1
          ]
        },
        "class_type": "CLIPTextEncode",
        "_meta": {
          "title": "CLIP Text Encode (Prompt)"
        }
      },
      "21": {
        "inputs": {
          "text": "car, vehicle, tires, shadows, people, blurry, distorted",
          "clip": [
            "17",
            1
          ]
        },
        "class_type": "CLIPTextEncode",
        "_meta": {
          "title": "CLIP Text Encode (Prompt)"
        }
      },
      "23": {
        "inputs": {
          "grow_mask_by": 6,
          "pixels": [
            "1",
            0
          ],
          "vae": [
            "17",
            2
          ],
          "mask": [
            "5",
            0
          ]
        },
        "class_type": "VAEEncodeForInpaint",
        "_meta": {
          "title": "VAE Encode (for Inpainting)"
        }
      },
      "24": {
        "inputs": {
          "seed": 953507050513881,
          "steps": 20,
          "cfg": 8,
          "sampler_name": "euler",
          "scheduler": "simple",
          "denoise": 0.85,
          "model": [
            "17",
            0
          ],
          "positive": [
            "20",
            0
          ],
          "negative": [
            "21",
            0
          ],
          "latent_image": [
            "23",
            0
          ]
        },
        "class_type": "KSampler",
        "_meta": {
          "title": "KSampler"
        }
      },
      "25": {
        "inputs": {
          "samples": [
            "24",
            0
          ],
          "vae": [
            "17",
            2
          ]
        },
        "class_type": "VAEDecode",
        "_meta": {
          "title": "VAE Decode"
        }
      }
  } as Record<string, WorkflowNode>;

  let hasLoadImageNode = false;
  let hasOutputNode = false;
  const positivePrompt = selectPositivePrompt(removalTarget);
  let hasGroundingTargetNode = false;
  let hasPositivePromptNode = false;
  let hasNegativePromptNode = false;
  let firstClipNodeId: string | null = null;
  let secondClipNodeId: string | null = null;

  for (const [nodeId, node] of Object.entries(workflow)) {
    if (!node.inputs) {
      continue;
    }
    if (!hasLoadImageNode && node.class_type === "LoadImage" && typeof node.inputs.image === "string") {
      node.inputs.image = imageFilename;
      hasLoadImageNode = true;
    }
    if (
      !hasOutputNode &&
      (node.class_type === "SaveImage" || node.class_type === "Image Save") &&
      typeof node.inputs.filename_prefix === "string"
    ) {
      node.inputs.filename_prefix = outputPrefix;
      hasOutputNode = true;
    }
    if (
      !hasGroundingTargetNode &&
      typeof node.class_type === "string" &&
      node.class_type.toLowerCase().includes("groundingdino") &&
      (typeof node.inputs.text === "string" || typeof node.inputs.prompt === "string")
    ) {
      if (typeof node.inputs.text === "string") {
        node.inputs.text = removalTarget;
      }
      if (typeof node.inputs.prompt === "string") {
        node.inputs.prompt = removalTarget;
      }
      hasGroundingTargetNode = true;
    }
    if (node.class_type === "CLIPTextEncode" && typeof node.inputs.text === "string") {
      if (!firstClipNodeId) {
        firstClipNodeId = nodeId;
      } else if (!secondClipNodeId) {
        secondClipNodeId = nodeId;
      }
    }
    if ((nodeId === "20" || node._meta?.title?.toLowerCase().includes("positive")) && typeof node.inputs.text === "string") {
      node.inputs.text = positivePrompt;
      hasPositivePromptNode = true;
    }
    if ((nodeId === "21" || node._meta?.title?.toLowerCase().includes("negative")) && typeof node.inputs.text === "string") {
      node.inputs.text = removalTarget;
      hasNegativePromptNode = true;
    }
  }

  if (!hasPositivePromptNode && firstClipNodeId && workflow[firstClipNodeId]?.inputs) {
    workflow[firstClipNodeId].inputs!.text = positivePrompt;
    hasPositivePromptNode = true;
  }
  if (!hasNegativePromptNode && secondClipNodeId && workflow[secondClipNodeId]?.inputs) {
    workflow[secondClipNodeId].inputs!.text = removalTarget;
    hasNegativePromptNode = true;
  }

  if (Object.keys(workflow).length === 0) {
    throw new Error("Workflow template is empty. Paste workflow_remove.json payload in /api/ai-remove.");
  }
  if (!hasLoadImageNode) {
    throw new Error('Workflow template is missing a LoadImage node with "inputs.image".');
  }
  if (!hasOutputNode) {
    throw new Error('Workflow template is missing a SaveImage node with "inputs.filename_prefix".');
  }
  if (!hasGroundingTargetNode) {
    throw new Error('Workflow template is missing a GroundingDINO node with "inputs.text" or "inputs.prompt".');
  }
  if (!hasPositivePromptNode) {
    throw new Error('Workflow template is missing a positive CLIPTextEncode node (e.g. node "20").');
  }
  if (!hasNegativePromptNode) {
    throw new Error('Workflow template is missing a negative CLIPTextEncode node (e.g. node "21").');
  }

  return { workflow, positivePrompt };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      imagePath?: string;
      local_folder_name?: string;
      task_id?: string;
      filename?: string;
      removalTarget?: string;
    };

    const imagePath = typeof body.imagePath === "string" ? body.imagePath.trim() : "";
    const localFolderName =
      typeof body.local_folder_name === "string" ? body.local_folder_name.trim() : "";
    const taskId = typeof body.task_id === "string" ? body.task_id.trim() : "";
    const filename = typeof body.filename === "string" ? body.filename.trim() : "";
    const removalTarget = typeof body.removalTarget === "string" ? body.removalTarget.trim() : "";

    if ((!imagePath && !filename) || !removalTarget) {
      return NextResponse.json(
        { error: "Provide imagePath or (local_folder_name + filename), plus removalTarget." },
        { status: 400 }
      );
    }

    if (filename && !localFolderName && !taskId) {
      return NextResponse.json(
        { error: "local_folder_name or task_id is required when filename is provided." },
        { status: 400 }
      );
    }

    const sourceResult = filename
      ? await resolveMergedSourceByFilename(localFolderName, filename, taskId)
      : {
          sourceInput: resolveAndValidateAbsoluteImagePath(imagePath),
          resolvedLocalFolderName: localFolderName,
          sourceType: "local" as const,
          sourceRef: path.resolve(imagePath),
        };
    const sourceInput = sourceResult.sourceInput;
    const resolvedLocalFolderName = sourceResult.resolvedLocalFolderName;
    console.info(
      `[ai-remove] source_lookup task_id=${taskId || "(none)"} filename=${normalizeFilenameInput(
        filename || imagePath
      )} source=${sourceResult.sourceType} ref=${sourceResult.sourceRef}`
    );
    const comfyInputDir = process.env.COMFYUI_INPUT_DIR?.trim();
    const comfyBase = process.env.COMFYUI_BASE_URL?.trim() || "http://127.0.0.1:8188";

    if (!comfyInputDir) {
      return NextResponse.json(
        {
          error:
            "COMFYUI_INPUT_DIR is not configured. Set it to your ComfyUI installation's input folder so images can be copied for LoadImage.",
          comfyQueued: false,
        },
        { status: 503 }
      );
    }

    const inputRoot = path.resolve(comfyInputDir);
    fs.mkdirSync(inputRoot, { recursive: true });
    const safeFilename = path.basename(normalizeFilenameInput(filename || imagePath));
    const comfyFilename = `remove_${safeFilename}`.replace(/[^a-zA-Z0-9._-]/g, "_");
    const comfyInputPath = path.join(inputRoot, comfyFilename);
    await sharp(sourceInput)
      .resize({ width: 2048, height: 2048, fit: "inside" })
      .toFile(comfyInputPath);

    const outputBaseName = path.basename(safeFilename, path.extname(safeFilename));
    const effectiveFolderForOutput = resolvedLocalFolderName || localFolderName || taskId;
    const outputPrefix = effectiveFolderForOutput
      ? path.join(PHOTOS_ROOT, effectiveFolderForOutput, "3_Merged", `AI_REMOVE_${outputBaseName}`)
      : path.join(PHOTOS_ROOT, "3_Merged", `AI_REMOVE_${outputBaseName}`);
    const { workflow, positivePrompt } = buildRemovalWorkflow(comfyFilename, outputPrefix, removalTarget);

    const clientId = randomUUID();
    const promptUrl = `${comfyBase.replace(/\/$/, "")}/prompt`;

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

    return NextResponse.json({
      success: true,
      comfyQueued: true,
      promptId: comfyPayload?.prompt_id,
      imagePath: typeof sourceInput === "string" ? sourceInput : "",
      removalTarget,
      positivePrompt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI object removal failed.";
    return NextResponse.json({ error: message, comfyQueued: false }, { status: 400 });
  }
}
