"use client";

import { BookOpen, Loader2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  DEFAULT_KNOWLEDGE_CATEGORY,
  KNOWLEDGE_CATEGORIES,
  knowledgeCategoryBadgeClass,
  type KnowledgeCategory,
} from "@/lib/knowledgeCategories";

type KnowledgeDocument = {
  id: string;
  title: string;
  category: string;
  createdAt: string;
};

type CategoryFilter = "all" | KnowledgeCategory;

function formatCreatedAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

export default function KnowledgePage() {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");

  const [category, setCategory] = useState<KnowledgeCategory>(DEFAULT_KNOWLEDGE_CATEGORY);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

  const loadDocuments = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/knowledge", { cache: "no-store", credentials: "include" });
      const json = (await res.json().catch(() => null)) as
        | { documents?: KnowledgeDocument[]; error?: string }
        | null;
      if (!res.ok) {
        throw new Error(json?.error ?? `Failed to load documents (${res.status})`);
      }
      setDocuments(json?.documents ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load knowledge documents.");
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  const visibleDocuments = useMemo(() => {
    if (categoryFilter === "all") return documents;
    return documents.filter((document) => document.category === categoryFilter);
  }, [categoryFilter, documents]);

  const handleIngest = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedTitle = title.trim();
    const trimmedContent = content.trim();
    if (!trimmedTitle || !trimmedContent) {
      setError("Title and content are required.");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/knowledge/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title: trimmedTitle,
          content: trimmedContent,
          category,
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | { document?: KnowledgeDocument; error?: string }
        | null;
      if (!res.ok || !json?.document) {
        throw new Error(json?.error ?? "Failed to save document.");
      }
      setDocuments((prev) => [json.document!, ...prev.filter((doc) => doc.id !== json.document!.id)]);
      setTitle("");
      setContent("");
      if (categoryFilter !== "all" && json.document.category !== categoryFilter) {
        setCategoryFilter(json.document.category as CategoryFilter);
      }
      setSuccess(`Saved “${json.document.title}” in ${json.document.category}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save document.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (document: KnowledgeDocument) => {
    if (!window.confirm(`Delete “${document.title}”? This cannot be undone.`)) {
      return;
    }
    setDeletingId(document.id);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/knowledge/${document.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        throw new Error(json?.error ?? "Failed to delete document.");
      }
      setDocuments((prev) => prev.filter((doc) => doc.id !== document.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete document.");
    } finally {
      setDeletingId(null);
    }
  };

  const filterButtonClass = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-semibold transition ${
      active
        ? "border-violet-400 bg-violet-600 text-white"
        : "border-zinc-700 bg-zinc-950 text-zinc-300 hover:border-zinc-500 hover:bg-zinc-800"
    }`;

  return (
    <main className="min-h-[calc(100dvh-64px)] bg-zinc-950 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1400px] space-y-6">
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-400">
            Knowledge Module
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">SOPs & guidelines</h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400">
            Store studio procedures as searchable documents, organized by knowledge base. Ask them
            from{" "}
            <Link href="/ai" className="text-violet-300 underline-offset-2 hover:underline">
              Assistant
            </Link>{" "}
            or press Ctrl+K anywhere.
          </p>
        </header>

        {error ? (
          <div className="rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}
        {success ? (
          <div className="rounded-xl border border-emerald-900/60 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200">
            {success}
          </div>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 sm:p-6">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-white">Document list</h2>
                <p className="mt-1 text-xs text-zinc-500">
                  {loading
                    ? "Loading…"
                    : `${visibleDocuments.length} ${
                        categoryFilter === "all" ? "saved" : categoryFilter
                      } document${visibleDocuments.length === 1 ? "" : "s"}`}
                </p>
              </div>
            </div>

            <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Filter by category">
              <button
                type="button"
                role="tab"
                aria-selected={categoryFilter === "all"}
                onClick={() => setCategoryFilter("all")}
                className={filterButtonClass(categoryFilter === "all")}
              >
                All
              </button>
              {KNOWLEDGE_CATEGORIES.map((item) => (
                <button
                  key={item}
                  type="button"
                  role="tab"
                  aria-selected={categoryFilter === item}
                  onClick={() => setCategoryFilter(item)}
                  className={filterButtonClass(categoryFilter === item)}
                >
                  {item}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-400">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Loading documents…
              </div>
            ) : documents.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <BookOpen className="h-10 w-10 text-zinc-600" aria-hidden />
                <p className="text-sm text-zinc-400">No knowledge documents yet. Add an SOP on the right.</p>
              </div>
            ) : visibleDocuments.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <BookOpen className="h-10 w-10 text-zinc-600" aria-hidden />
                <p className="text-sm text-zinc-400">
                  No {categoryFilter} documents yet. Add one on the right, or choose All.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
                      <th className="px-3 py-2 font-semibold">Title</th>
                      <th className="px-3 py-2 font-semibold">Category</th>
                      <th className="px-3 py-2 font-semibold">Created</th>
                      <th className="px-3 py-2 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleDocuments.map((document) => (
                      <tr key={document.id} className="border-b border-zinc-800/80 last:border-0">
                        <td className="max-w-[28rem] px-3 py-3 font-medium text-zinc-100">
                          <span className="line-clamp-2">{document.title}</span>
                        </td>
                        <td className="px-3 py-3">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-semibold tracking-wide ring-1 ${knowledgeCategoryBadgeClass(document.category)}`}
                          >
                            {document.category}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-zinc-400">
                          {formatCreatedAt(document.createdAt)}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => void handleDelete(document)}
                            disabled={deletingId === document.id}
                            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-2.5 py-1.5 text-xs font-semibold text-zinc-300 hover:border-red-800 hover:bg-red-950/40 hover:text-red-200 disabled:opacity-50"
                          >
                            {deletingId === document.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" aria-hidden />
                            )}
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 sm:p-6">
            <h2 className="text-lg font-semibold text-white">Add new document</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Choose a knowledge base, then paste an SOP or guideline. The raw text is stored and
              embedded for later retrieval.
            </p>

            <form className="mt-5 space-y-4" onSubmit={(event) => void handleIngest(event)}>
              <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-400">
                Category
                <select
                  value={category}
                  onChange={(event) => setCategory(event.target.value as KnowledgeCategory)}
                  className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-normal text-zinc-100 outline-none focus:border-violet-500"
                >
                  {KNOWLEDGE_CATEGORIES.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-400">
                Title
                <input
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={200}
                  required
                  placeholder="e.g. Client gallery delivery SOP"
                  className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-normal text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-violet-500"
                />
              </label>

              <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-400">
                Content
                <textarea
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  required
                  rows={16}
                  maxLength={20000}
                  placeholder="Paste the full SOP or guideline here…"
                  className="mt-2 min-h-[20rem] w-full resize-y rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-normal leading-6 text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-violet-500"
                />
              </label>
              <p className="text-right text-[11px] text-zinc-500">{content.length.toLocaleString()} / 20,000</p>

              <button
                type="submit"
                disabled={saving || !title.trim() || !content.trim()}
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Embedding & saving…
                  </>
                ) : (
                  "Save document"
                )}
              </button>
            </form>
          </section>
        </div>
      </div>
    </main>
  );
}
