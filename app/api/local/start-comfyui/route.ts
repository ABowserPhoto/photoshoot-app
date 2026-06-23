import { NextRequest, NextResponse } from "next/server";

import { launchComfyUI } from "@/lib/server/comfyUiLauncher";

export const dynamic = "force-dynamic";

/**
 * POST /api/local/start-comfyui
 * Body: { comfyPath: string }
 *
 * Opens ComfyUI in a new terminal window on the local machine.
 * Only works when the Next.js server runs on the same host as the user (Electron / local Node).
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 });
  }

  const { comfyPath } = body as Record<string, unknown>;

  if (typeof comfyPath !== "string" || !comfyPath.trim()) {
    return NextResponse.json(
      { error: "comfyPath is required and must be a non-empty string." },
      { status: 400 }
    );
  }

  const result = await launchComfyUI(comfyPath.trim());

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 422 });
  }

  return NextResponse.json({ ok: true });
}
