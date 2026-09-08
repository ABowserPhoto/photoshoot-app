import { NextResponse } from "next/server";

import {
  DEFAULT_KNOWLEDGE_CATEGORY,
  KNOWLEDGE_CATEGORIES,
  parseKnowledgeCategory,
} from "@/lib/knowledgeCategories";
import { assertModuleAccess } from "@/lib/server/assertModuleAccess";
import {
  embedKnowledgeText,
  geminiFailureMessage,
  getGeminiClient,
  TaskType,
} from "@/lib/server/geminiKnowledge";
import {
  getKnowledgeSupabase,
  KNOWLEDGE_LIST_COLUMNS,
  mapKnowledgeDocumentRow,
  type KnowledgeDocumentRow,
} from "@/lib/server/knowledgeSupabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_TITLE_CHARS = 200;
const MAX_CONTENT_CHARS = 20_000;

type IngestBody = {
  title?: unknown;
  content?: unknown;
  category?: unknown;
};

/** POST /api/knowledge/ingest — embed SOP content with Gemini and store in pgvector. */
export async function POST(request: Request) {
  const access = await assertModuleAccess("knowledge");
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const genAI = getGeminiClient();
  if (!genAI) {
    return NextResponse.json(
      { error: "Gemini API key is missing. Set GEMINI_API_KEY in your environment." },
      { status: 503 }
    );
  }

  const sb = getKnowledgeSupabase();
  if (!sb) {
    return NextResponse.json(
      { error: "Database is not configured. Set SUPABASE_SERVICE_ROLE_KEY." },
      { status: 503 }
    );
  }

  let body: IngestBody;
  try {
    body = (await request.json()) as IngestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const content = typeof body.content === "string" ? body.content.trim() : "";
  const category =
    body.category === undefined || body.category === null || body.category === ""
      ? DEFAULT_KNOWLEDGE_CATEGORY
      : parseKnowledgeCategory(body.category);

  if (!category) {
    return NextResponse.json(
      {
        error: `category must be one of: ${KNOWLEDGE_CATEGORIES.join(", ")}.`,
      },
      { status: 400 }
    );
  }

  if (!title) {
    return NextResponse.json({ error: "title is required." }, { status: 400 });
  }
  if (title.length > MAX_TITLE_CHARS) {
    return NextResponse.json(
      { error: `title must be at most ${MAX_TITLE_CHARS} characters.` },
      { status: 400 }
    );
  }
  if (!content) {
    return NextResponse.json({ error: "content is required." }, { status: 400 });
  }
  if (content.length > MAX_CONTENT_CHARS) {
    return NextResponse.json(
      {
        error: `content is too long for a single embedding (${content.length} chars). Keep it under ${MAX_CONTENT_CHARS} characters.`,
      },
      { status: 400 }
    );
  }

  let embedding: number[];
  try {
    embedding = await embedKnowledgeText({
      genAI,
      text: content,
      taskType: TaskType.RETRIEVAL_DOCUMENT,
    });
  } catch (error) {
    console.error("Knowledge ingest Gemini error:", error);
    return NextResponse.json(
      { error: geminiFailureMessage(error, "Gemini embedding failed.") },
      { status: 502 }
    );
  }

  const { data, error } = await sb
    .from("knowledge_documents")
    .insert({
      title,
      content,
      category,
      embedding,
    })
    .select(KNOWLEDGE_LIST_COLUMNS)
    .single();

  if (error || !data) {
    console.error("Knowledge ingest Supabase error:", error);
    const message = error?.message ?? "Failed to save knowledge document.";
    const isVectorError = /vector|embedding|dimension/i.test(message);
    return NextResponse.json(
      {
        error: isVectorError
          ? `Supabase rejected the embedding: ${message}`
          : `Supabase insert failed: ${message}`,
      },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { ok: true, document: mapKnowledgeDocumentRow(data as KnowledgeDocumentRow) },
    { status: 201 }
  );
}
