import { NextRequest, NextResponse } from "next/server";

import { openInSoftware, type SupportedSoftware } from "@/lib/server/openInSoftware";

export const dynamic = "force-dynamic";

const VALID_SOFTWARE: SupportedSoftware[] = ["photoshop", "lightroom", "captureone"];

/**
 * POST /api/local/open-software
 * Body: { targetPath: string, software: 'photoshop' | 'lightroom' | 'captureone' }
 *
 * Opens a local file or directory in the specified creative software.
 * Only meaningful when the Next.js server is running on the same machine
 * as the client (i.e. Electron / local Node.js development).
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

  const { targetPath, software } = body as Record<string, unknown>;

  if (typeof targetPath !== "string" || !targetPath.trim()) {
    return NextResponse.json(
      { error: "targetPath is required and must be a non-empty string." },
      { status: 400 }
    );
  }

  if (!VALID_SOFTWARE.includes(software as SupportedSoftware)) {
    return NextResponse.json(
      { error: `software must be one of: ${VALID_SOFTWARE.join(", ")}.` },
      { status: 400 }
    );
  }

  const result = await openInSoftware(targetPath.trim(), software as SupportedSoftware);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 422 });
  }

  return NextResponse.json({ ok: true });
}
