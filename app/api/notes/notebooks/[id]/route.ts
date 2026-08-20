import { NextResponse } from "next/server";

import {
  canDeleteNotebook,
  canEditNotebook,
  getNotesAuth,
  getNotesSupabase,
  mapNotebook,
  NOTEBOOK_ACCESS_LEVELS,
  NOTEBOOK_SELECT_COLUMNS,
  normalizeAccessLevel,
  normalizeUuidArray,
  resolveCreatorAdminFlags,
  type NotebookAccessLevel,
  type NotebookRow,
} from "@/lib/server/notesSupabase";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

type PatchBody = {
  name?: unknown;
  accessLevel?: unknown;
  assignedUserIds?: unknown;
};

/**
 * PATCH /api/notes/notebooks/[id]
 * Body: { name?, accessLevel?, assignedUserIds? }
 * System notebooks cannot be renamed or have access changed.
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
    .from("notebooks")
    .select(NOTEBOOK_SELECT_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Notebook not found." }, { status: 404 });
  }

  const row = existing as NotebookRow;
  if (row.is_system === true) {
    return NextResponse.json(
      { error: "Studio Chats cannot be renamed or modified." },
      { status: 403 }
    );
  }
  if (!canEditNotebook(row, { userId: auth.userId, isAdmin: auth.isAdmin })) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) {
      return NextResponse.json({ error: "name cannot be empty." }, { status: 400 });
    }
    if (name.toLowerCase() === "studio chats") {
      return NextResponse.json(
        { error: "Studio Chats is a reserved system notebook name." },
        { status: 400 }
      );
    }
    updates.name = name;
  }

  if (body.accessLevel !== undefined) {
    if (
      typeof body.accessLevel !== "string" ||
      !NOTEBOOK_ACCESS_LEVELS.includes(body.accessLevel as NotebookAccessLevel)
    ) {
      return NextResponse.json({ error: "Invalid accessLevel." }, { status: 400 });
    }
    let accessLevel = normalizeAccessLevel(body.accessLevel);
    if (accessLevel === "admin_only" && !auth.isAdmin) {
      return NextResponse.json(
        { error: "Only admins can set Admin Only access." },
        { status: 403 }
      );
    }
    updates.access_level = accessLevel;
    if (accessLevel !== "specific") {
      updates.assigned_user_ids = [];
    }
  }

  if (body.assignedUserIds !== undefined || updates.access_level === "specific") {
    const nextLevel =
      typeof updates.access_level === "string"
        ? normalizeAccessLevel(updates.access_level)
        : normalizeAccessLevel(row.access_level);
    if (nextLevel === "specific") {
      const assigned = normalizeUuidArray(body.assignedUserIds ?? row.assigned_user_ids);
      if (assigned.length === 0) {
        return NextResponse.json(
          { error: "Select at least one user for Specific Users access." },
          { status: 400 }
        );
      }
      updates.assigned_user_ids = assigned;
    }
  }

  const { data, error } = await supabase
    .from("notebooks")
    .update(updates)
    .eq("id", id)
    .select(NOTEBOOK_SELECT_COLUMNS)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Notebook not found." }, { status: 404 });
  }

  const updated = data as NotebookRow;
  const creatorId = typeof updated.creator_id === "string" ? updated.creator_id : null;
  const flags = await resolveCreatorAdminFlags(supabase, [creatorId]);

  return NextResponse.json({
    notebook: mapNotebook(updated, {
      userId: auth.userId,
      isAdmin: auth.isAdmin,
      creatorIsAdmin: creatorId ? flags.get(creatorId) === true : false,
    }),
  });
}

/**
 * DELETE /api/notes/notebooks/[id]
 * Blocks system notebooks and non-admin deletion of admin-created notebooks.
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
    .from("notebooks")
    .select(NOTEBOOK_SELECT_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Notebook not found." }, { status: 404 });
  }

  const row = existing as NotebookRow;
  if (row.is_system === true) {
    return NextResponse.json(
      { error: "Studio Chats cannot be deleted." },
      { status: 403 }
    );
  }

  const creatorId = typeof row.creator_id === "string" ? row.creator_id : null;
  const flags = await resolveCreatorAdminFlags(supabase, [creatorId]);
  const creatorIsAdmin = creatorId ? flags.get(creatorId) === true : false;

  if (!canDeleteNotebook(row, { userId: auth.userId, isAdmin: auth.isAdmin, creatorIsAdmin })) {
    return NextResponse.json(
      {
        error: creatorIsAdmin
          ? "Only admins can delete notebooks created by an admin."
          : "You do not have permission to delete this notebook.",
      },
      { status: 403 }
    );
  }

  const { error } = await supabase.from("notebooks").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
