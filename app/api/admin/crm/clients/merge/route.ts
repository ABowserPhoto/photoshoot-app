import { NextResponse } from "next/server";

import { assertModuleAccess } from "@/lib/server/assertModuleAccess";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type MergeClientsBody = {
  sourceId?: unknown;
  targetId?: unknown;
};

export async function POST(request: Request) {
  const access = await assertModuleAccess("crm");
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  let body: MergeClientsBody;
  try {
    body = (await request.json()) as MergeClientsBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const sourceId = typeof body.sourceId === "string" ? body.sourceId.trim() : "";
  const targetId = typeof body.targetId === "string" ? body.targetId.trim() : "";

  if (!sourceId || !targetId) {
    return NextResponse.json({ error: "sourceId and targetId are required." }, { status: 400 });
  }
  if (sourceId === targetId) {
    return NextResponse.json({ error: "sourceId and targetId must be different." }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase admin client is not configured. Set SUPABASE_SERVICE_ROLE_KEY." },
      { status: 503 }
    );
  }

  const [sourceRes, targetRes] = await Promise.all([
    supabase.from("clients").select("id, company_name").eq("id", sourceId).maybeSingle(),
    supabase.from("clients").select("id, company_name").eq("id", targetId).maybeSingle(),
  ]);

  if (sourceRes.error) {
    return NextResponse.json({ error: sourceRes.error.message }, { status: 400 });
  }
  if (targetRes.error) {
    return NextResponse.json({ error: targetRes.error.message }, { status: 400 });
  }
  if (!sourceRes.data) {
    return NextResponse.json({ error: "Source client not found." }, { status: 404 });
  }
  if (!targetRes.data) {
    return NextResponse.json({ error: "Target client not found." }, { status: 404 });
  }

  const resolvedTargetCompanyName = targetRes.data.company_name?.trim() ?? "";
  if (!resolvedTargetCompanyName) {
    return NextResponse.json({ error: "Target client must have a company name." }, { status: 400 });
  }

  const { error: tasksError } = await supabase
    .from("tasks")
    .update({
      client_id: targetId,
      company_name: resolvedTargetCompanyName,
      updated_at: new Date().toISOString(),
    })
    .eq("client_id", sourceId);

  if (tasksError) {
    return NextResponse.json({ error: tasksError.message }, { status: 400 });
  }

  const sourceCompanyName = sourceRes.data.company_name?.trim() ?? "";
  if (sourceCompanyName) {
    const { error: legacyTasksError } = await supabase
      .from("tasks")
      .update({
        client_id: targetId,
        company_name: resolvedTargetCompanyName,
        updated_at: new Date().toISOString(),
      })
      .eq("company_name", sourceCompanyName)
      .is("client_id", null);

    if (legacyTasksError) {
      return NextResponse.json({ error: legacyTasksError.message }, { status: 400 });
    }
  }

  const { error: deleteError } = await supabase.from("clients").delete().eq("id", sourceId);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
