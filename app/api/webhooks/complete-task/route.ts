import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

/** Server-side route: no Next.js auth; callable by Zapier. Prefer SUPABASE_SERVICE_ROLE_KEY so RLS does not block updates. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function createServerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const key = serviceKey || anonKey;
  if (!url || !key) {
    return null;
  }
  return createClient(url, key);
}

export async function POST(request: Request) {
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
    return NextResponse.json({ error: "taskId is required in the JSON body." }, { status: 400 });
  }

  const supabase = createServerSupabase();
  if (!supabase) {
    return NextResponse.json(
      {
        error:
          "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (recommended for webhooks) or NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      },
      { status: 503 }
    );
  }

  const { data, error } = await supabase
    .from("tasks")
    .update({ status: "Completed" })
    .eq("id", taskId)
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  if (!data?.length) {
    return NextResponse.json({ error: "No task found with that taskId." }, { status: 404 });
  }

  console.log(`[webhooks/complete-task] Zapier completed task id=${taskId} → status Completed`);

  return NextResponse.json({ success: true, taskId }, { status: 200 });
}
