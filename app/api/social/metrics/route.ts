import { NextRequest, NextResponse } from "next/server";

import { assertSocialStaff } from "@/lib/server/assertSocialStaff";
import { loadClientSocialMetrics } from "@/lib/server/socialMetricsService";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const auth = await assertSocialStaff();
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const record = body as {
    clientId?: unknown;
    rangeStart?: unknown;
    rangeEnd?: unknown;
    refresh?: unknown;
  };
  const clientId = typeof record.clientId === "string" ? record.clientId.trim() : "";
  const rangeStart = typeof record.rangeStart === "string" ? record.rangeStart.trim() : "";
  const rangeEnd = typeof record.rangeEnd === "string" ? record.rangeEnd.trim() : "";
  if (!UUID_RE.test(clientId)) {
    return NextResponse.json({ error: "Missing client." }, { status: 400 });
  }

  const result = await loadClientSocialMetrics({
    clientId,
    rangeStart,
    rangeEnd,
    refresh: record.refresh === true,
  });
  if (!result.ok) {
    const status = result.error === "Client not found." ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json(result.data);
}
