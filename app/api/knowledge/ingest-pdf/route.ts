import { NextResponse } from "next/server";

import {
  DEFAULT_KNOWLEDGE_CATEGORY,
  KNOWLEDGE_CATEGORIES,
  parseKnowledgeCategory,
} from "@/lib/knowledgeCategories";
import { assertModuleAccess } from "@/lib/server/assertModuleAccess";
import { extractPdfText, looksLikePdf } from "@/lib/server/extractPdfText";
import {
  embedKnowledgeText,
  geminiFailureMessage,
  getGeminiClient,
  TaskType,
} from "@/lib/server/geminiKnowledge";
import {
  chunkKnowledgeText,
  knowledgePdfChunkTitle,
  sanitizeUploadedFilename,
} from "@/lib/server/knowledgeChunk";
import {
  getKnowledgeSupabase,
  KNOWLEDGE_LIST_COLUMNS,
  mapKnowledgeDocumentRow,
  type KnowledgeDocumentListItem,
  type KnowledgeDocumentRow,
} from "@/lib/server/knowledgeSupabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Large PDFs throttle at 1s/chunk; allow room for rate-limit retries. */
export const maxDuration = 900;

const MAX_PDF_BYTES = 40 * 1024 * 1024;
const MAX_CHUNKS = 400;
/** Pause between successful embedding calls to stay under Gemini RPM limits. */
const EMBED_THROTTLE_MS = 1_000;
/** Fixed wait after a 429 / quota error before retrying the same chunk. */
const EMBED_RATE_LIMIT_BACKOFF_MS = 15_000;
/** Extra attempts after the first failure (total attempts = 1 + this). */
const EMBED_MAX_RETRIES = 3;

type IngestPdfFailureBody = {
  error: string;
  documents: KnowledgeDocumentListItem[];
  savedCount: number;
  totalChunks: number;
  failedAt: number | null;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitEmbedError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error ?? "")).toLowerCase();
  return (
    message.includes("429") ||
    message.includes("quota") ||
    message.includes("rate limit") ||
    message.includes("resource exhausted") ||
    message.includes("too many requests")
  );
}

/**
 * Embed a single chunk. On Gemini quota / rate-limit errors, wait 15s and retry
 * the same chunk up to EMBED_MAX_RETRIES times before failing.
 */
