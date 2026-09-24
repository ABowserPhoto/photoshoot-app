import { NextResponse } from "next/server";

import { assertModuleAccess } from "@/lib/server/assertModuleAccess";
import { getKnowledgeSupabase } from "@/lib/server/knowledgeSupabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** DELETE /api/knowledge/:id — remove all chunks for a document_group_id. */
export async function DELETE(_request: Request, context: RouteContext) {
  const access = await assertModuleAccess("knowledge");
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { id } = await context.params;
  const documentGroupId = id?.trim() ?? "";
  if (!documentGroupId || !UUID_RE.test(documentGroupId)) {
    return NextResponse.json({ error: "Invalid document group id." }, { status: 400 });
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
    .eq("document_group_id", documentGroupId)
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Legacy rows created before document_group_id may only match on primary key.
  if (!data?.length) {
    const { data: legacyData, error: legacyError } = await sb
      .from("knowledge_documents")
      .delete()
      .eq("id", documentGroupId)
      .is("document_group_id", null)
      .select("id");

    if (legacyError) {
      return NextResponse.json({ error: legacyError.message }, { status: 500 });
    }
    if (!legacyData?.length) {
      return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, deletedCount: legacyData.length });
  }

  return NextResponse.json({ ok: true, deletedCount: data.length });
}
