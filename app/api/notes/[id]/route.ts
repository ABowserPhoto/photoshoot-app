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

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/notes/[id]
 */
export async function GET(_request: Request, context: RouteContext) {
  const auth = await getAuthRole();
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
  if (!canViewNoteVisibility(row.visibility, auth.isAdmin)) {
    return NextResponse.json({ error: "Note not found." }, { status: 404 });
  }

  return NextResponse.json({ note: mapNote(row) });
}

/**
 * PATCH /api/notes/[id]
 * Body: { title?, content?, notebookId?, visibility?, moodboardId? }
 */
export async function PATCH(request: Request, context: RouteContext) {
  const auth = await getAuthRole();
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
  if (!canViewNoteVisibility(existingRow.visibility, auth.isAdmin)) {
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

  if ("visibility" in body) {
    const raw = (body as { visibility?: unknown }).visibility;
    if (typeof raw !== "string" || !NOTE_VISIBILITIES.includes(raw as NoteVisibility)) {
      return NextResponse.json(
        { error: "visibility must be public, user, or admin_only." },
        { status: 400 }
      );
    }
    if (raw === "admin_only" && !auth.isAdmin) {
      return NextResponse.json(
        { error: "Only admins can set admin_only visibility." },
        { status: 403 }
      );
    }
    patch.visibility = raw;
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
  const auth = await getAuthRole();
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
    .select("id, visibility")
    .eq("id", id)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Note not found." }, { status: 404 });
  }
  if (
    !canViewNoteVisibility(
      (existing as { visibility?: string }).visibility ?? "user",
      auth.isAdmin
    )
  ) {
    return NextResponse.json({ error: "Note not found." }, { status: 404 });
  }

  const { error } = await supabase.from("notes").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