async function embedChunkWithRetry(params: {
  genAI: NonNullable<ReturnType<typeof getGeminiClient>>;
  text: string;
  partNumber: number;
  totalChunks: number;
}): Promise<number[]> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= EMBED_MAX_RETRIES; attempt++) {
    try {
      return await embedKnowledgeText({
        genAI: params.genAI,
        text: params.text,
        taskType: TaskType.RETRIEVAL_DOCUMENT,
      });
    } catch (error) {
      lastError = error;
      const retriesLeft = EMBED_MAX_RETRIES - attempt;
      if (retriesLeft <= 0 || !isRateLimitEmbedError(error)) {
        throw error;
      }
      console.warn(
        `Knowledge PDF ingest rate-limited at part ${params.partNumber}/${params.totalChunks}; ` +
          `waiting ${EMBED_RATE_LIMIT_BACKOFF_MS / 1000}s then retrying ` +
          `(${attempt + 1}/${EMBED_MAX_RETRIES})…`
      );
      await sleep(EMBED_RATE_LIMIT_BACKOFF_MS);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Gemini embedding failed.");
}

function failureResponse(
  status: number,
  error: string,
  extras?: Partial<IngestPdfFailureBody>
): NextResponse<IngestPdfFailureBody> {
  return NextResponse.json(
    {
      error,
      documents: extras?.documents ?? [],
      savedCount: extras?.savedCount ?? 0,
      totalChunks: extras?.totalChunks ?? 0,
      failedAt: extras?.failedAt ?? null,
    },
    { status }
  );
}

/** POST /api/knowledge/ingest-pdf — parse an uploaded PDF, chunk, embed, and store each part. */
export async function POST(request: Request) {
  const access = await assertModuleAccess("knowledge");
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const genAI = getGeminiClient();
  if (!genAI) {
    return failureResponse(503, "Gemini API key is missing. Set GEMINI_API_KEY in your environment.");
  }

  const sb = getKnowledgeSupabase();
  if (!sb) {
    return failureResponse(503, "Database is not configured. Set SUPABASE_SERVICE_ROLE_KEY.");
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (parseError) {
    const detail = parseError instanceof Error ? parseError.message : String(parseError);
    console.error("Knowledge PDF ingest FormData parse error:", detail);
    return failureResponse(
      413,
      "Failed to read the uploaded PDF. The file may be too large, or the request was truncated."
    );
  }

  const uploaded = formData.get("file");
  if (!(uploaded instanceof Blob) || uploaded.size === 0) {
    return failureResponse(400, "A PDF file is required.");
  }
  if (uploaded.size > MAX_PDF_BYTES) {
    return failureResponse(
      400,
      `PDF is too large (${Math.ceil(uploaded.size / (1024 * 1024))} MB). Keep it under ${MAX_PDF_BYTES / (1024 * 1024)} MB.`
    );
  }

  const originalFilename = sanitizeUploadedFilename(
    uploaded instanceof File && uploaded.name.trim() ? uploaded.name : "document.pdf"
  );
  const mimeType = (uploaded.type || "").toLowerCase();
  if (mimeType && mimeType !== "application/pdf" && !originalFilename.toLowerCase().endsWith(".pdf")) {
    return failureResponse(400, "Only PDF files are supported.");
  }

  const categoryRaw = formData.get("category");
  const category =
    categoryRaw === undefined || categoryRaw === null || categoryRaw === ""
      ? DEFAULT_KNOWLEDGE_CATEGORY
      : parseKnowledgeCategory(categoryRaw);

  if (!category) {
    return failureResponse(400, `category must be one of: ${KNOWLEDGE_CATEGORIES.join(", ")}.`);
  }

  const documentGroupId = crypto.randomUUID();
  const savedDocuments: KnowledgeDocumentListItem[] = [];
  let totalChunks = 0;

  try {
    const buffer = new Uint8Array(await uploaded.arrayBuffer());
    if (!looksLikePdf(buffer)) {
      return failureResponse(400, "The uploaded file is not a valid PDF.");
    }

    const extracted = await extractPdfText(buffer);
    const chunks = chunkKnowledgeText(extracted.text);
    totalChunks = chunks.length;

    if (totalChunks === 0) {
      return failureResponse(
        400,
        extracted.pageCount > 0
          ? "No extractable text was found in this PDF. It may be scanned images only."
          : "No extractable text was found in this PDF."
      );
    }
    if (totalChunks > MAX_CHUNKS) {
      return failureResponse(
        400,
        `This PDF would produce ${totalChunks} chunks (limit ${MAX_CHUNKS}). Split the file into smaller parts and try again.`
      );
    }

    for (let index = 0; index < chunks.length; index++) {
      const partNumber = index + 1;
      const content = chunks[index]!;
      const title = knowledgePdfChunkTitle(originalFilename, partNumber);

      // Throttle between Gemini calls (skip before the first chunk).
      if (index > 0) {
        await sleep(EMBED_THROTTLE_MS);
      }

      try {
        const embedding = await embedChunkWithRetry({
          genAI,
          text: content,
          partNumber,
          totalChunks,
        });
        const { data, error } = await sb
          .from("knowledge_documents")
          .insert({
            title,
            content,
            category,
            embedding,
            document_group_id: documentGroupId,
          })
          .select(KNOWLEDGE_LIST_COLUMNS)
          .single();

        if (error || !data) {
          const message = error?.message ?? "Failed to save knowledge document.";
          const isVectorError = /vector|embedding|dimension/i.test(message);
          throw new Error(
            isVectorError ? `Supabase rejected the embedding: ${message}` : `Supabase insert failed: ${message}`
          );
        }

        savedDocuments.push(mapKnowledgeDocumentRow(data as KnowledgeDocumentRow));
      } catch (chunkError) {
        console.error(`Knowledge PDF ingest failed at chunk ${partNumber}/${totalChunks}:`, chunkError);
        const reason =
          chunkError instanceof Error && /supabase/i.test(chunkError.message)
            ? chunkError.message
            : geminiFailureMessage(chunkError, "Gemini embedding failed.");
        const savedCount = savedDocuments.length;
        return failureResponse(
          savedCount > 0 ? 500 : 502,
          savedCount > 0
            ? `PDF ingest stopped at part ${partNumber} of ${totalChunks} (“${title}”). Saved ${savedCount} chunk${savedCount === 1 ? "" : "s"} from “${originalFilename}”. ${reason}`
            : `PDF ingest failed at part ${partNumber} of ${totalChunks} (“${title}”). No chunks were saved. ${reason}`,
          {
            documents: savedDocuments,
            savedCount,
            totalChunks,
            failedAt: partNumber,
          }
        );
      }
    }

    const groupedDocument: KnowledgeDocumentListItem = {
      id: documentGroupId,
      documentGroupId,
      title: originalFilename,
      category,
      createdAt: savedDocuments[0]?.createdAt ?? new Date().toISOString(),
      chunkCount: savedDocuments.length,
    };

    return NextResponse.json(
      {
        ok: true,
        filename: originalFilename,
        pageCount: extracted.pageCount,
        chunkCount: savedDocuments.length,
        document: groupedDocument,
        documents: [groupedDocument],
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Knowledge PDF ingest error:", error);
    const savedCount = savedDocuments.length;
    const message = error instanceof Error ? error.message : "Failed to process PDF.";
    return failureResponse(
      savedCount > 0 ? 500 : /extract|password|pdf/i.test(message) ? 400 : 500,
      savedCount > 0
        ? `PDF ingest failed after saving ${savedCount} of ${totalChunks || savedCount} chunk${savedCount === 1 ? "" : "s"} from “${originalFilename}”. ${message}`
        : message,
      {
        documents: savedDocuments,
        savedCount,
        totalChunks,
        failedAt: savedCount > 0 ? savedCount + 1 : 1,
      }
    );
  }
}
