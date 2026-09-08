import { NextResponse } from "next/server";

import { assertModuleAccess } from "@/lib/server/assertModuleAccess";
import {
  getKnowledgeSupabase,
  KNOWLEDGE_LIST_COLUMNS,
  mapKnowledgeDocumentRow,
  type KnowledgeDocumentRow,
} from "@/lib/server/knowledgeSupabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/knowledge — list saved SOP documents (title, category, created_at). */
export async function GET() {
  const access = await assertModuleAccess("knowledge");
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
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
    .select(KNOWLEDGE_LIST_COLUMNS)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const documents = ((data ?? []) as KnowledgeDocumentRow[]).map(mapKnowledgeDocumentRow);
  return NextResponse.json({ ok: true, documents });
}
