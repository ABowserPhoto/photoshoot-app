import { NextResponse } from "next/server";

import { getAuthRole } from "@/lib/server/getAuthRole";
import {
  canViewNoteVisibility,
  getNotesSupabase,
  mapNote,
  NOTE_SELECT_COLUMNS,
  NOTE_VISIBILITIES,
  type NoteRow,
  type NoteVisibility,
} from "@/lib/server/notesSupabase";

export const dynamic = "force-dynamic";

function parseVisibility(
  value: unknown,
  isAdmin: boolean
): { ok: true; value: NoteVisibility } | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: "user" };
  }
  if (typeof value !== "string" || !NOTE_VISIBILITIES.includes(value as NoteVisibility)) {
    return { ok: false, error: "visibility must be public, user, or admin_only." };
  }
  const visibility = value as NoteVisibility;
  if (visibility === "admin_only" && !isAdmin) {
    return { ok: false, error: "Only admins can create admin_only notes." };
  }
  return { ok: true, value: visibility };
}

/**
 * GET /api/notes?moodboardId=...
 * Returns the note linked to a moodboard (if visible to the current user).
 */
export async function GET(request: Request) {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getNotesSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  const moodboardId = new URL(request.url).searchParams.get("moodboardId")?.trim() ?? "";
  if (!moodboardId) {
    return NextResponse.json(
      { error: "moodboardId query parameter is required." },
      { status: 400 }
    );
  }

  let query = supabase
    .from("notes")
    .select(NOTE_SELECT_COLUMNS)
    .eq("moodboard_id", moodboardId)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (!auth.isAdmin) {
    query = query.neq("visibility", "admin_only");
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ note: null });
  }

  const row = data as NoteRow;
  if (!canViewNoteVisibility(row.visibility, auth.isAdmin)) {
    return NextResponse.json({ note: null });
  }

  return NextResponse.json({ note: mapNote(row) });
}

/**
 * POST /api/notes
 * Body: { notebookId: string, title?: string, content?: string, visibility?: string, moodboardId?: string | null }
 */
export async function POST(request: Request) {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getNotesSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const notebookId =
    typeof body === "object" &&
    body !== null &&
    typeof (body as { notebookId?: unknown }).notebookId === "string"
      ? (body as { notebookId: string }).notebookId.trim()
      : "";

  if (!notebookId) {
    return NextResponse.json({ error: "notebookId is required." }, { status: 400 });
  }

  const title =
    typeof body === "object" &&
    body !== null &&
    typeof (body as { title?: unknown }).title === "string"
      ? (body as { title: string }).title.trim() || "Untitled"
      : "Untitled";

  const content =
    typeof body === "object" &&
    body !== null &&
    typeof (body as { content?: unknown }).content === "string"
      ? (body as { content: string }).content
      : "";

  const visibilityRaw =
    typeof body === "object" && body !== null
      ? (body as { visibility?: unknown }).visibility
      : undefined;
  const visibilityParsed = parseVisibility(visibilityRaw, auth.isAdmin);
  if (!visibilityParsed.ok) {
    return NextResponse.json({ error: visibilityParsed.error }, { status: 403 });
  }

  let moodboardId: string | null = null;
  if (
    typeof body === "object" &&
    body !== null &&
    "moodboardId" in body
  ) {
    const raw = (body as { moodboardId?: unknown }).moodboardId;
    if (raw === null || raw === "") {
      moodboardId = null;
    } else if (typeof raw === "string" && raw.trim()) {
      moodboardId = raw.trim();
    } else {
      return NextResponse.json({ error: "moodboardId must be a string or null." }, { status: 400 });
    }
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("notes")
    .insert({
      notebook_id: notebookId,
      title,
      content,
      visibility: visibilityParsed.value,
      moodboard_id: moodboardId,
      created_at: now,
      updated_at: now,
    })
    .select(NOTE_SELECT_COLUMNS)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Insert failed." }, { status: 500 });
  }

  await supabase.from("notebooks").update({ updated_at: now }).eq("id", notebookId);

  return NextResponse.json({ note: mapNote(data as NoteRow) });
}
