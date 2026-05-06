import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PHOTOS_ROOT = "D:\\Photos_2026";

/** Windows illegal filename characters: < > : " / \ | ? * */
const ILLEGAL_WIN_CHARS = /[<>:"/\\|?*]/g;

export function sanitizeWindowsFolderName(name: string): string {
  const cleaned = name
    .replace(ILLEGAL_WIN_CHARS, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.\s]+$/g, "");
  return cleaned.length > 0 ? cleaned : "Photoshoot";
}

function formatCalendarDateForFolder(isoDate: string | null): string {
  if (!isoDate || !isoDate.trim()) return "";
  const d = isoDate.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : sanitizeWindowsFolderName(isoDate.trim());
}

/**
 * Folder label from Google Calendar–aligned fields stored on the task:
 * event title → `title`, location/address → `shoot_location`, event day → `photoshoot_date`.
 */
export function buildLocalFolderNameFromTask(row: {
  title: string | null;
  company_name: string | null;
  shoot_location: string | null;
  photoshoot_date: string | null;
}): string {
  const titlePart = (row.title?.trim() || row.company_name?.trim() || "Photoshoot").trim();
  const addressPart = row.shoot_location?.trim() || "";
  const datePart = formatCalendarDateForFolder(row.photoshoot_date);

  let raw: string;
  if (addressPart && datePart) {
    raw = `${titlePart} - ${addressPart} - ${datePart}`;
  } else if (datePart) {
    raw = `${titlePart} - ${datePart}`;
  } else if (addressPart) {
    raw = `${titlePart} - ${addressPart}`;
  } else {
    raw = titlePart;
  }

  return sanitizeWindowsFolderName(raw);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      task_id?: string | number;
      /** Calendar/event title (optional override for folder naming). */
      title?: string;
      /** Shoot location / address (optional override). */
      address?: string;
      /** Photoshoot date (ISO date string, optional override). */
      date?: string;
      client_name?: string;
    };
    const taskId = body.task_id != null ? String(body.task_id).trim() : "";

    if (!taskId) {
      return NextResponse.json({ error: "task_id is required." }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
    const supabaseKey = serviceRoleKey || supabaseAnonKey;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        {
          error:
            "Supabase client is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (recommended), or NEXT_PUBLIC_SUPABASE_ANON_KEY.",
        },
        { status: 503 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data: row, error: fetchError } = await supabase
      .from("tasks")
      .select("id, title, company_name, shoot_location, photoshoot_date")
      .eq("id", taskId)
      .single();

    if (fetchError || !row) {
      return NextResponse.json(
        { error: fetchError?.message ?? "Task not found." },
        { status: fetchError ? 502 : 404 }
      );
    }

    const titleOverride = typeof body.title === "string" ? body.title.trim() : "";
    const addressOverride = typeof body.address === "string" ? body.address.trim() : "";
    const dateOverride = typeof body.date === "string" ? body.date.trim() : "";

    const effectiveRow = {
      title: titleOverride || row.title,
      company_name: row.company_name,
      shoot_location: addressOverride || row.shoot_location,
      photoshoot_date: dateOverride || row.photoshoot_date,
    };

    const folderName = buildLocalFolderNameFromTask(effectiveRow);
    const base = path.join(PHOTOS_ROOT, folderName);

    for (const sub of ["1_Raw", "2_Selects", "3_Merged", "4_Final"]) {
      fs.mkdirSync(path.join(base, sub), { recursive: true });
    }

    const { error } = await supabase.from("tasks").update({ local_folder_name: folderName }).eq("id", taskId);

    if (error) {
      return NextResponse.json(
        { error: `Folders created but database update failed: ${error.message}`, folderName, base },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      folderName,
      basePath: base,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create folders.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
