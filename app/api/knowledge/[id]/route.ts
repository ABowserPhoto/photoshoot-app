import { NextResponse } from "next/server";

import { assertModuleAccess } from "@/lib/server/assertModuleAccess";
import { getKnowledgeSupabase } from "@/lib/server/knowledgeSupabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** DELETE /api/knowledge/:id — remove an SOP from knowledge_documents. */
export async function DELETE(_request: Request, context: RouteContext) {
  const access = await assertModuleAccess("knowledge");
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { id } = await context.params;
  const documentId = id?.trim() ?? "";
  if (!documentId || !UUID_RE.test(documentId)) {
    return NextResponse.json({ error: "Invalid document id." }, { status: 400 });
  }

  const sb = getKnowledgeSupabase();
  if (!sb) {
    return NextResponse.json(
      { error: "Database is not configured. Set SUPABASE_SERVICE_ROLE_KEY." },
      { status: 503 }
    );
  }

  const { data, error } = await sb
    .from("knowledge_documents")
    .delete()
    .eq("id", documentId)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
