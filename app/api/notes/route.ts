import { NextResponse } from "next/server";

import {
  canViewNotebook,
  canViewNote,
  getNotesAuth,
  getNotesSupabase,
  mapNote,
  NOTE_SELECT_COLUMNS,
  parseNoteAccessBody,
  type NoteRow,
  visibilityFromAccessLevel,
} from "@/lib/server/notesSupabase";

export const dynamic = "force-dynamic";

/**
 * GET /api/notes?moodboardId=...
 * Returns the note linked to a moodboard (if visible to the current user).
 */
export async function GET(request: Request) {
  const auth = await getNotesAuth();
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

  const { data, error } = await supabase
    .from("notes")
    .select(NOTE_SELECT_COLUMNS)
    .eq("moodboard_id", moodboardId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ note: null });
  }

  const row = data as NoteRow;
  if (!canViewNote(row, auth.userId, auth.isAdmin)) {
    return NextResponse.json({ note: null });
  }

  return NextResponse.json({ note: mapNote(row) });
}

/**
 * POST /api/notes
 * Body: { notebookId, title?, content?, accessLevel?, assignedUserIds?, moodboardId? }
 */
export async function POST(request: Request) {
  const auth = await getNotesAuth();
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

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const notebookId =
    typeof (body as { notebookId?: unknown }).notebookId === "string"
      ? (body as { notebookId: string }).notebookId.trim()
      : "";

  if (!notebookId) {
    return NextResponse.json({ error: "notebookId is required." }, { status: 400 });
  }

  const { data: notebookRow, error: notebookError } = await supabase
    .from("notebooks")
    .select("id, creator_id, access_level, assigned_user_ids, is_system")
    .eq("id", notebookId)
    .maybeSingle();

  if (notebookError) {
    return NextResponse.json({ error: notebookError.message }, { status: 500 });
  }
  if (!notebookRow) {
    return NextResponse.json({ error: "Notebook not found." }, { status: 404 });
  }

  if (!canViewNotebook(notebookRow, auth.userId, auth.isAdmin)) {
    return NextResponse.json({ error: "Notebook not found." }, { status: 404 });
  }

  const title =
    typeof (body as { title?: unknown }).title === "string"
      ? (body as { title: string }).title.trim() || "Untitled"
      : "Untitled";

  const content =
    typeof (body as { content?: unknown }).content === "string"
      ? (body as { content: string }).content
      : "";

  const accessParsed = parseNoteAccessBody(body as Record<string, unknown>, auth.isAdmin);
  if (!accessParsed.ok) {
    return NextResponse.json({ error: accessParsed.error }, { status: accessParsed.status });
  }

  let moodboardId: string | null = null;
  if ("moodboardId" in body) {
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
      creator_id: auth.userId,
      access_level: accessParsed.accessLevel,
      assigned_user_ids: accessParsed.assignedUserIds,
      visibility: visibilityFromAccessLevel(accessParsed.accessLevel),
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
