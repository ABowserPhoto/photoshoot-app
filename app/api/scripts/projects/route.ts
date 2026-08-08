import { NextResponse } from "next/server";

import { getAuthRole } from "@/lib/server/getAuthRole";
import { getScriptsSupabase, listLinkedAssetOptions } from "@/lib/server/scriptsSupabase";

export const dynamic = "force-dynamic";

/**
 * GET /api/scripts/projects
 * Linked Assets dropdown data for the Script Editor:
 * - shoots → Workflow / Kanban photoshoots
 * - plannerTasks → Planner studio_tasks
 * - moodboards → Moodboards
 */
export async function GET() {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = getScriptsSupabase();
  if (!sb) {
    return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  }

  try {
    const { shoots, plannerTasks, moodboards } = await listLinkedAssetOptions(sb);
    return NextResponse.json({
      ok: true,
      shoots,
      plannerTasks,
      moodboards,
      // Legacy alias used by older clients (maps to workflow shoots).
      projects: shoots,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load linked assets.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
