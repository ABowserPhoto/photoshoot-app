import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { DEFAULT_BRACKET_SIZE, parseBracketSize } from "@/app/api/gallery/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GalleryItem = {
  chunkIndex: number;
  firstFilename: string;
  previewUrl: string;
  storagePath: string;
};

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

async function generateGalleryFromSupabase(shootId: string, bracketSize: number) {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    throw new Error("Supabase server credentials are not configured.");
  }

  const { data, error } = await supabase
    .from("tasks")
    .select("local_folder_name, gallery_previews, status")
    .eq("id", shootId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load gallery previews: ${error.message}`);
  }

  const items = Array.isArray(data?.gallery_previews?.items) ? data.gallery_previews.items : [];
  const gallery: GalleryItem[] = items
    .map((item: unknown) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const row = item as {
        chunkIndex?: unknown;
        firstFilename?: unknown;
        middleFilename?: unknown;
        previewUrl?: unknown;
        storagePath?: unknown;
      };
      const chunkIndex = Number(row.chunkIndex);
      const firstFilename =
        typeof row.firstFilename === "string"
          ? row.firstFilename
          : typeof row.middleFilename === "string"
            ? row.middleFilename
            : "";
      const previewUrl = typeof row.previewUrl === "string" ? row.previewUrl : "";
      const storagePath = typeof row.storagePath === "string" ? row.storagePath : "";
      if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || !firstFilename || !previewUrl || !storagePath) {
        return null;
      }
      return { chunkIndex, firstFilename, previewUrl, storagePath };
    })
    .filter((value): value is GalleryItem => value !== null)
    .sort((a, b) => a.chunkIndex - b.chunkIndex);

  return {
    success: true,
    localFolderName: data?.local_folder_name ?? "",
    status: typeof data?.status === "string" ? data.status : "",
    bracketSize,
    totalChunks: gallery.length,
    gallery,
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const shootId = searchParams.get("shootId")?.trim() ?? "";
    if (!shootId) {
      return NextResponse.json({ error: "shootId is required." }, { status: 400 });
    }
    const bracketSize = parseBracketSize(searchParams.get("bracketSize"));
    return NextResponse.json(await generateGalleryFromSupabase(shootId, bracketSize));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate gallery.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      shootId?: string;
      bracketSize?: number;
    };
    const shootId = typeof body.shootId === "string" ? body.shootId.trim() : "";
    if (!shootId) {
      return NextResponse.json({ error: "shootId is required." }, { status: 400 });
    }
    const bracketSize = parseBracketSize(body.bracketSize ?? DEFAULT_BRACKET_SIZE);
    return NextResponse.json(await generateGalleryFromSupabase(shootId, bracketSize));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate gallery.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
