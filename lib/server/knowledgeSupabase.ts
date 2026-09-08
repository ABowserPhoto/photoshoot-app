import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DEFAULT_KNOWLEDGE_CATEGORY,
  type KnowledgeCategory,
} from "@/lib/knowledgeCategories";
import { createServiceRoleClient } from "@/lib/server/supabaseServer";

export const KNOWLEDGE_EMBEDDING_DIMENSIONS = 768;
export const KNOWLEDGE_MATCH_THRESHOLD = 0.5;
export const KNOWLEDGE_MATCH_COUNT = 3;

export const KNOWLEDGE_LIST_COLUMNS = "id, title, category, created_at" as const;

export type KnowledgeDocumentListItem = {
  id: string;
  title: string;
  category: KnowledgeCategory | string;
  createdAt: string;
};

export type KnowledgeDocumentRow = {
  id: string;
  title: string;
  category: string | null;
  created_at: string;
};

/**
 * knowledge_documents has RLS enabled with no anon/authenticated policies.
 * All reads/writes go through the service role after route-level auth checks.
 */
export function getKnowledgeSupabase(): SupabaseClient | null {
  return createServiceRoleClient();
}

export function mapKnowledgeDocumentRow(row: KnowledgeDocumentRow): KnowledgeDocumentListItem {
  return {
    id: row.id,
    title: row.title,
    category: row.category?.trim() || DEFAULT_KNOWLEDGE_CATEGORY,
    createdAt: row.created_at,
  };
}
