import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { readNaturallySortedImageFiles, resolveTaskDir } from "@/app/api/gallery/_shared";
import { sanitizeStoragePath } from "@/lib/sanitizeStoragePath";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_PREVIEWS_BUCKET = process.env.SUPABASE_PREVIEWS_BUCKET?.trim() || "previews";
const LOCAL_PREVIEWS_DIR = path.join(process.cwd(), "public", "previews");
function getSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) {
    return null;
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

async function deleteSupabasePreviewObjects(
  supabase: ReturnType<typeof createClient>,
  localFolderName: string,
  taskId: string
) {
  const removedPaths: string[] = [];
  const coverPath = `cover_${taskId}.jpg`;

  const { error: coverRemoveError } = await supabase.storage
    .from(SUPABASE_PREVIEWS_BUCKET)
    .remove([coverPath]);
  if (!coverRemoveError) {
    removedPaths.push(coverPath);
  }

  const { data: listed, error: listError } = await supabase.storage
    .from(SUPABASE_PREVIEWS_BUCKET)
    .list(sanitizeStoragePath(localFolderName), { limit: 1000 });
  if (listError) {
    throw new Error(`Failed to list preview objects: ${listError.message}`);
  }

  const folderObjectPaths = (listed ?? [])
    .map((entry) => entry.name)
    .filter((name) => Boolean(name?.trim()))
    .map((name) => `${sanitizeStoragePath(localFolderName)}/${name}`);

  if (folderObjectPaths.length > 0) {
    const { error: removeError } = await supabase.storage
      .from(SUPABASE_PREVIEWS_BUCKET)
      .remove(folderObjectPaths);
    if (removeError) {
      throw new Error(`Failed to delete preview objects: ${removeError.message}`);
    }
    removedPaths.push(...folderObjectPaths);
  }

  return removedPaths;
}

function deleteLegacyLocalPreviewFiles(localFolderName: string) {
  if (!fs.existsSync(LOCAL_PREVIEWS_DIR)) {
    return [];
  }

  const safeFolderToken = localFolderName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const removed: string[] = [];
  for (const entry of fs.readdirSync(LOCAL_PREVIEWS_DIR, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".jpg")) {
      continue;
    }
    if (!entry.name.includes(safeFolderToken)) {
      continue;
    }
    const filePath = path.join(LOCAL_PREVIEWS_DIR, entry.name);
    fs.unlinkSync(filePath);
    removed.push(filePath);
  }
  return removed;
}

async function touchRawFolderForWorker(localFolderName: string) {
  const rawDir = resolveTaskDir(localFolderName, "1_Raw");
  const files = readNaturallySortedImageFiles(rawDir);
  if (files.length === 0) {
    return false;
  }
  const targetPath = path.join(rawDir, files[0]!);
  const now = new Date();
  await fs.promises.utimes(targetPath, now, now);
  return true;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { taskId?: unknown } | null;
    const taskId = typeof body?.taskId === "string" ? body.taskId.trim() : "";
    if (!taskId) {
      return NextResponse.json({ error: "taskId is required." }, { status: 400 });
    }

    const supabase = getSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json({ error: "Supabase server credentials are not configured." }, { status: 503 });
    }

    const { data: task, error: fetchError } = await supabase
      .from("tasks")
      .select("id, local_folder_name, gallery_previews, cover_image_url")
      .eq("id", taskId)
      .maybeSingle();

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }
    if (!task) {
      return NextResponse.json({ error: "Task not found." }, { status: 404 });
    }

    const localFolderName = typeof task.local_folder_name === "string" ? task.local_folder_name.trim() : "";
    if (!localFolderName) {
      return NextResponse.json({ error: "Task has no local_folder_name." }, { status: 400 });
    }

    const removedStoragePaths = await deleteSupabasePreviewObjects(supabase, localFolderName, taskId);
    const removedLocalPaths = deleteLegacyLocalPreviewFiles(localFolderName);

    const { error: updateError } = await supabase
      .from("tasks")
      .update({
        gallery_previews: null,
        cover_image_url: null,
      })
      .eq("id", taskId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    const workerTriggered = await touchRawFolderForWorker(localFolderName);

    return NextResponse.json({
      success: true,
      taskId,
      localFolderName,
      removedStoragePaths,
      removedLocalPaths,
      workerTriggered,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to queue preview regeneration.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
