/**
 * Knowledge bases for SOPs. Add a new entry here to expand the Category
 * dropdown, ingest validation, list badges, and filters.
 */
export const KNOWLEDGE_CATEGORIES = [
  "General",
  "Bookkeeping",
  "SEO & Marketing",
  "Photography Settings",
  "Client Management",
] as const;

export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number];

export const DEFAULT_KNOWLEDGE_CATEGORY: KnowledgeCategory = "General";

const CATEGORY_SET = new Set<string>(KNOWLEDGE_CATEGORIES);

export function isKnowledgeCategory(value: unknown): value is KnowledgeCategory {
  return typeof value === "string" && CATEGORY_SET.has(value);
}

export function parseKnowledgeCategory(value: unknown): KnowledgeCategory | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return isKnowledgeCategory(trimmed) ? trimmed : null;
}

export function knowledgeCategoryBadgeClass(category: string): string {
  switch (category) {
    case "Bookkeeping":
      return "bg-emerald-950/60 text-emerald-200 ring-emerald-800/60";
    case "SEO & Marketing":
      return "bg-sky-950/60 text-sky-200 ring-sky-800/60";
    case "Photography Settings":
      return "bg-violet-950/60 text-violet-200 ring-violet-800/60";
    case "Client Management":
      return "bg-amber-950/60 text-amber-200 ring-amber-800/60";
    case "General":
    default:
      return "bg-zinc-800 text-zinc-300 ring-zinc-600";
  }
}
