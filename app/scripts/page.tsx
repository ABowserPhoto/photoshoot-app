"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clapperboard, Loader2, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { ScriptStatus } from "@/lib/scriptStatuses";

type ScriptListItem = {
  id: string;
  title: string;
  status: ScriptStatus;
  projectId: string | null;
  projectName: string | null;
  shootId: string | null;
  shootName: string | null;
  moodboardId: string | null;
  moodboardName: string | null;
  createdAt: string;
  updatedAt: string;
};

function formatUpdatedAt(value: string): string {
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

function statusBadgeClass(status: ScriptStatus): string {
  switch (status) {
    case "Idea":
      return "bg-zinc-800 text-zinc-300 ring-zinc-600";
    case "Drafting":
      return "bg-sky-950/60 text-sky-200 ring-sky-800/60";
    case "Ready":
      return "bg-emerald-950/60 text-emerald-200 ring-emerald-800/60";
    case "In Production":
      return "bg-violet-950/60 text-violet-200 ring-violet-800/60";
    default:
      return "bg-zinc-800 text-zinc-300 ring-zinc-600";
  }
}

export default function ScriptsDashboardPage() {
  const router = useRouter();
  const [scripts, setScripts] = useState<ScriptListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadScripts = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/scripts", { cache: "no-store", credentials: "include" });
      const json = (await res.json().catch(() => null)) as
        | { scripts?: ScriptListItem[]; error?: string }
        | null;
      if (!res.ok) {
        throw new Error(json?.error ?? `Failed to load scripts (${res.status})`);
      }
      setScripts(json?.scripts ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load scripts.");
      setScripts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadScripts();
  }, [loadScripts]);

  const handleNewScript = async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/scripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ title: "Untitled Script", status: "Idea" }),
      });
      const json = (await res.json().catch(() => null)) as
        | { script?: { id: string }; error?: string }
        | null;
      if (!res.ok || !json?.script?.id) {
        throw new Error(json?.error ?? "Failed to create script.");
      }
      router.push(`/scripts/${json.script.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create script.");
      setCreating(false);
    }
  };

  const handleDelete = async (script: ScriptListItem) => {
    if (!window.confirm(`Delete “${script.title}”? This cannot be undone.`)) {
      return;
    }
    setDeletingId(script.id);
    setError(null);
    try {
      const res = await fetch(`/api/scripts/${script.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        throw new Error(json?.error ?? "Failed to delete script.");
      }
      setScripts((prev) => prev.filter((s) => s.id !== script.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete script.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <main className="min-h-[calc(100dvh-64px)] bg-zinc-950 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1400px] space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-400">
              Screenwriting Studio
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">Scripts</h1>
            <p className="mt-2 max-w-2xl text-sm text-zinc-400">
              Write Fountain screenplays for animated series episodes, preview industry formatting,
              and optionally link each script to a CRM photoshoot project.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleNewScript()}
            disabled={creating}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
          >
            {creating ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Plus className="h-4 w-4" aria-hidden />
            )}
            New Script
          </button>
        </header>

        {error ? (
          <div className="rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 sm:p-6">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Loading scripts…
            </div>
          ) : scripts.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <Clapperboard className="h-10 w-10 text-zinc-600" aria-hidden />
              <p className="text-sm text-zinc-400">No scripts yet. Create your first episode draft.</p>
              <button
                type="button"
                onClick={() => void handleNewScript()}
                disabled={creating}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-950 px-4 text-sm font-semibold text-zinc-100 hover:bg-zinc-800 disabled:opacity-50"
              >
                <Plus className="h-4 w-4" aria-hidden />
                New Script
              </button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {scripts.map((script) => (
                <article
                  key={script.id}
                  className="group relative flex flex-col rounded-xl border border-zinc-800 bg-zinc-950/70 p-4 transition hover:border-zinc-600"
                >
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${statusBadgeClass(script.status)}`}
                    >
                      {script.status}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleDelete(script)}
                      disabled={deletingId === script.id}
                      className="rounded-md border border-transparent p-1.5 text-zinc-500 opacity-0 transition hover:border-zinc-700 hover:bg-zinc-900 hover:text-red-300 group-hover:opacity-100 disabled:opacity-50"
                      title="Delete script"
                      aria-label={`Delete ${script.title}`}
                    >
                      {deletingId === script.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      )}
                    </button>
                  </div>

                  <Link href={`/scripts/${script.id}`} className="min-w-0 flex-1">
                    <h2 className="truncate text-lg font-semibold text-zinc-50 group-hover:text-white">
                      {script.title}
                    </h2>
                    <p className="mt-2 text-xs text-zinc-500">
                      Updated {formatUpdatedAt(script.updatedAt)}
                    </p>
                    <div className="mt-3 space-y-1 text-xs text-zinc-400">
                      <p>
                        <span className="text-zinc-500">Shoot · </span>
                        {script.shootName || <span className="italic text-zinc-600">Unlinked</span>}
                      </p>
                      <p>
                        <span className="text-zinc-500">Planner · </span>
                        {script.projectName || <span className="italic text-zinc-600">Unlinked</span>}
                      </p>
                      <p>
                        <span className="text-zinc-500">Moodboard · </span>
                        {script.moodboardName || (
                          <span className="italic text-zinc-600">Unlinked</span>
                        )}
                      </p>
                    </div>
                  </Link>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
