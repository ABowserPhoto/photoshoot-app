import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getAuthRole } from "@/lib/server/getAuthRole";

export function getMessagesSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export type MessageAuth = {
  authenticated: boolean;
  isAdmin: boolean;
  userId: string | null;
};

/** Resolves auth role plus Supabase session user id (null for gate-cookie-only auth). */
export async function getMessageAuth(): Promise<MessageAuth> {
  const auth = await getAuthRole();
  let userId: string | null = null;

  const cookieStore = await cookies();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (supabaseUrl && supabaseAnonKey) {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Cookie writes can fail in non-mutable contexts; session read still works.
          }
        },
      },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  }

  return {
    authenticated: auth.authenticated,
    isAdmin: auth.isAdmin,
    userId,
  };
}

export type EmployeeMessageRow = {
  id: string;
  sender_id: string;
  recipient_id: string;
  content: string;
  is_read: boolean;
  source_note_id: string | null;
  created_at: string;
};

export type MessageSenderProfile = {
  id: string;
  fullName: string | null;
  email: string | null;
  avatarUrl: string | null;
};

export type UnreadMessage = {
  id: string;
  content: string;
  createdAt: string;
  sourceNoteId: string | null;
  sender: MessageSenderProfile;
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Append a reply block to a Tiptap HTML note body. */
export function appendReplyToNoteHtml(
  existingHtml: string,
  replierName: string,
  replyText: string
): string {
  const safeName = escapeHtml(replierName.trim() || "Someone");
  const safeReply = escapeHtml(replyText.trim()).replace(/\n/g, "<br>");
  const block = `<br><br>- ${safeName}<br>${safeReply}`;
  const base = (existingHtml || "").trim();
  return base ? `${base}${block}` : block;
}

/** Strip Tiptap/HTML note body down to plain text for sticky messages. */
export function noteHtmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function resolveSenderAvatars(
  sb: SupabaseClient,
  senderIds: string[]
): Promise<Map<string, string | null>> {
  const unique = [...new Set(senderIds.filter(Boolean))];
  const map = new Map<string, string | null>();
  for (const id of unique) {
    map.set(id, null);
  }
  if (unique.length === 0) return map;

  await Promise.all(
    unique.map(async (id) => {
      try {
        const { data, error } = await sb.auth.admin.getUserById(id);
        if (error || !data?.user) return;
        const meta = data.user.user_metadata as Record<string, unknown> | undefined;
        const avatar =
          (typeof meta?.avatar_url === "string" && meta.avatar_url.trim()) ||
          (typeof meta?.avatarUrl === "string" && meta.avatarUrl.trim()) ||
          null;
        map.set(id, avatar);
      } catch {
        // Auth admin may be unavailable without service role; leave null.
      }
    })
  );

  return map;
}
