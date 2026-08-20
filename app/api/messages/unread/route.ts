import { NextResponse } from "next/server";

import {
  getMessageAuth,
  getMessagesSupabase,
  resolveSenderAvatars,
  type UnreadMessage,
} from "@/lib/server/employeeMessages";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await getMessageAuth();
  if (!auth.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!auth.userId) {
    return NextResponse.json({ messages: [] as UnreadMessage[] });
  }

  const sb = getMessagesSupabase();
  if (!sb) {
    return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  }

  const { data, error } = await sb
    .from("employee_messages")
    .select(
      `
      id,
      content,
      created_at,
      sender_id,
      source_note_id,
      sender:profiles!employee_messages_sender_id_fkey (
        id,
        full_name,
        email
      )
    `
    )
    .eq("recipient_id", auth.userId)
    .eq("is_read", false)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = data ?? [];
  const senderIds = rows.map((row) => {
    const r = row as { sender_id?: string };
    return typeof r.sender_id === "string" ? r.sender_id : "";
  });
  const avatars = await resolveSenderAvatars(sb, senderIds);

  const messages: UnreadMessage[] = rows.map((row) => {
    const r = row as {
      id: string;
      content: string;
      created_at: string;
      sender_id: string;
      source_note_id: string | null;
      sender:
        | { id: string; full_name: string | null; email: string | null }
        | { id: string; full_name: string | null; email: string | null }[]
        | null;
    };
    const senderRow = Array.isArray(r.sender) ? r.sender[0] : r.sender;
    const senderId = senderRow?.id ?? r.sender_id;
    return {
      id: r.id,
      content: r.content,
      createdAt: r.created_at,
      sourceNoteId: r.source_note_id ?? null,
      sender: {
        id: senderId,
        fullName: senderRow?.full_name ?? null,
        email: senderRow?.email ?? null,
        avatarUrl: avatars.get(senderId) ?? null,
      },
    };
  });

  return NextResponse.json({ messages });
}
