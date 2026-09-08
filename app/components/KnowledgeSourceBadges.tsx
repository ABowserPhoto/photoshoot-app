"use client";

import { knowledgeCategoryBadgeClass } from "@/lib/knowledgeCategories";
import type { KnowledgeAskSource } from "@/lib/knowledgeAsk";

export default function KnowledgeSourceBadges({ sources }: { sources: KnowledgeAskSource[] }) {
  if (sources.length === 0) {
    return <p className="text-[11px] text-zinc-500">No matching SOP sources.</p>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {sources.map((source) => (
        <span
          key={source.id}
          title={`${source.title} · ${Math.round(source.similarity * 100)}% match`}
          className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold tracking-wide ring-1 ${knowledgeCategoryBadgeClass(source.category)}`}
        >
          <span className="truncate">{source.title}</span>
        </span>
      ))}
    </div>
  );
}
