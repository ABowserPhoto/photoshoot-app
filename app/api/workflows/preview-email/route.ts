import { NextResponse } from "next/server";

import { createPreviewEmailDraft } from "@/lib/server/previewEmailDraft";
import { getAuthRole } from "@/lib/server/getAuthRole";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/workflows/preview-email
 * Body: { taskId: string }
 *
 * Creates the Preview Sent Gmail draft (same path as finalize-shoot: fetch API, not a server action).
 */
export async function POST(request: Request) {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const taskId =
    body && typeof body === "object" && typeof (body as { taskId?: unknown }).taskId === "string"
      ? (body as { taskId: string }).taskId.trim()
      : "";

  if (!taskId) {
    return NextResponse.json({ error: "taskId is required." }, { status: 400 });
  }

  const result = await createPreviewEmailDraft(taskId);
  if (!result.ok) {
    return NextResponse.json(
      { success: false, error: result.error ?? "Failed to create preview email draft." },
      { status: 422 }
    );
  }

  return NextResponse.json({
    success: true,
    gmailDraftId: result.gmailDraftId,
  });
}
