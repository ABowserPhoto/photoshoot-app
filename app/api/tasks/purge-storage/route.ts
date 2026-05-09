import { NextResponse } from "next/server";

import { getAuthRole } from "@/lib/server/getAuthRole";
import { purgeTaskStorage } from "@/lib/server/purgeTaskStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await getAuthRole();
  if (!auth.authenticated || !auth.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const record = body as { taskId?: unknown };
  const taskId =
    typeof record.taskId === "string"
      ? record.taskId.trim()
      : record.taskId != null
        ? String(record.taskId).trim()
        : "";

  if (!taskId) {
    return NextResponse.json({ error: "taskId is required." }, { status: 400 });
  }

  const result = await purgeTaskStorage(taskId);
  return NextResponse.json({ success: result.ok, ...result }, { status: 200 });
}

