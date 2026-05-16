import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMFY_BASE_URL = process.env.COMFYUI_BASE_URL?.trim() || "http://127.0.0.1:8188";

type WorkflowNode = {
  inputs?: Record<string, unknown>;
  class_type?: string;
  _meta?: { title?: string };
};

function loadTextToVideoWorkflowTemplate(): Record<string, WorkflowNode> {
  const workflowPath = path.join(process.cwd(), "lib", "comfy", "Text_to_Video.json");
  const raw = fs.readFileSync(workflowPath, "utf8");
  return JSON.parse(raw) as Record<string, WorkflowNode>;
}

function random15DigitInteger(): number {
  return Math.floor(100_000_000_000_000 + Math.random() * 900_000_000_000_000);
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const promptEntry = formData.get("prompt");
    const prompt = typeof promptEntry === "string" ? promptEntry.trim() : "";

    const workflow = loadTextToVideoWorkflowTemplate();
    const promptNode = workflow["7"];
    const samplerNode = workflow["10"];
    if (!promptNode?.inputs || !samplerNode?.inputs) {
      return NextResponse.json(
        { error: "Text-to-video workflow template missing required nodes: 7 or 10." },
        { status: 500 }
      );
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
    const message = error instanceof Error ? error.message : "Failed to trigger text-to-video workflow.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
