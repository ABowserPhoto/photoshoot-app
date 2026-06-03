import path from "node:path";
import { NextResponse } from "next/server";

import { startProcessingSingleItem } from "@/app/services/processingEngine";
import { PHOTOS_ROOT } from "@/lib/photosPaths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProcessSingleItemBody = {
  taskId?: string;
  local_folder_name?: string;
  bracketIndex?: number;
};

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

  const shootFolderPath = path.join(PHOTOS_ROOT, localFolderName);
  const summary = await startProcessingSingleItem(taskId, shootFolderPath, bracketIndex);

  return NextResponse.json({
    success: summary.ok,
    taskId,
    local_folder_name: localFolderName,
    bracketIndex: summary.bracketIndex,
    totalBrackets: summary.totalBrackets,
    mergedFile: summary.mergedFile ?? null,
    expectedComfyJobs: summary.expectedComfyJobs,
    comfyQueuedCount: summary.comfyQueuedCount,
    comfyFailedCount: summary.comfyFailedCount,
    comfyErrors: summary.comfyErrors,
    error: summary.error,
  });
}
