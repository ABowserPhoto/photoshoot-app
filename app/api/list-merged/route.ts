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
  if (!localFolderName) {
    return NextResponse.json({ error: "local_folder_name is required." }, { status: 400 });
  }

  if (localFolderName.includes("..") || /[<>:"|?*]/.test(localFolderName)) {
    return NextResponse.json({ error: "Invalid local_folder_name." }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: "Supabase Storage is not configured." }, { status: 503 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  const folderPrefix = sanitizeStoragePath(`${localFolderName}/3_Merged`);
  const { data: entries, error } = await supabase.storage.from(SUPABASE_FINALS_BUCKET).list(folderPrefix, {
    limit: 1000,
    sortBy: { column: "name", order: "asc" },
  });
  if (error) {
    return NextResponse.json({ error: `Failed to list storage files: ${error.message}` }, { status: 502 });
  }

  const files = (entries ?? [])
    .filter((entry) => entry.name && IMAGE_EXT.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  const items = files.map((name) => {
    const storagePath = sanitizeStoragePath(`${folderPrefix}/${name}`);
    const { data } = supabase.storage.from(SUPABASE_FINALS_BUCKET).getPublicUrl(storagePath);
    return {
      name,
      storagePath,
      url: data?.publicUrl ?? "",
    };
  });

  return NextResponse.json({ files, items });
}
