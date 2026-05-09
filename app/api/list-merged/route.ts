import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
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

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: "Supabase Storage is not configured." }, { status: 503 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

  let resolvedLocalFolderName = localFolderName;
  if (!resolvedLocalFolderName && taskId) {
    const { data: taskRow } = await supabase
      .from("tasks")
      .select("local_folder_name")
      .eq("id", taskId)
      .maybeSingle();
    const maybeLocal = (taskRow as { local_folder_name?: unknown } | null)?.local_folder_name;
    resolvedLocalFolderName = typeof maybeLocal === "string" ? maybeLocal.trim() : "";
  }

  const folderPrefixes = [
    resolvedLocalFolderName ? sanitizeStoragePath(`${resolvedLocalFolderName}/3_Merged`) : "",
    taskId ? sanitizeStoragePath(`${taskId}/3_Merged`) : "",
  ].filter(Boolean);

  let files: string[] = [];
  let resolvedPrefix = folderPrefixes[0] ?? "";
  for (const prefix of folderPrefixes) {
    const { data: entries, error } = await supabase.storage.from(SUPABASE_FINALS_BUCKET).list(prefix, {
      limit: 1000,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) {
      continue;
    }
    const candidateFiles = (entries ?? [])
      .filter((entry) => entry.name && IMAGE_EXT.test(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
    if (candidateFiles.length > 0) {
      files = candidateFiles;
      resolvedPrefix = prefix;
      break;
    }
  }

  const items = files.map((name) => {
    const storagePath = sanitizeStoragePath(`${resolvedPrefix}/${name}`);
    const { data } = supabase.storage.from(SUPABASE_FINALS_BUCKET).getPublicUrl(storagePath);
    return {
      name,
      storagePath,
      url: data?.publicUrl ?? "",
    };
  });

  return NextResponse.json({ files, items, local_folder_name: resolvedLocalFolderName });
}
