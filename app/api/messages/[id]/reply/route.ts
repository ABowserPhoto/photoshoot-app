import { NextResponse } from "next/server";

import {
  appendReplyToNoteHtml,
  getMessageAuth,
  getMessagesSupabase,
} from "@/lib/server/employeeMessages";
import { ensureStudioChatsNotebook } from "@/lib/server/notesSupabase";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type ReplyBody = {
  replyText?: unknown;
};

export async function POST(request: Request, context: RouteContext) {
  const auth = await getMessageAuth();
  if (!auth.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!auth.userId) {
    return NextResponse.json(
      { error: "A signed-in user account is required to reply." },
      { status: 403 }
    );
  }

  const { id } = await context.params;
  const messageId = id?.trim();
  if (!messageId) {
    return NextResponse.json({ error: "Message id is required." }, { status: 400 });
  }

  let body: ReplyBody;
  try {
    body = (await request.json()) as ReplyBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const replyText =
    typeof body.replyText === "string" ? body.replyText.trim() : "";
  if (!replyText) {
    return NextResponse.json({ error: "replyText is required." }, { status: 400 });
  }

  const sb = getMessagesSupabase();
  if (!sb) {
    return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  }

  const { data: message, error: messageError } = await sb
    .from("employee_messages")
    .select("id, sender_id, recipient_id, source_note_id, is_read")
    .eq("id", messageId)
    .maybeSingle();

  if (messageError) {
    return NextResponse.json({ error: messageError.message }, { status: 500 });
  }
  if (!message) {
    return NextResponse.json({ error: "Message not found." }, { status: 404 });
  }

  const row = message as {
    id: string;
    sender_id: string;
    recipient_id: string;
    source_note_id: string | null;
    is_read: boolean;
  };

  if (row.recipient_id !== auth.userId && !auth.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!row.source_note_id) {
    return NextResponse.json(
      { error: "This message is not linked to a note, so replies are unavailable." },
      { status: 400 }
    );
  }

  const { data: profile } = await sb
    .from("profiles")
    .select("full_name, email")
    .eq("id", auth.userId)
    .maybeSingle();

  const profileRow = profile as { full_name?: string | null; email?: string | null } | null;
  const replierName =
    profileRow?.full_name?.trim() ||
    profileRow?.email?.trim() ||
    "Someone";

  const { data: note, error: noteError } = await sb
    .from("notes")
    .select("id, content, notebook_id")
    .eq("id", row.source_note_id)
    .maybeSingle();

  if (noteError) {
    return NextResponse.json({ error: noteError.message }, { status: 500 });
  }
  if (!note) {
    return NextResponse.json({ error: "Source note not found." }, { status: 404 });
  }

  const noteRow = note as { id: string; content: string; notebook_id: string };
  const existingContent =
    typeof noteRow.content === "string" ? noteRow.content : "";
  const nextContent = appendReplyToNoteHtml(existingContent, replierName, replyText);

  // Keep chat threads inside Studio Chats.
  const studio = await ensureStudioChatsNotebook(sb);
  const noteUpdate: Record<string, unknown> = {
    content: nextContent,
    updated_at: new Date().toISOString(),
  };
  if (!("error" in studio) && noteRow.notebook_id !== studio.id) {
    noteUpdate.notebook_id = studio.id;
  }

  const { error: updateNoteError } = await sb
    .from("notes")
    .update(noteUpdate)
    .eq("id", row.source_note_id);

  if (updateNoteError) {
    return NextResponse.json({ error: updateNoteError.message }, { status: 500 });
  }

  const { error: markReadError } = await sb
    .from("employee_messages")
    .update({ is_read: true })
    .eq("id", messageId);

  if (markReadError) {
    return NextResponse.json({ error: markReadError.message }, { status: 500 });
  }

  // Notify the original sender via a new sticky message (Realtime INSERT).
  // Soft-fail: note update + dismiss already succeeded.
  let replyMessageId: string | null = null;
  let notifyError: string | null = null;
  const originalSenderId = row.sender_id;

  if (originalSenderId && originalSenderId !== auth.userId) {
    const { data: replyMessage, error: insertError } = await sb
      .from("employee_messages")
      .insert({
        sender_id: auth.userId,
        recipient_id: originalSenderId,
        content: replyText,
        is_read: false,
        source_note_id: row.source_note_id,
      })
      .select("id")
      .maybeSingle();

    if (insertError) {
      console.error("[messages/reply] Failed to notify original sender:", insertError.message);
      notifyError = insertError.message;
    } else {
      replyMessageId = (replyMessage as { id?: string } | null)?.id ?? null;
    }
  }

  return NextResponse.json({
    success: true,
    noteId: row.source_note_id,
    messageId,
    replyMessageId,
    ...(notifyError ? { notifyWarning: notifyError } : {}),
  });
}
