"use client";

import { Loader2, Search, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import KnowledgeSourceBadges from "@/app/components/KnowledgeSourceBadges";
import { useAuthRole } from "@/app/contexts/AuthRoleContext";
import { askKnowledge, type KnowledgeAskSource } from "@/lib/knowledgeAsk";

function isPaletteDisabledPath(pathname: string | null) {
  if (!pathname) return true;
  if (pathname === "/login" || pathname.startsWith("/login/")) return true;
  if (pathname === "/gallery" || pathname.startsWith("/gallery/")) return true;
  if (pathname === "/desktop-widget" || pathname.startsWith("/desktop-widget/")) return true;
  return false;
}

export default function CommandPalette() {
  const pathname = usePathname();
  const { authenticated, isLoading, canAccess, isAdmin } = useAuthRole();
  const enabled =
    !isLoading && authenticated && (isAdmin || canAccess("knowledge")) && !isPaletteDisabledPath(pathname);

  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [sources, setSources] = useState<KnowledgeAskSource[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setAsking(false);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setOpen(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && open) {
        event.preventDefault();
        close();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close, enabled, open]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const id = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(id);
    };
  }, [open]);

  const handleAsk = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed || asking) return;

    setAsking(true);
    setError(null);
    setAnswer(null);
    setSources([]);
    try {
      const result = await askKnowledge({ prompt: trimmed });
      setAnswer(result.answer);
      setSources(result.sources);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to ask the knowledge base.");
    } finally {
      setAsking(false);
    }
  };

  if (!enabled || !open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center px-4 pt-[12vh] sm:px-6">
      <button
        type="button"
        className="absolute inset-0 bg-black/70"
        aria-label="Close knowledge search"
        onClick={close}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="knowledge-command-title"
        className="relative z-[201] w-full max-w-2xl overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-950 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <div>
            <p id="knowledge-command-title" className="text-sm font-semibold text-white">
              Ask the knowledge base
            </p>
            <p className="text-[11px] text-zinc-500">Ctrl+K · answers from ingested SOPs</p>
          </div>
          <button
            type="button"
            onClick={close}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-900"
            aria-label="Close"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <form onSubmit={(event) => void handleAsk(event)} className="border-b border-zinc-800 p-4">
          <label className="sr-only" htmlFor="knowledge-command-input">
            Question
          </label>
          <div className="flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-3">
            <Search className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
            <input
              id="knowledge-command-input"
              ref={inputRef}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Ask about a studio SOP…"
              className="h-12 w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
            />
            {asking ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-violet-300" aria-hidden /> : null}
          </div>
        </form>

        <div className="max-h-[50vh] overflow-y-auto px-4 py-4">
          {error ? (
            <p className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-200">
              {error}
            </p>
          ) : asking ? (
            <p className="text-sm text-zinc-400">Searching SOPs and drafting an answer…</p>
          ) : answer ? (
            <div className="space-y-3">
              <p className="whitespace-pre-wrap text-sm leading-6 text-zinc-100">{answer}</p>
              <KnowledgeSourceBadges sources={sources} />
            </div>
          ) : (
            <p className="text-sm text-zinc-500">Type a question and press Enter.</p>
          )}
        </div>
      </div>
    </div>
  );
}
