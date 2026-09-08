import {
  GoogleGenerativeAI,
  TaskType,
  type EmbedContentRequest,
} from "@google/generative-ai";

import { KNOWLEDGE_EMBEDDING_DIMENSIONS } from "@/lib/server/knowledgeSupabase";

export const GEMINI_EMBEDDING_MODEL =
  process.env.GEMINI_EMBEDDING_MODEL?.trim() || "gemini-embedding-001";

/** Default chat/RAG model. Override with GEMINI_MODEL (gemini-1.5-flash is retired on current keys). */
export const GEMINI_TEXT_MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";

export function getGeminiClient(): GoogleGenerativeAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  return new GoogleGenerativeAI(apiKey);
}

export function geminiFailureMessage(error: unknown, fallback = "Gemini request failed."): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const lower = message.toLowerCase();
  if (!message.trim()) {
    return fallback;
  }
  if (
    lower.includes("api key") ||
    lower.includes("api_key") ||
    lower.includes("permission denied") ||
    lower.includes("unauthenticated")
  ) {
    return "Gemini API key is missing or invalid. Check GEMINI_API_KEY.";
  }
  if (lower.includes("quota") || lower.includes("resource exhausted") || lower.includes("429")) {
    return "Gemini quota was exceeded. Try again later.";
  }
  return `${fallback.replace(/\.$/, "")}: ${message}`;
}

export async function embedKnowledgeText(params: {
  genAI: GoogleGenerativeAI;
  text: string;
  taskType: (typeof TaskType)[keyof typeof TaskType];
}): Promise<number[]> {
  const model = params.genAI.getGenerativeModel({ model: GEMINI_EMBEDDING_MODEL });
  const result = await model.embedContent({
    content: { role: "user", parts: [{ text: params.text }] },
    taskType: params.taskType,
    outputDimensionality: KNOWLEDGE_EMBEDDING_DIMENSIONS,
  } as EmbedContentRequest);
  const values = result.embedding?.values;
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("Gemini returned an empty embedding.");
  }
  if (values.length !== KNOWLEDGE_EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding dimension mismatch: expected ${KNOWLEDGE_EMBEDDING_DIMENSIONS}, got ${values.length}.`
    );
  }
  if (values.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
    throw new Error("Gemini returned a non-numeric embedding.");
  }
  return values;
}

export { TaskType };
