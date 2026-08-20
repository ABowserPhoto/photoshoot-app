"use client";

import { Loader2, Reply, Send, Trash2, User } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { supabase } from "@/lib/supabaseClient";

type MessageSender = {
  id: string;
  fullName: string | null;
  email: string | null;
  avatarUrl: string | null;
};

type UnreadMessage = {
  id: string;
  content: string;
  createdAt: string;
  sourceNoteId: string | null;
  sender: MessageSender;
};

function senderDisplayName(sender: MessageSender): string {
  const name = sender.fullName?.trim();
  if (name) return name;
  const email = sender.email?.trim();
  if (email) return email;
  return "Someone";
}

/**
 * Global sticky-note popup for unread employee messages.
 * Visual style mirrors moodboard comment nodes (avatar over dark rounded card).
 * Uses Supabase Realtime so new messages appear without a page refresh.
 */
export default function GlobalMessagePopup() {
  const [messages, setMessages] = useState<UnreadMessage[]>([]);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [replyOpenId, setReplyOpenId] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadUnread = useCallback(async () => {
    try {
      const response = await fetch("/api/messages/unread");
      if (response.status === 401) {
        setMessages([]);
        return;
      }
      const payload = (await response.json().catch(() => null)) as
        | { messages?: UnreadMessage[]; error?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error || `Failed to load messages (${response.status}).`);
      }
      setMessages(payload?.messages ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load messages.");
    }
  }, []);

  useEffect(() => {
    void loadUnread();
  }, [loadUnread]);

  useEffect(() => {
    if (!supabase) return;

    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled || !user?.id) return;

      const nextChannel = supabase
        .channel(`employee-messages:${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "employee_messages",
            filter: `recipient_id=eq.${user.id}`,
          },
          () => {
            void loadUnread();
          }
        )
        .subscribe();

      if (cancelled) {
        void supabase.removeChannel(nextChannel);
        return;
      }
      channel = nextChannel;
    })();

    return () => {
      cancelled = true;
      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [loadUnread]);

  const active = messages[0] ?? null;

  const removeMessage = useCallback((messageId: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
    setReplyOpenId((prev) => (prev === messageId ? null : prev));
    setReplyDraft("");
  }, []);

  const dismiss = useCallback(
    async (messageId: string) => {
      setDismissingId(messageId);
      setError(null);
      try {
        const response = await fetch(`/api/messages/${messageId}/read`, { method: "PATCH" });
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        if (!response.ok) {
          throw new Error(payload?.error || `Failed to dismiss (${response.status}).`);
        }
        removeMessage(messageId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to dismiss message.");
      } finally {
        setDismissingId(null);
      }
    },
    [removeMessage]
  );

  const sendReply = useCallback(
    async (messageId: string) => {
      const text = replyDraft.trim();
      if (!text || replyingId) return;

      setReplyingId(messageId);
      setError(null);
      try {
        const response = await fetch(`/api/messages/${messageId}/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ replyText: text }),
        });
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        if (!response.ok) {
          throw new Error(payload?.error || `Failed to reply (${response.status}).`);
        }
        removeMessage(messageId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to send reply.");
      } finally {
        setReplyingId(null);
      }
    },
    [removeMessage, replyDraft, replyingId]
  );

  if (!active) return null;

  const name = senderDisplayName(active.sender);
  const avatarUrl = active.sender.avatarUrl?.trim() || "";
  const isDismissing = dismissingId === active.id;
  const isReplying = replyingId === active.id;
  const canReply = Boolean(active.sourceNoteId);
  const replyOpen = replyOpenId === active.id;

  return (
    <div
      className="pointer-events-none fixed bottom-6 right-6 z-[100] flex w-[min(100vw-2rem,20rem)] flex-col items-end gap-2"
      role="region"
      aria-label="Employee messages"
    >
      {error ? (
        <p className="pointer-events-auto max-w-full rounded-lg bg-red-950/90 px-3 py-1.5 text-xs text-red-200">
          {error}
        </p>
      ) : null}

      <div className="pointer-events-auto group relative w-full overflow-visible pt-8">
        <div className="absolute left-1/2 top-0 z-10 h-16 w-16 -translate-x-1/2 overflow-hidden rounded-full shadow-xl ring-2 ring-zinc-900">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- auth metadata avatar URL
            <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-zinc-700">
              <User className="h-8 w-8 text-zinc-400" strokeWidth={1.25} />
            </div>
          )}
        </div>

        <div className="relative w-full rounded-xl bg-zinc-800 px-4 pb-4 pt-12 shadow-xl">
          <div className="absolute right-1 top-7 z-10 flex items-center gap-1">
            {canReply ? (
              <button
                type="button"
                onClick={() => {
                  setReplyOpenId((prev) => (prev === active.id ? null : active.id));
                  setError(null);
                }}
                disabled={isDismissing || isReplying}
                className={`rounded-md bg-black/55 p-1 text-zinc-200 transition hover:bg-zinc-600 hover:text-white disabled:opacity-40 ${
                  replyOpen ? "bg-zinc-600 text-white" : "opacity-70 hover:opacity-100"
                }`}
                aria-label={replyOpen ? "Cancel reply" : "Reply"}
                title={replyOpen ? "Cancel reply" : "Reply"}
              >
                <Reply className="h-4 w-4" strokeWidth={2} />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void dismiss(active.id)}
              disabled={isDismissing || isReplying}
              className="rounded-md bg-black/55 p-1 text-zinc-200 opacity-70 transition hover:bg-red-600/90 hover:text-white hover:opacity-100 disabled:opacity-40"
              aria-label="Dismiss message"
              title="Dismiss"
            >
              {isDismissing ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
              ) : (
                <Trash2 className="h-4 w-4" strokeWidth={2} />
              )}
            </button>
          </div>

          <p className="pr-14 text-center text-sm font-semibold text-zinc-100">{name}</p>
          <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-center text-sm leading-snug text-zinc-200">
            {active.content}
          </p>

          {replyOpen ? (
            <div className="mt-3 space-y-2 border-t border-zinc-700/80 pt-3">
              <textarea
                value={replyDraft}
                onChange={(event) => setReplyDraft(event.target.value)}
                placeholder="Write a quick reply…"
                rows={3}
                disabled={isReplying}
                className="w-full resize-none rounded-lg border border-zinc-600 bg-zinc-900/80 px-2.5 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-zinc-400 disabled:opacity-50"
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => void sendReply(active.id)}
                  disabled={!replyDraft.trim() || isReplying}
                  className="inline-flex items-center gap-1 rounded-md border border-amber-600/50 bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-100 hover:bg-amber-500/25 disabled:opacity-40"
                >
                  {isReplying ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                  Send
                </button>
              </div>
            </div>
          ) : null}

          {messages.length > 1 ? (
            <p className="mt-3 text-center text-[11px] text-zinc-500">
              +{messages.length - 1} more
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
