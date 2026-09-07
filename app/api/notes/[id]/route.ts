import { NextResponse } from "next/server";

import {
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

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/notes/[id]
 */
export async function GET(_request: Request, context: RouteContext) {
  const auth = await getNotesAuth();
  if (!auth.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  const supabase = getNotesSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  const { data, error } = await supabase
    .from("notes")
    .select(NOTE_SELECT_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Note not found." }, { status: 404 });
  }

  const row = data as NoteRow;
  if (!canViewNote(row, auth.userId, auth.isAdmin)) {
    return NextResponse.json({ error: "Note not found." }, { status: 404 });
  }

  return NextResponse.json({ note: mapNote(row) });
}

/**
 * PATCH /api/notes/[id]
 * Body: { title?, content?, notebookId?, accessLevel?, assignedUserIds?, moodboardId? }
 */
export async function PATCH(request: Request, context: RouteContext) {
  const auth = await getNotesAuth();
  if (!auth.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  const supabase = getNotesSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  const { data: existing, error: existingError } = await supabase
    .from("notes")
    .select(NOTE_SELECT_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Note not found." }, { status: 404 });
  }

  const existingRow = existing as NoteRow;
  if (!canViewNote(existingRow, auth.userId, auth.isAdmin)) {
    return NextResponse.json({ error: "Note not found." }, { status: 404 });
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

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (typeof (body as { title?: unknown }).title === "string") {
    patch.title = (body as { title: string }).title.trim() || "Untitled";
  }
  if (typeof (body as { content?: unknown }).content === "string") {
    patch.content = (body as { content: string }).content;
  }
  if (typeof (body as { notebookId?: unknown }).notebookId === "string") {
    const notebookId = (body as { notebookId: string }).notebookId.trim();
    if (notebookId) patch.notebook_id = notebookId;
  }

  if ("accessLevel" in body || "assignedUserIds" in body || "visibility" in body) {
    const merged = {
      accessLevel:
        "accessLevel" in body
          ? (body as { accessLevel?: unknown }).accessLevel
          : existingRow.access_level,
      assignedUserIds:
        "assignedUserIds" in body
          ? (body as { assignedUserIds?: unknown }).assignedUserIds
          : existingRow.assigned_user_ids,
      visibility:
        "visibility" in body
          ? (body as { visibility?: unknown }).visibility
          : existingRow.visibility,
    };
    const accessParsed = parseNoteAccessBody(merged, auth.isAdmin);
    if (!accessParsed.ok) {
      return NextResponse.json({ error: accessParsed.error }, { status: accessParsed.status });
    }
    patch.access_level = accessParsed.accessLevel;
    patch.assigned_user_ids = accessParsed.assignedUserIds;
    patch.visibility = visibilityFromAccessLevel(accessParsed.accessLevel);
  }

  if ("moodboardId" in body) {
    const raw = (body as { moodboardId?: unknown }).moodboardId;
    if (raw === null || raw === "") {
      patch.moodboard_id = null;
    } else if (typeof raw === "string" && raw.trim()) {
      patch.moodboard_id = raw.trim();
    } else {
      return NextResponse.json({ error: "moodboardId must be a string or null." }, { status: 400 });
    }
  }

  const { data, error } = await supabase
    .from("notes")
    .update(patch)
    .eq("id", id)
    .select(NOTE_SELECT_COLUMNS)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Note not found." }, { status: 404 });
  }

  const note = data as NoteRow;
  await supabase
    .from("notebooks")
    .update({ updated_at: note.updated_at })
    .eq("id", note.notebook_id);

  return NextResponse.json({ note: mapNote(note) });
}

/**
 * DELETE /api/notes/[id]
 */
export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await getNotesAuth();
  if (!auth.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  const supabase = getNotesSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  const { data: existing, error: existingError } = await supabase
    .from("notes")
    .select(NOTE_SELECT_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Note not found." }, { status: 404 });
  }
  if (!canViewNote(existing as NoteRow, auth.userId, auth.isAdmin)) {
    return NextResponse.json({ error: "Note not found." }, { status: 404 });
  }

  const { error } = await supabase.from("notes").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
