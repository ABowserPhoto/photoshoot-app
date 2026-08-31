import fs from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { PHOTOS_ROOT } from "@/lib/photosPaths";
import { getAuthRole } from "@/lib/server/getAuthRole";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MERGEABLE_STATUSES = new Set([
  "Selection Available",
  "Selection Failed",
  "pending_processing",
  "syncing_selection",
  "Processing",
]);

const IMAGE_EXT = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".tif",
  ".tiff",
  ".webp",
  ".bmp",
  ".gif",
  ".heic",
  ".heif",
  ".nef",
  ".arw",
  ".cr2",
  ".cr3",
  ".dng",
]);

function isImageFile(fileName: string): boolean {
  return IMAGE_EXT.has(path.extname(fileName).toLowerCase());
}

function selectsFolderHasImages(localFolderName: string): boolean {
  const selectsDir = path.join(PHOTOS_ROOT, localFolderName, "2_Selects");
  if (!fs.existsSync(selectsDir)) {
    return false;
  }
  try {
    return fs.readdirSync(selectsDir).some((name) => isImageFile(name));
  } catch {
    return false;
  }
}

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !key) {
    return null;
  }
  return createClient(supabaseUrl, key, { auth: { persistSession: false } });
}

export async function POST(request: Request) {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { taskId?: string };
  try {
    body = (await request.json()) as { taskId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const taskId = typeof body.taskId === "string" ? body.taskId.trim() : "";
  if (!taskId) {
    return NextResponse.json({ error: "taskId is required." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  const { data: task, error: fetchError } = await supabase
    .from("tasks")
    .select("id, status, local_folder_name, gallery_selection")
    .eq("id", taskId)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!task) {
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }

  const status = typeof task.status === "string" ? task.status.trim() : "";
  if (!MERGEABLE_STATUSES.has(status)) {
    return NextResponse.json(
      { error: `Task status "${status || "unknown"}" cannot be queued for merge.` },
      { status: 400 }
    );
  }

  const localFolderName =
    typeof task.local_folder_name === "string" ? task.local_folder_name.trim() : "";
  if (!localFolderName) {
    return NextResponse.json({ error: "Task has no local_folder_name." }, { status: 400 });
  }

  const hasSelects = selectsFolderHasImages(localFolderName);
  const existingSelection =
    task.gallery_selection && typeof task.gallery_selection === "object"
      ? (task.gallery_selection as Record<string, unknown>)
      : {};

  const nextSelection = {
    ...existingSelection,
    merge_priority_at: new Date().toISOString(),
    merge_priority_by: "manual",
  };

  const updates: Record<string, unknown> = {
    gallery_selection: nextSelection,
    updated_at: new Date().toISOString(),
  };

  let nextStatus = status;
  if (status === "Processing") {
    updates.status = "pending_processing";
    nextStatus = "pending_processing";
  } else if (status === "syncing_selection") {
    updates.status = hasSelects ? "pending_processing" : "Selection Available";
    nextStatus = updates.status as string;
  } else if ((status === "Selection Available" || status === "Selection Failed") && hasSelects) {
    updates.status = "pending_processing";
    updates.processing_error = null;
    nextStatus = "pending_processing";
  } else if (status === "Selection Available" || status === "Selection Failed") {
    nextStatus = status;
  }

  const { error: updateError } = await supabase.from("tasks").update(updates).eq("id", taskId);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    taskId,
    queued: true,
    status: nextStatus,
    hasSelects,
    message: hasSelects
      ? "Merge queued with priority. The local worker will start immediately."
      : "Merge prioritized. The worker will sync client selections into 2_Selects first, then merge.",
  });
}
