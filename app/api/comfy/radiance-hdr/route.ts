import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { PHOTOS_ROOT } from "@/lib/photosPaths";
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

type RadianceParamKey =
  | "shadow_amount"
  | "highlight_amount"
  | "shadow_tone"
  | "highlight_tone"
  | "color_correction"
  | "local_contrast"
  | "creative_white_scale"
  | "exposure_adjust"
  | "gamut_compress";

type ParamRule = {
  min: number;
  max: number;
  fallback: number;
};

const PARAM_RULES: Record<RadianceParamKey, ParamRule> = {
  shadow_amount: { min: 0, max: 1, fallback: 0.5 },
  highlight_amount: { min: 0, max: 1, fallback: 0.5 },
  shadow_tone: { min: 0, max: 1, fallback: 0.25 },
  highlight_tone: { min: 0, max: 1, fallback: 0.75 },
  color_correction: { min: 0, max: 1, fallback: 0.5 },
  local_contrast: { min: -1, max: 1, fallback: 0 },
  creative_white_scale: { min: 0.5, max: 2, fallback: 1 },
  exposure_adjust: { min: -4, max: 4, fallback: 0 },
  gamut_compress: { min: 0, max: 2, fallback: 1 },
};

function loadRadianceWorkflowTemplate(): Record<string, WorkflowNode> {
  const workflowPath = path.join(process.cwd(), "lib", "comfy", "Radiance_HDR_Edit.json");
  const raw = fs.readFileSync(workflowPath, "utf8");
  return JSON.parse(raw) as Record<string, WorkflowNode>;
}

function parseAndClamp(raw: FormDataEntryValue | null, rule: ParamRule): number {
  const parsed = typeof raw === "string" ? Number(raw) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return rule.fallback;
  }
  return Math.min(rule.max, Math.max(rule.min, parsed));
}

function findNodeIdByTitleIncludes(workflow: Record<string, WorkflowNode>, titleFragment: string): string | null {
  const wanted = titleFragment.trim().toLowerCase();
  for (const [nodeId, node] of Object.entries(workflow)) {
    const title = node?._meta?.title?.toLowerCase() ?? "";
    if (title.includes(wanted)) {
      return nodeId;
    }
  }
  return null;
}

function findNodeIdByClassType(workflow: Record<string, WorkflowNode>, classType: string): string | null {
  for (const [nodeId, node] of Object.entries(workflow)) {
    if (node?.class_type === classType) {
      return nodeId;
    }
  }
  return null;
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

function resolveLocalSourcePath(sourceImagePath: string, filename: string, taskId: string): string {
  const trimmedPath = sourceImagePath.trim();
  if (trimmedPath) {
    return resolveAndValidateAbsoluteImagePath(trimmedPath);
  }
  if (!filename.trim()) {
    throw new Error("sourceImagePath or filename is required.");
  }
  return resolveSourceImagePath(filename, taskId);
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const filename = typeof formData.get("filename") === "string" ? String(formData.get("filename")).trim() : "";
    const sourceImagePath =
      typeof formData.get("sourceImagePath") === "string" ? String(formData.get("sourceImagePath")).trim() : "";
    const taskIdEntry = formData.get("taskId") ?? formData.get("task_id");
    const taskId = typeof taskIdEntry === "string" ? taskIdEntry.trim() : "";

    const localSourcePath = resolveLocalSourcePath(sourceImagePath, filename, taskId);
    const sourceExt = path.extname(localSourcePath).toLowerCase() || ".jpg";
    const comfyInputFilename = `temp_radiance_${Date.now()}_${randomUUID().slice(0, 8)}${sourceExt}`;

    fs.mkdirSync(path.resolve(COMFY_INPUT_DIR), { recursive: true });
    fs.copyFileSync(localSourcePath, path.join(path.resolve(COMFY_INPUT_DIR), comfyInputFilename));

    const workflow = loadRadianceWorkflowTemplate();

    const loadImageNodeId =
      findNodeIdByTitleIncludes(workflow, "Radiance Load Image") ||
      findNodeIdByClassType(workflow, "RadianceLoadImageMask");
    const shadowHighlightNodeId = findNodeIdByTitleIncludes(workflow, "Radiance HDR Shadow/Highlight Recovery");
    const acesOutputNodeId = findNodeIdByTitleIncludes(workflow, "Radiance ACES 2.0 Output Transform");

    if (!loadImageNodeId || !shadowHighlightNodeId || !acesOutputNodeId) {
      return NextResponse.json(
        {
          error:
            "Radiance workflow template is missing required nodes (Load Image, HDR Shadow/Highlight Recovery, ACES Output Transform).",
        },
        { status: 500 }
      );
    }

    const loadImageNode = workflow[loadImageNodeId];
    const shadowHighlightNode = workflow[shadowHighlightNodeId];
    const acesOutputNode = workflow[acesOutputNodeId];
    if (!loadImageNode?.inputs || !shadowHighlightNode?.inputs || !acesOutputNode?.inputs) {
      return NextResponse.json({ error: "Radiance workflow has invalid node inputs." }, { status: 500 });
    }

    const shadowAmount = parseAndClamp(formData.get("shadow_amount"), PARAM_RULES.shadow_amount);
    const highlightAmount = parseAndClamp(formData.get("highlight_amount"), PARAM_RULES.highlight_amount);
    const shadowTone = parseAndClamp(formData.get("shadow_tone"), PARAM_RULES.shadow_tone);
    const highlightTone = parseAndClamp(formData.get("highlight_tone"), PARAM_RULES.highlight_tone);
    const colorCorrection = parseAndClamp(formData.get("color_correction"), PARAM_RULES.color_correction);
    const localContrast = parseAndClamp(formData.get("local_contrast"), PARAM_RULES.local_contrast);
    const creativeWhiteScale = parseAndClamp(formData.get("creative_white_scale"), PARAM_RULES.creative_white_scale);
    const exposureAdjust = parseAndClamp(formData.get("exposure_adjust"), PARAM_RULES.exposure_adjust);
    const gamutCompress = parseAndClamp(formData.get("gamut_compress"), PARAM_RULES.gamut_compress);

    loadImageNode.inputs.image = comfyInputFilename;

    shadowHighlightNode.inputs.shadow_amount = shadowAmount;
    shadowHighlightNode.inputs.highlight_amount = highlightAmount;
    shadowHighlightNode.inputs.shadow_tone = shadowTone;
    shadowHighlightNode.inputs.highlight_tone = highlightTone;
    shadowHighlightNode.inputs.color_correction = colorCorrection;
    shadowHighlightNode.inputs.local_contrast = localContrast;

    acesOutputNode.inputs.creative_white_scale = creativeWhiteScale;
    acesOutputNode.inputs.exposure_adjust = exposureAdjust;
    acesOutputNode.inputs.gamut_compress = gamutCompress;

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
      | { prompt_id?: string; error?: unknown; detail?: unknown }
      | null;

    if (!response.ok) {
      const detail =
        (typeof payload?.detail === "string" && payload.detail) ||
        (typeof payload?.error === "string" && payload.error) ||
        `ComfyUI request failed (${response.status}).`;
      return NextResponse.json({ error: detail }, { status: 502 });
    }

    return NextResponse.json({
      success: true,
      prompt_id: payload?.prompt_id ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to trigger Radiance HDR workflow.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
