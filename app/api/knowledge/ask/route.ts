import { NextResponse } from "next/server";

import { DEFAULT_KNOWLEDGE_CATEGORY, parseKnowledgeCategory } from "@/lib/knowledgeCategories";
import { assertModuleAccess } from "@/lib/server/assertModuleAccess";
import {
  embedKnowledgeText,
  GEMINI_TEXT_MODEL,
  geminiFailureMessage,
  getGeminiClient,
  TaskType,
} from "@/lib/server/geminiKnowledge";
import {
  getKnowledgeSupabase,
  KNOWLEDGE_MATCH_COUNT,
  KNOWLEDGE_MATCH_THRESHOLD,
} from "@/lib/server/knowledgeSupabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_PROMPT_CHARS = 4_000;
const MAX_CONTEXT_CHARS = 12_000;

type AskBody = {
  prompt?: unknown;
  category?: unknown;
};

type MatchDocumentRow = {
  id?: unknown;
  title?: unknown;
  content?: unknown;
  category?: unknown;
  similarity?: unknown;
};

type RetrievedSource = {
  id: string;
  title: string;
  category: string;
  content: string;
  similarity: number;
};

function toSimilarity(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function mapMatchRow(row: MatchDocumentRow): RetrievedSource | null {
  if (typeof row.id !== "string" || !row.id) return null;
  const title = typeof row.title === "string" && row.title.trim() ? row.title.trim() : "Untitled SOP";
  const content = typeof row.content === "string" ? row.content.trim() : "";
  const category =
    typeof row.category === "string" && row.category.trim()
      ? row.category.trim()
      : DEFAULT_KNOWLEDGE_CATEGORY;
  return {
    id: row.id,
    title,
    category,
    content,
    similarity: toSimilarity(row.similarity),
  };
}

async function matchDocuments(params: {
  embedding: number[];
  category: string | null;
}): Promise<{ sources: RetrievedSource[]; error?: string }> {
  const sb = getKnowledgeSupabase();
  if (!sb) {
    return { sources: [], error: "Database is not configured. Set SUPABASE_SERVICE_ROLE_KEY." };
  }

  // Always pass filter_category so PostgREST picks the 4-arg match_documents overload.
  const { data, error } = await sb.rpc("match_documents", {
    query_embedding: params.embedding,
    match_threshold: KNOWLEDGE_MATCH_THRESHOLD,
    match_count: KNOWLEDGE_MATCH_COUNT,
    filter_category: params.category,
  });

  if (error) {
    return { sources: [], error: error.message };
  }

  const sources = ((data ?? []) as MatchDocumentRow[])
    .map(mapMatchRow)
    .filter((row): row is RetrievedSource => Boolean(row));
  return { sources };
}

function buildContextBlock(sources: RetrievedSource[]): string {
  if (sources.length === 0) {
    return "(No matching SOP documents were retrieved.)";
  }
  let used = 0;
  const parts: string[] = [];
  for (const [index, source] of sources.entries()) {
    const remaining = MAX_CONTEXT_CHARS - used;
    if (remaining <= 80) break;
    const body = source.content.slice(0, remaining);
    const block = `Source ${index + 1}: ${source.title} [${source.category}]\n${body}`;
    parts.push(block);
    used += block.length + 8;
  }
  return parts.join("\n\n---\n\n");
}

function buildRagPrompt(prompt: string, context: string): string {
  return `You are a helpful internal agency assistant for a photography studio.
Answer using ONLY the SOP/guideline context below. If the context is missing, empty, or does not contain the answer, say you do not have that information in the knowledge base. Do not invent procedures, prices, or policies.

Context:
${context}

Question:
${prompt}`;
}

/** POST /api/knowledge/ask — embed query, retrieve SOPs via pgvector, generate an answer. */
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

  if (!getKnowledgeSupabase()) {
    return NextResponse.json(
      { error: "Database is not configured. Set SUPABASE_SERVICE_ROLE_KEY." },
      { status: 503 }
    );
  }

  let body: AskBody;
  try {
    body = (await request.json()) as AskBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return NextResponse.json({ error: "prompt is required." }, { status: 400 });
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return NextResponse.json(
      { error: `prompt must be at most ${MAX_PROMPT_CHARS} characters.` },
      { status: 400 }
    );
  }

  let category: string | null = null;
  if (body.category !== undefined && body.category !== null && body.category !== "") {
    const parsed = parseKnowledgeCategory(body.category);
    if (!parsed) {
      return NextResponse.json({ error: "category is invalid." }, { status: 400 });
    }
    category = parsed;
  }

  let embedding: number[];
  try {
    embedding = await embedKnowledgeText({
      genAI,
      text: prompt,
      taskType: TaskType.RETRIEVAL_QUERY,
    });
  } catch (error) {
    console.error("Knowledge ask embed error:", error);
    return NextResponse.json(
      { error: geminiFailureMessage(error, "Gemini embedding failed.") },
      { status: 502 }
    );
  }

  const matched = await matchDocuments({ embedding, category });
  if (matched.error) {
    console.error("Knowledge ask retrieve error:", matched.error);
    return NextResponse.json({ error: `Supabase retrieval failed: ${matched.error}` }, { status: 500 });
  }

  const context = buildContextBlock(matched.sources);
  let answer: string;
  try {
    const model = genAI.getGenerativeModel({ model: GEMINI_TEXT_MODEL });
    const result = await model.generateContent(buildRagPrompt(prompt, context));
    answer = result.response.text().trim();
    if (!answer) {
      return NextResponse.json({ error: "Gemini returned an empty answer." }, { status: 502 });
    }
  } catch (error) {
    console.error("Knowledge ask generate error:", error);
    return NextResponse.json(
      { error: geminiFailureMessage(error, "Gemini generation failed.") },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    answer,
    sources: matched.sources.map((source) => ({
      id: source.id,
      title: source.title,
      category: source.category,
      similarity: source.similarity,
    })),
  });
}
