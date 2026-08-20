import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import {
  chunkFiles,
  DEFAULT_BRACKET_SIZE,
  parseBracketSize,
  readNaturallySortedImageFiles,
  resolveLocalFolderName,
  resolveTaskDir,
} from "@/app/api/gallery/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getServiceSupabase(): SupabaseClient | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceKey) {
    return null;
  }
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });
}

function filenamesFromGalleryPreviews(
  galleryPreviews: unknown,
  selectedIndices: number[]
): string[] {
  const items =
    galleryPreviews &&
    typeof galleryPreviews === "object" &&
    Array.isArray((galleryPreviews as { items?: unknown }).items)
      ? ((galleryPreviews as { items: unknown[] }).items)
      : [];

  const byChunk = new Map<number, string>();
  for (const item of items) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as {
      chunkIndex?: unknown;
      firstFilename?: unknown;
      middleFilename?: unknown;
    };
    const chunkIndex = Number(row.chunkIndex);
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
      continue;
    }
    const filename =
      (typeof row.firstFilename === "string" && row.firstFilename.trim()) ||
      (typeof row.middleFilename === "string" && row.middleFilename.trim()) ||
      "";
    if (filename) {
      byChunk.set(chunkIndex, filename);
    }
  }

  return selectedIndices
    .map((index) => byChunk.get(index))
    .filter((name): name is string => Boolean(name));
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      local_folder_name?: string;
      shootId?: string;
      bracketSize?: number;
      selectedChunkIndices?: number[];
      selected_chunk_indices?: number[];
    };

    const localFolderName = await resolveLocalFolderName({
      shootId: typeof body.shootId === "string" ? body.shootId : "",
      localFolderName: typeof body.local_folder_name === "string" ? body.local_folder_name : "",
    });
    const bracketSize = parseBracketSize(body.bracketSize ?? DEFAULT_BRACKET_SIZE);

    const rawSelectedIndices = Array.isArray(body.selectedChunkIndices)
      ? body.selectedChunkIndices
      : Array.isArray(body.selected_chunk_indices)
        ? body.selected_chunk_indices
        : null;

    if (!Array.isArray(rawSelectedIndices)) {
      return NextResponse.json(
        { error: "selectedChunkIndices must be an array of numbers." },
        { status: 400 }
      );
    }

    const selectedIndices = Array.from(
      new Set(
        rawSelectedIndices
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value >= 0)
      )
    ).sort((a, b) => a - b);

    if (selectedIndices.length === 0) {
      return NextResponse.json(
        { error: "selectedChunkIndices must include at least one scene." },
        { status: 400 }
      );
    }

    // Local disk is optional (cloud gallery hosts often have no 1_Raw). Worker resolves
    // files from selected_chunk_indices + local RAW brackets; filenames are best-effort.
    const rawDir = resolveTaskDir(localFolderName, "1_Raw");
    const sortedFiles = readNaturallySortedImageFiles(rawDir);
    const chunks = chunkFiles(sortedFiles, bracketSize);
    let selectedFiles = selectedIndices.flatMap((chunkIndex) => chunks[chunkIndex] ?? []);
    const skippedIndices = selectedIndices.filter((chunkIndex) => !chunks[chunkIndex]);

    const shootId = typeof body.shootId === "string" ? body.shootId.trim() : "";
    let taskStatusUpdated = false;
    let gallerySelectionSaved = false;
    let dbWarning: string | null = null;

    if (!shootId) {
      return NextResponse.json(
        {
          success: false,
          error: "shootId is required to save the selection and update Kanban status.",
          taskStatusUpdated: false,
          gallerySelectionSaved: false,
        },
        { status: 400 }
      );
    }

    const supabase = getServiceSupabase();
    if (!supabase) {
      return NextResponse.json(
        {
          success: false,
          error:
            "SUPABASE_SERVICE_ROLE_KEY is required to save gallery selections under RLS. Anon key writes are denied.",
          taskStatusUpdated: false,
          gallerySelectionSaved: false,
          dbWarning: "Missing SUPABASE_SERVICE_ROLE_KEY.",
        },
        { status: 503 }
      );
    }

    const { data: taskRow, error: taskLoadError } = await supabase
      .from("tasks")
      .select("photoshoot_type, gallery_previews")
      .eq("id", shootId)
      .maybeSingle();

    if (taskLoadError) {
      return NextResponse.json(
        {
          success: false,
          error: `Failed to load task: ${taskLoadError.message}`,
          taskStatusUpdated: false,
          gallerySelectionSaved: false,
        },
        { status: 500 }
      );
    }
    if (!taskRow) {
      return NextResponse.json(
        {
          success: false,
          error: "Task not found for this gallery link.",
          taskStatusUpdated: false,
          gallerySelectionSaved: false,
        },
        { status: 404 }
      );
    }

    if (selectedFiles.length === 0) {
      selectedFiles = filenamesFromGalleryPreviews(taskRow.gallery_previews, selectedIndices);
    }

    const photoshootType =
      typeof taskRow.photoshoot_type === "string" ? taskRow.photoshoot_type.trim() : "";
    const normalizedType = photoshootType.toLowerCase();
    const requiresMerge =
      normalizedType === "immobilien" || normalizedType === "real estate";

    const selectionPayload = {
      selected_chunk_indices: selectedIndices,
      selected_files: selectedFiles,
      bracket_size: bracketSize,
      local_folder_name: localFolderName,
      photoshoot_type: photoshootType,
      requires_merge: requiresMerge,
      submitted_at: new Date().toISOString(),
    };

    // Atomic write + row verification. Under RLS, anon updates return no error and 0 rows;
    // service_role must be used, and we must confirm a row was updated.
    const { data: updatedRow, error: updateError } = await supabase
      .from("tasks")
      .update({
        status: "Selection Available",
        gallery_selection: selectionPayload,
      })
      .eq("id", shootId)
      .select("id, status")
      .maybeSingle();

    if (updateError) {
      dbWarning = updateError.message;
      return NextResponse.json(
        {
          success: false,
          error: `Could not save selection: ${updateError.message}`,
          taskStatusUpdated: false,
          gallerySelectionSaved: false,
          dbWarning,
        },
        { status: 500 }
      );
    }

    if (!updatedRow?.id) {
      dbWarning = "Task update matched 0 rows (check shootId / RLS / service role).";
      return NextResponse.json(
        {
          success: false,
          error: dbWarning,
          taskStatusUpdated: false,
          gallerySelectionSaved: false,
          dbWarning,
        },
        { status: 409 }
      );
    }

    taskStatusUpdated = updatedRow.status === "Selection Available";
    gallerySelectionSaved = true;

    return NextResponse.json({
      success: true,
      message:
        "Selection saved. Local worker will copy selected files into 2_Selects (Immobilien continues to merge; other types stay on Selection Available).",
      bracketSize,
      selectedChunkIndices: selectedIndices,
      selectedFilesCount: selectedFiles.length,
      selectedFiles,
      skippedIndices,
      errors: [],
      taskStatusUpdated,
      gallerySelectionSaved,
      dbWarning,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to process gallery selection.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
