import { NextResponse } from "next/server";

import { getAuthRole } from "@/lib/server/getAuthRole";
import {
  getScriptsSupabase,
  mapScriptRow,
  namesForRow,
  resolveLinkedAssetNames,
  SCRIPT_SELECT_COLUMNS,
  type ScriptRow,
} from "@/lib/server/scriptsSupabase";
import { normalizeScriptStatus } from "@/lib/scriptStatuses";

export const dynamic = "force-dynamic";

const DEFAULT_FOUNTAIN = `Title: Untitled Script
Credit: Written by
Author: 
Draft date: 

==

FADE IN:

INT. LOCATION - DAY

Action description goes here.

CHARACTER
Dialogue goes here.

FADE OUT.
`;

/** GET /api/scripts — list all scripts with linked asset names. */
export async function GET() {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = getScriptsSupabase();
  if (!sb) {
    return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  }

  const { data, error } = await sb
    .from("scripts")
    .select(SCRIPT_SELECT_COLUMNS)
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as ScriptRow[];
  const maps = await resolveLinkedAssetNames(sb, rows);

  const scripts = rows.map((row) => {
    const mapped = mapScriptRow(row, namesForRow(row, maps));
    const { content: _content, ...listItem } = mapped;
    return listItem;
  });

  return NextResponse.json({ ok: true, scripts });
}

type CreateBody = {
  title?: unknown;
  content?: unknown;
  status?: unknown;
  projectId?: unknown;
  shootId?: unknown;
  moodboardId?: unknown;
};

/** POST /api/scripts — create a new script. */
export async function POST(request: Request) {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = getScriptsSupabase();
  if (!sb) {
    return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  }

  let body: CreateBody = {};
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    body = {};
  }

  const title =
    typeof body.title === "string" && body.title.trim()
      ? body.title.trim()
      : "Untitled Script";
  const content =
    typeof body.content === "string" ? body.content : DEFAULT_FOUNTAIN;
  const status = normalizeScriptStatus(body.status);
  const projectId =
    typeof body.projectId === "string" && body.projectId.trim()
      ? body.projectId.trim()
      : null;
  const shootId =
    typeof body.shootId === "string" && body.shootId.trim()
      ? body.shootId.trim()
      : null;
  const moodboardId =
    typeof body.moodboardId === "string" && body.moodboardId.trim()
      ? body.moodboardId.trim()
      : null;

  const { data, error } = await sb
    .from("scripts")
    .insert({
      title,
      content,
      status,
      project_id: projectId,
      shoot_id: shootId,
      moodboard_id: moodboardId,
    })
    .select(SCRIPT_SELECT_COLUMNS)
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to create script." },
      { status: 400 }
    );
  }

  const row = data as ScriptRow;
  const maps = await resolveLinkedAssetNames(sb, [row]);
  return NextResponse.json(
    { ok: true, script: mapScriptRow(row, namesForRow(row, maps)) },
    { status: 201 }
  );
}
