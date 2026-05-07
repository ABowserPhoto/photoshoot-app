import path from "node:path";
import { NextResponse } from "next/server";

import { startProcessing } from "@/app/services/processingEngine";
import { PHOTOS_ROOT } from "@/lib/photosPaths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProcessTaskBody = {
  taskId?: string;
  local_folder_name?: string;
};

export async function POST(request: Request) {
  const workerSecret = process.env.LOCAL_WORKER_SECRET?.trim();
  const suppliedSecret = request.headers.get("x-worker-secret")?.trim();

  if (!workerSecret || suppliedSecret !== workerSecret) {
    return NextResponse.json({ error: "Unauthorized worker request." }, { status: 401 });
  }

  let body: ProcessTaskBody;
  try {
    body = (await request.json()) as ProcessTaskBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const taskId = typeof body.taskId === "string" ? body.taskId.trim() : "";
  const localFolderName =
    typeof body.local_folder_name === "string" ? body.local_folder_name.trim() : "";

  if (!taskId || !localFolderName) {
    return NextResponse.json(
      { error: "taskId and local_folder_name are required." },
      { status: 400 }
    );
  }

  const shootFolderPath = path.join(PHOTOS_ROOT, localFolderName);
  const summary = await startProcessing(taskId, shootFolderPath);

  return NextResponse.json({
    success: summary.ok,
    taskId,
    local_folder_name: localFolderName,
    mergedFiles: summary.mergedFiles ?? [],
    comfyQueuedCount: summary.comfyQueuedCount ?? 0,
    comfyFailedCount: summary.comfyFailedCount ?? 0,
    comfyErrors: summary.comfyErrors ?? [],
    error: summary.error,
  });
}
