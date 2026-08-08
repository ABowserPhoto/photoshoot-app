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
import { normalizeScriptStatus, SCRIPT_STATUSES } from "@/lib/scriptStatuses";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function parseNullableId(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

async function loadScript(id: string) {
  const sb = getScriptsSupabase();
  if (!sb) {
    return { error: "Database is not configured." as const, status: 503 as const };
  }

  const { data, error } = await sb
    .from("scripts")
    .select(SCRIPT_SELECT_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return { error: error.message, status: 500 as const };
  }
  if (!data) {
    return { error: "Script not found." as const, status: 404 as const };
  }

  const row = data as ScriptRow;
  const maps = await resolveLinkedAssetNames(sb, [row]);
  return { sb, script: mapScriptRow(row, namesForRow(row, maps)) };
}

/** GET /api/scripts/:id */
export async function GET(_request: Request, context: RouteContext) {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const scriptId = id?.trim();
  if (!scriptId) {
    return NextResponse.json({ error: "Missing script id." }, { status: 400 });
  }

  const result = await loadScript(scriptId);
  if ("error" in result && !("script" in result)) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, script: result.script });
}

type PatchBody = {
  title?: unknown;
  content?: unknown;
  status?: unknown;
  projectId?: unknown;
  shootId?: unknown;
  moodboardId?: unknown;
};

/** PATCH /api/scripts/:id */
export async function PATCH(request: Request, context: RouteContext) {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const scriptId = id?.trim();
  if (!scriptId) {
    return NextResponse.json({ error: "Missing script id." }, { status: 400 });
  }

  const sb = getScriptsSupabase();
  if (!sb) {
    return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const payload: Record<string, unknown> = {};

  if (body.title !== undefined) {
    if (typeof body.title !== "string" || !body.title.trim()) {
      return NextResponse.json({ error: "title must be a non-empty string." }, { status: 400 });
    }
    payload.title = body.title.trim();
  }

  if (body.content !== undefined) {
    if (typeof body.content !== "string") {
      return NextResponse.json({ error: "content must be a string." }, { status: 400 });
    }
    payload.content = body.content;
  }

  if (body.status !== undefined) {
    const status = normalizeScriptStatus(body.status);
    if (
      typeof body.status === "string" &&
      body.status.trim() &&
      !(SCRIPT_STATUSES as readonly string[]).includes(body.status.trim())
    ) {
      return NextResponse.json(
        { error: `status must be one of: ${SCRIPT_STATUSES.join(", ")}` },
        { status: 400 }
      );
    }
    payload.status = status;
  }

  if (body.projectId !== undefined) {
    const projectId = parseNullableId(body.projectId);
    if (projectId === undefined) {
      return NextResponse.json({ error: "projectId must be a string or null." }, { status: 400 });
    }
    payload.project_id = projectId;
  }

  if (body.shootId !== undefined) {
    const shootId = parseNullableId(body.shootId);
    if (shootId === undefined) {
      return NextResponse.json({ error: "shootId must be a string or null." }, { status: 400 });
    }
    payload.shoot_id = shootId;
  }

  if (body.moodboardId !== undefined) {
    const moodboardId = parseNullableId(body.moodboardId);
    if (moodboardId === undefined) {
      return NextResponse.json({ error: "moodboardId must be a string or null." }, { status: 400 });
    }
    payload.moodboard_id = moodboardId;
  }

  if (Object.keys(payload).length === 0) {
    return NextResponse.json({ error: "No updates provided." }, { status: 400 });
  }

  const { data, error } = await sb
    .from("scripts")
    .update(payload)
    .eq("id", scriptId)
    .select(SCRIPT_SELECT_COLUMNS)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (!data) {
    return NextResponse.json({ error: "Script not found." }, { status: 404 });
  }

  const row = data as ScriptRow;
  const maps = await resolveLinkedAssetNames(sb, [row]);
  return NextResponse.json({ ok: true, script: mapScriptRow(row, namesForRow(row, maps)) });
}

/** DELETE /api/scripts/:id */
export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const scriptId = id?.trim();
  if (!scriptId) {
    return NextResponse.json({ error: "Missing script id." }, { status: 400 });
  }

  const sb = getScriptsSupabase();
  if (!sb) {
    return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  }

  const { error } = await sb.from("scripts").delete().eq("id", scriptId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
