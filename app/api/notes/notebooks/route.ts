import { NextResponse } from "next/server";

import { getAuthRole } from "@/lib/server/getAuthRole";
import {
  canViewNoteVisibility,
  getNotesSupabase,
  mapNotebook,
  mapNoteSummary,
  NOTE_SELECT_COLUMNS,
  type NoteRow,
  type NotebookRow,
  type NotebookWithNotes,
} from "@/lib/server/notesSupabase";

export const dynamic = "force-dynamic";

/**
 * GET /api/notes/notebooks
 * Returns notebooks with note summaries for the sidebar.
 * admin_only notes are omitted for non-admin users.
 */
export async function GET() {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getNotesSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  const { data: notebooks, error: notebooksError } = await supabase
    .from("notebooks")
    .select("id, name, created_at, updated_at")
    .order("updated_at", { ascending: false });

  if (notebooksError) {
    return NextResponse.json({ error: notebooksError.message }, { status: 500 });
  }

  const notebookRows = (notebooks ?? []) as NotebookRow[];
  if (notebookRows.length === 0) {
    return NextResponse.json({ notebooks: [] as NotebookWithNotes[] });
  }

  const ids = notebookRows.map((n) => n.id);
  let notesQuery = supabase
    .from("notes")
    .select(NOTE_SELECT_COLUMNS)
    .in("notebook_id", ids)
    .order("updated_at", { ascending: false });

  // Server-side filter: non-admins never receive admin_only rows.
  if (!auth.isAdmin) {
    notesQuery = notesQuery.neq("visibility", "admin_only");
  }

  const { data: notes, error: notesError } = await notesQuery;

  if (notesError) {
    return NextResponse.json({ error: notesError.message }, { status: 500 });
  }

  const noteRows = ((notes ?? []) as NoteRow[]).filter((row) =>
    canViewNoteVisibility(row.visibility, auth.isAdmin)
  );
  const byNotebook = new Map<string, NoteRow[]>();
  for (const note of noteRows) {
    const list = byNotebook.get(note.notebook_id) ?? [];
    list.push(note);
    byNotebook.set(note.notebook_id, list);
  }

  const payload: NotebookWithNotes[] = notebookRows.map((row) => ({
    ...mapNotebook(row),
    notes: (byNotebook.get(row.id) ?? []).map(mapNoteSummary),
  }));

  return NextResponse.json({ notebooks: payload });
}

/**
 * POST /api/notes/notebooks
 * Body: { name: string }
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

  const name =
    typeof body === "object" &&
    body !== null &&
    typeof (body as { name?: unknown }).name === "string"
      ? (body as { name: string }).name.trim()
      : "";

  if (!name) {
    return NextResponse.json({ error: "name is required." }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("notebooks")
    .insert({ name, created_at: now, updated_at: now })
    .select("id, name, created_at, updated_at")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Insert failed." }, { status: 500 });
  }

  return NextResponse.json({
    notebook: { ...mapNotebook(data as NotebookRow), notes: [] },
  });
}
