import { createClient } from "@supabase/supabase-js";
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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      local_folder_name?: string;
      shootId?: string;
      bracketSize?: number;
      selectedChunkIndices?: number[];
    };

    const localFolderName = await resolveLocalFolderName({
      shootId: typeof body.shootId === "string" ? body.shootId : "",
      localFolderName: typeof body.local_folder_name === "string" ? body.local_folder_name : "",
    });
    const bracketSize = parseBracketSize(body.bracketSize ?? DEFAULT_BRACKET_SIZE);

    if (!Array.isArray(body.selectedChunkIndices)) {
      return NextResponse.json(
        { error: "selectedChunkIndices must be an array of numbers." },
        { status: 400 }
      );
    }

    const selectedIndices = Array.from(
      new Set(
        body.selectedChunkIndices
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value >= 0)
      )
    ).sort((a, b) => a - b);

    const rawDir = resolveTaskDir(localFolderName, "1_Raw");
    const sortedFiles = readNaturallySortedImageFiles(rawDir);
    const chunks = chunkFiles(sortedFiles, bracketSize);
    const selectedFiles = selectedIndices.flatMap((chunkIndex) => chunks[chunkIndex] ?? []);
    const skippedIndices = selectedIndices.filter((chunkIndex) => !chunks[chunkIndex]);

    const shootId = typeof body.shootId === "string" ? body.shootId.trim() : "";
    let taskStatusUpdated = false;
    let gallerySelectionSaved = false;
    let dbWarning: string | null = null;

    if (shootId) {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (supabaseUrl && supabaseAnonKey) {
        const supabase = createClient(supabaseUrl, supabaseAnonKey);

        let photoshootType = "";
        const { data: taskRow } = await supabase
          .from("tasks")
          .select("photoshoot_type")
          .eq("id", shootId)
          .maybeSingle();
        if (typeof taskRow?.photoshoot_type === "string") {
          photoshootType = taskRow.photoshoot_type.trim();
        }
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

        const { error: statusError } = await supabase
          .from("tasks")
          .update({ status: "Selection Available" })
          .eq("id", shootId);

        if (statusError) {
          dbWarning = `Task status was not updated: ${statusError.message}`;
        } else {
          taskStatusUpdated = true;

          const { error: selectionError } = await supabase
            .from("tasks")
            .update({ gallery_selection: selectionPayload })
            .eq("id", shootId);

          if (!selectionError) {
            gallerySelectionSaved = true;
          } else if (
            /gallery_selection|column|schema|Could not find/i.test(selectionError.message ?? "") ||
            selectionError.code === "PGRST204"
          ) {
            dbWarning =
              'Optional: add column tasks.gallery_selection (jsonb) to persist selection details in Supabase.';
          } else {
            dbWarning = `gallery_selection update: ${selectionError.message}`;
          }
        }
      } else {
        dbWarning = "Supabase env not configured; task status was not updated.";
      }
    }

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
