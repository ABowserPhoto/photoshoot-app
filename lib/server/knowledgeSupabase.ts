import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DEFAULT_KNOWLEDGE_CATEGORY,
  type KnowledgeCategory,
} from "@/lib/knowledgeCategories";
import { createServiceRoleClient } from "@/lib/server/supabaseServer";

export const KNOWLEDGE_EMBEDDING_DIMENSIONS = 768;
export const KNOWLEDGE_MATCH_THRESHOLD = 0.5;
export const KNOWLEDGE_MATCH_COUNT = 3;

export const KNOWLEDGE_LIST_COLUMNS =
  "id, title, category, created_at, document_group_id" as const;

/** Matches titles produced by `knowledgePdfChunkTitle`, e.g. `Manual.pdf - Part 3`. */
const PART_SUFFIX_RE = /\s+-\s+Part\s+\d+\s*$/i;

export type KnowledgeDocumentListItem = {
  /** Primary UI key — `document_group_id` when present, else row `id`. */
  id: string;
  documentGroupId: string;
  title: string;
  category: KnowledgeCategory | string;
  createdAt: string;
  chunkCount: number;
};

export type KnowledgeDocumentRow = {
  id: string;
  title: string;
  category: string | null;
  created_at: string;
  document_group_id: string | null;
};

/**
 * knowledge_documents has RLS enabled with no anon/authenticated policies.
 * All reads/writes go through the service role after route-level auth checks.
 */
export function getKnowledgeSupabase(): SupabaseClient | null {
  return createServiceRoleClient();
}

export function stripKnowledgePartSuffix(title: string): string {
  const stripped = title.replace(PART_SUFFIX_RE, "").trim();
  return stripped || title;
}

export function mapKnowledgeDocumentRow(row: KnowledgeDocumentRow): KnowledgeDocumentListItem {
  const documentGroupId = row.document_group_id?.trim() || row.id;
  return {
    id: documentGroupId,
    documentGroupId,
    title: stripKnowledgePartSuffix(row.title),
    category: row.category?.trim() || DEFAULT_KNOWLEDGE_CATEGORY,
    createdAt: row.created_at,
    chunkCount: 1,
  };
}

/** Collapse chunk rows that share a `document_group_id` into one list entry. */
export function groupKnowledgeDocumentRows(rows: KnowledgeDocumentRow[]): KnowledgeDocumentListItem[] {
  const groups = new Map<string, KnowledgeDocumentListItem>();

  for (const row of rows) {
    const documentGroupId = row.document_group_id?.trim() || row.id;
    const existing = groups.get(documentGroupId);
    if (!existing) {
      groups.set(documentGroupId, mapKnowledgeDocumentRow(row));
      continue;
    }

    existing.chunkCount += 1;
    if (row.created_at < existing.createdAt) {
      existing.createdAt = row.created_at;
    }
  }

  return Array.from(groups.values()).sort((a, b) => {
    if (a.createdAt === b.createdAt) return a.title.localeCompare(b.title);
    return a.createdAt < b.createdAt ? 1 : -1;
  });
}
