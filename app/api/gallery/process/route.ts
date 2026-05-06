import fs from "node:fs";
import path from "node:path";
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
import { PHOTOS_ROOT } from "@/lib/photosPaths";

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
    const selectsDir = resolveTaskDir(localFolderName, "2_Selects");
    fs.mkdirSync(selectsDir, { recursive: true });

    const sortedFiles = readNaturallySortedImageFiles(rawDir);
    const chunks = chunkFiles(sortedFiles, bracketSize);

    const movedFiles: string[] = [];
    const skippedIndices: number[] = [];
    const moveErrors: Array<{ file: string; error: string }> = [];

    for (const chunkIndex of selectedIndices) {
      const chunk = chunks[chunkIndex];
      if (!chunk) {
        skippedIndices.push(chunkIndex);
        continue;
      }

      for (const fileName of chunk) {
        const fromPath = path.join(rawDir, fileName);
        const toPath = path.join(selectsDir, fileName);

        if (!fs.existsSync(fromPath)) {
          moveErrors.push({ file: fileName, error: "Source file no longer exists." });
          continue;
        }

        try {
          fs.renameSync(fromPath, toPath);
          movedFiles.push(fileName);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Move failed.";
          moveErrors.push({ file: fileName, error: message });
        }
      }
    }

    const shootId = typeof body.shootId === "string" ? body.shootId.trim() : "";
    let taskStatusUpdated = false;
    let gallerySelectionSaved = false;
    let dbWarning: string | null = null;

    if (shootId) {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (supabaseUrl && supabaseAnonKey) {
        const supabase = createClient(supabaseUrl, supabaseAnonKey);
        const selectionPayload = {
          selected_chunk_indices: selectedIndices,
          moved_files: movedFiles,
          bracket_size: bracketSize,
          submitted_at: new Date().toISOString(),
        };

        const { error: statusError } = await supabase
          .from("tasks")
          .update({ status: "pending_processing" })
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
      success: moveErrors.length === 0,
      message:
        moveErrors.length === 0
          ? "Selected bracket groups moved from 1_Raw to 2_Selects."
          : "Processing completed with some move errors.",
      bracketSize,
      selectedChunkIndices: selectedIndices,
      movedCount: movedFiles.length,
      movedFiles,
      skippedIndices,
      errors: moveErrors,
      taskStatusUpdated,
      gallerySelectionSaved,
      dbWarning,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to process gallery selection.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
