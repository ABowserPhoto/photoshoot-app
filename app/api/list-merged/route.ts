import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { PHOTOS_ROOT } from "@/lib/photosPaths";
import { sanitizeStoragePath } from "@/lib/sanitizeStoragePath.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_FINALS_BUCKET = process.env.SUPABASE_FINALS_BUCKET?.trim() || "finals";
const IMAGE_EXT = /\.(jpe?g|png|tiff?|webp|bmp|gif)$/i;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const localFolderName = searchParams.get("local_folder_name")?.trim() ?? "";
  const taskId = searchParams.get("task_id")?.trim() ?? "";
  if (!localFolderName && !taskId) {
    return NextResponse.json({ error: "local_folder_name or task_id is required." }, { status: 400 });
  }

  if (localFolderName && (localFolderName.includes("..") || /[<>:"|?*]/.test(localFolderName))) {
    return NextResponse.json({ error: "Invalid local_folder_name." }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || "";
  const supabase =
    supabaseUrl && supabaseKey
      ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })
      : null;

  let resolvedLocalFolderName = localFolderName;
  if (!resolvedLocalFolderName && taskId && supabase) {
    const { data: taskRow } = await supabase
      .from("tasks")
      .select("local_folder_name")
      .eq("id", taskId)
      .maybeSingle();
    const maybeLocal = (taskRow as { local_folder_name?: unknown } | null)?.local_folder_name;
    resolvedLocalFolderName = typeof maybeLocal === "string" ? maybeLocal.trim() : "";
  }
  if (!resolvedLocalFolderName) {
    return NextResponse.json(
      { error: "Could not resolve local folder name for this task.", files: [], items: [] },
      { status: 404 }
    );
  }

  const localMergedDir = path.resolve(PHOTOS_ROOT, resolvedLocalFolderName, "3_Merged");
  const rootResolved = path.resolve(PHOTOS_ROOT);
  if (!localMergedDir.toLowerCase().startsWith(rootResolved.toLowerCase() + path.sep)) {
    return NextResponse.json({ error: "Access denied." }, { status: 403 });
  }
  const localFiles = fs.existsSync(localMergedDir)
    ? fs
        .readdirSync(localMergedDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && IMAGE_EXT.test(entry.name))
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
    : [];

  const folderPrefixes = [
    resolvedLocalFolderName ? sanitizeStoragePath(`${resolvedLocalFolderName}/3_Merged`) : "",
    taskId ? sanitizeStoragePath(`${taskId}/3_Merged`) : "",
  ].filter(Boolean);
  const supabaseItemsByName = new Map<string, { storagePath: string; displayUrl: string }>();
  if (supabase) {
    for (const prefix of folderPrefixes) {
      const { data: entries, error } = await supabase.storage.from(SUPABASE_FINALS_BUCKET).list(prefix, {
        limit: 1000,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) {
        continue;
      }
      for (const entry of entries ?? []) {
        if (!entry.name || !IMAGE_EXT.test(entry.name) || supabaseItemsByName.has(entry.name)) {
          continue;
        }
        const storagePath = sanitizeStoragePath(`${prefix}/${entry.name}`);
        const { data } = supabase.storage.from(SUPABASE_FINALS_BUCKET).getPublicUrl(storagePath);
        supabaseItemsByName.set(entry.name, {
          storagePath,
          displayUrl: data?.publicUrl ?? "",
        });
      }
    }
  }

  const names = Array.from(new Set([...localFiles, ...Array.from(supabaseItemsByName.keys())])).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
  );
  const files = names;
  const items = names.map((name) => {
    const absoluteLocalPath = path.join(localMergedDir, name);
    const proxyUrl = `/api/local-image?path=${encodeURIComponent(absoluteLocalPath)}`;
    const supabaseItem = supabaseItemsByName.get(name);
    return {
      name,
      storagePath: supabaseItem?.storagePath ?? "",
      absoluteLocalPath,
      displayUrl: supabaseItem?.displayUrl || proxyUrl,
    };
  });

  return NextResponse.json({
    files,
    items,
    local_folder_name: resolvedLocalFolderName,
    local_merged_dir: localMergedDir,
  });
}
