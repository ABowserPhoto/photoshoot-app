import { NextResponse } from "next/server";

import {
  canViewNotebook,
  canViewNoteVisibility,
  ensureStudioChatsNotebook,
  getNotesAuth,
  getNotesSupabase,
  mapNotebook,
  mapNoteSummary,
  NOTE_SELECT_COLUMNS,
  NOTEBOOK_ACCESS_LEVELS,
  NOTEBOOK_SELECT_COLUMNS,
  normalizeAccessLevel,
  normalizeUuidArray,
  resolveCreatorAdminFlags,
  type NoteRow,
  type NotebookAccessLevel,
  type NotebookRow,
  type NotebookWithNotes,
} from "@/lib/server/notesSupabase";

export const dynamic = "force-dynamic";

/**
 * GET /api/notes/notebooks
 * Returns notebooks the caller can access, with note summaries.
 * Ensures Studio Chats exists. admin_only notes omitted for non-admins.
 */
export async function GET() {
  const auth = await getNotesAuth();
  if (!auth.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getNotesSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  // Soft-ensure system notebook (ignore failures; list still works).
  await ensureStudioChatsNotebook(supabase);

  const { data: notebooks, error: notebooksError } = await supabase
    .from("notebooks")
    .select(NOTEBOOK_SELECT_COLUMNS)
    .order("updated_at", { ascending: false });

  if (notebooksError) {
    return NextResponse.json({ error: notebooksError.message }, { status: 500 });
  }

  const allRows = (notebooks ?? []) as NotebookRow[];
  const notebookRows = allRows.filter((row) =>
    canViewNotebook(row, auth.userId, auth.isAdmin)
  );

  // Pin Studio Chats at the top.
  notebookRows.sort((a, b) => {
    const aSys = a.is_system === true ? 0 : 1;
    const bSys = b.is_system === true ? 0 : 1;
    if (aSys !== bSys) return aSys - bSys;
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });

  if (notebookRows.length === 0) {
    return NextResponse.json({ notebooks: [] as NotebookWithNotes[] });
  }

  const creatorFlags = await resolveCreatorAdminFlags(
    supabase,
    notebookRows.map((r) => r.creator_id)
  );

  const ids = notebookRows.map((n) => n.id);
  let notesQuery = supabase
    .from("notes")
    .select(NOTE_SELECT_COLUMNS)
    .in("notebook_id", ids)
    .order("updated_at", { ascending: false });

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

  const payload: NotebookWithNotes[] = notebookRows.map((row) => {
    const creatorId = typeof row.creator_id === "string" ? row.creator_id : null;
    return {
      ...mapNotebook(row, {
        userId: auth.userId,
        isAdmin: auth.isAdmin,
        creatorIsAdmin: creatorId ? creatorFlags.get(creatorId) === true : false,
      }),
      notes: (byNotebook.get(row.id) ?? []).map(mapNoteSummary),
    };
  });

  return NextResponse.json({ notebooks: payload });
}

type PostBody = {
  name?: unknown;
  accessLevel?: unknown;
  assignedUserIds?: unknown;
};

/**
 * POST /api/notes/notebooks
 * Body: { name, accessLevel?, assignedUserIds? }
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

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "name is required." }, { status: 400 });
  }
  if (name.toLowerCase() === "studio chats") {
    return NextResponse.json(
      { error: "Studio Chats is a reserved system notebook." },
      { status: 400 }
    );
  }

  let accessLevel: NotebookAccessLevel = normalizeAccessLevel(body.accessLevel);
  if (
    typeof body.accessLevel === "string" &&
    !NOTEBOOK_ACCESS_LEVELS.includes(body.accessLevel as NotebookAccessLevel)
  ) {
    return NextResponse.json({ error: "Invalid accessLevel." }, { status: 400 });
  }
  if (accessLevel === "admin_only" && !auth.isAdmin) {
    accessLevel = "all";
  }

  let assignedUserIds =
    accessLevel === "specific" ? normalizeUuidArray(body.assignedUserIds) : [];
  if (accessLevel === "specific" && assignedUserIds.length === 0) {
    return NextResponse.json(
      { error: "Select at least one user for Specific Users access." },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("notebooks")
    .insert({
      name,
      creator_id: auth.userId,
      access_level: accessLevel,
      assigned_user_ids: assignedUserIds,
      is_system: false,
      created_at: now,
      updated_at: now,
    })
    .select(NOTEBOOK_SELECT_COLUMNS)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Insert failed." }, { status: 500 });
  }

  const row = data as NotebookRow;
  return NextResponse.json({
    notebook: {
      ...mapNotebook(row, {
        userId: auth.userId,
        isAdmin: auth.isAdmin,
        creatorIsAdmin: auth.isAdmin,
      }),
      notes: [],
    },
  });
}
