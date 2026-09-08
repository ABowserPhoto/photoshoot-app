"use client";

import { Loader2, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import KnowledgeSourceBadges from "@/app/components/KnowledgeSourceBadges";
import { askKnowledge, type KnowledgeAskSource } from "@/lib/knowledgeAsk";
import {
  KNOWLEDGE_CATEGORIES,
  type KnowledgeCategory,
} from "@/lib/knowledgeCategories";

type ChatMessage =
  | { id: string; role: "user"; content: string }
  | { id: string; role: "assistant"; content: string; sources: KnowledgeAskSource[] };

type CategoryChoice = "all" | KnowledgeCategory;

function newId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function KnowledgeAssistantPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [category, setCategory] = useState<CategoryChoice>("all");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  const handleSend = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed || sending) return;

    const userMessage: ChatMessage = { id: newId(), role: "user", content: trimmed };
    setMessages((prev) => [...prev, userMessage]);
    setPrompt("");
    setSending(true);
    setError(null);

    try {
      const result = await askKnowledge({
        prompt: trimmed,
        category: category === "all" ? null : category,
      });
      setMessages((prev) => [
        ...prev,
        {
          id: newId(),
          role: "assistant",
          content: result.answer,
          sources: result.sources,
        },
      ]);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to ask the knowledge base.";
      setError(message);
      setMessages((prev) => [
        ...prev,
        {
          id: newId(),
          role: "assistant",
          content: `I couldn't answer that: ${message}`,
          sources: [],
        },
      ]);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const onComposerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  return (
    <main className="flex min-h-[calc(100dvh-64px)] flex-col bg-zinc-950">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-6 sm:px-6">
        <header className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-400">
            Knowledge Module
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">AI Assistant</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Ask studio SOP questions. Answers are grounded in the knowledge base. Use Ctrl+K from
            anywhere for a quick search.
          </p>
        </header>

        <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-zinc-800 bg-zinc-900/60">
          <div className="min-h-[22rem] flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
            {messages.length === 0 && !sending ? (
              <div className="flex h-full min-h-[16rem] items-center justify-center">
                <p className="max-w-md text-center text-sm text-zinc-500">
                  Ask how the studio handles galleries, invoicing, SEO, or shoot settings. Restrict
                  the search with the category dropdown below.
                </p>
              </div>
            ) : (
              messages.map((message) =>
                message.role === "user" ? (
                  <div key={message.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-violet-600 px-4 py-2.5 text-sm leading-6 text-white">
                      {message.content}
                    </div>
                  </div>
                ) : (
                  <div key={message.id} className="flex justify-start">
                    <div className="max-w-[85%] space-y-2 rounded-2xl rounded-bl-md border border-zinc-800 bg-zinc-950 px-4 py-3">
                      <p className="whitespace-pre-wrap text-sm leading-6 text-zinc-100">
                        {message.content}
                      </p>
                      <KnowledgeSourceBadges sources={message.sources} />
                    </div>
                  </div>
                )
              )
            )}
            {sending ? (
              <div className="flex justify-start">
                <div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-md border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-400">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Searching SOPs…
                </div>
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>

          {error ? (
            <div className="border-t border-red-900/60 bg-red-950/30 px-4 py-2 text-xs text-red-200">
              {error}
            </div>
          ) : null}

          <form
            onSubmit={(event) => void handleSend(event)}
            className="border-t border-zinc-800 p-3 sm:p-4"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="block shrink-0 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                Category
                <select
                  value={category}
                  onChange={(event) => setCategory(event.target.value as CategoryChoice)}
                  className="mt-1 h-10 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm font-normal text-zinc-100 outline-none focus:border-violet-500 sm:w-52"
                >
                  <option value="all">All knowledge bases</option>
                  {KNOWLEDGE_CATEGORIES.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block min-w-0 flex-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                Message
                <textarea
                  ref={inputRef}
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  onKeyDown={onComposerKeyDown}
                  rows={2}
                  placeholder="Ask a question…"
                  className="mt-1 w-full resize-none rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-normal leading-5 text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-violet-500"
                />
              </label>
              <button
                type="submit"
                disabled={sending || !prompt.trim()}
                className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
                Send
              </button>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
