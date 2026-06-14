import path from "node:path";
import { NextResponse } from "next/server";

import { PHOTOS_ROOT } from "@/lib/photosPaths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Vercel hobby cap is 300s; local desktop worker has no serverless limit. */
export const maxDuration = 300;

type ProcessSingleItemBody = {
  taskId?: string;
  local_folder_name?: string;
  bracketIndex?: number;
};

type SingleItemProcessingSummary = {
  ok: boolean;
  bracketIndex: number;
  totalBrackets: number;
  mergedFile?: string;
  expectedComfyJobs: number;
  comfyQueuedCount: number;
  comfyFailedCount: number;
  comfyErrors: string[];
  error?: string;
};

function emptySummary(bracketIndex: number): SingleItemProcessingSummary {
  return {
    ok: false,
    bracketIndex,
    totalBrackets: 0,
    expectedComfyJobs: 0,
    comfyQueuedCount: 0,
    comfyFailedCount: 0,
    comfyErrors: [],
  };
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return fallback;
}

function buildResponse(
  summary: SingleItemProcessingSummary,
  meta: { taskId: string; localFolderName: string }
) {
  return NextResponse.json({
    success: summary.ok,
    taskId: meta.taskId,
    local_folder_name: meta.localFolderName,
    bracketIndex: summary.bracketIndex,
    totalBrackets: summary.totalBrackets,
    mergedFile: summary.mergedFile ?? null,
    expectedComfyJobs: summary.expectedComfyJobs,
    comfyQueuedCount: summary.comfyQueuedCount,
    comfyFailedCount: summary.comfyFailedCount,
    comfyErrors: summary.comfyErrors,
    error: summary.error ?? null,
  });
}

export async function POST(request: Request) {
  const workerSecret = process.env.LOCAL_WORKER_SECRET?.trim();
  const suppliedSecret = request.headers.get("x-worker-secret")?.trim();

  if (!workerSecret || suppliedSecret !== workerSecret) {
    return NextResponse.json({ error: "Unauthorized worker request." }, { status: 401 });
  }

  let body: ProcessSingleItemBody;
  try {
    body = (await request.json()) as ProcessSingleItemBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const taskId = typeof body.taskId === "string" ? body.taskId.trim() : "";
  const localFolderName =
    typeof body.local_folder_name === "string" ? body.local_folder_name.trim() : "";
  const bracketIndex = Number(body.bracketIndex);

  if (!taskId || !localFolderName || !Number.isInteger(bracketIndex) || bracketIndex < 0) {
    return NextResponse.json(
      { error: "taskId, local_folder_name, and non-negative integer bracketIndex are required." },
      { status: 400 }
    );
  }

  try {
    const { startProcessingSingleItem } = await import("@/app/services/processingEngine");
    const shootFolderPath = path.join(PHOTOS_ROOT, localFolderName);
    const summary = await startProcessingSingleItem(taskId, shootFolderPath, bracketIndex);
    return buildResponse(summary, { taskId, localFolderName });
  } catch (error) {
    const message = toErrorMessage(error, "Unexpected single-item processing failure.");
    console.error("[process-single-item] Unhandled failure:", { taskId, localFolderName, bracketIndex, error });
    return buildResponse(
      {
        ...emptySummary(bracketIndex),
        error: message,
      },
      { taskId, localFolderName }
    );
  }
}
