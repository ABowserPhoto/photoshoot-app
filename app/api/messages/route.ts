import { NextResponse } from "next/server";

import {
  getMessageAuth,
  getMessagesSupabase,
  noteHtmlToPlainText,
} from "@/lib/server/employeeMessages";
import {
  createStudioChatNote,
  ensureStudioChatsNotebook,
} from "@/lib/server/notesSupabase";

export const dynamic = "force-dynamic";

type PostBody = {
  recipientId?: unknown;
  content?: unknown;
  sourceNoteId?: unknown;
};

export async function POST(request: Request) {
  const auth = await getMessageAuth();
  if (!auth.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!auth.userId) {
    return NextResponse.json(
      { error: "A signed-in user account is required to send messages." },
      { status: 403 }
    );
  }

  const sb = getMessagesSupabase();
  if (!sb) {
    return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  }

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const recipientId =
    typeof body.recipientId === "string" ? body.recipientId.trim() : "";
  const rawContent = typeof body.content === "string" ? body.content : "";
  const content = noteHtmlToPlainText(rawContent);
  const sourceNoteId =
    typeof body.sourceNoteId === "string" && body.sourceNoteId.trim()
      ? body.sourceNoteId.trim()
      : null;

  if (!recipientId) {
    return NextResponse.json({ error: "recipientId is required." }, { status: 400 });
  }
  if (!content) {
    return NextResponse.json({ error: "Message content is empty." }, { status: 400 });
  }
  if (recipientId === auth.userId) {
    return NextResponse.json({ error: "Cannot send a message to yourself." }, { status: 400 });
  }

  const { data: recipient, error: recipientError } = await sb
    .from("profiles")
    .select("id, full_name, email, is_archived")
    .eq("id", recipientId)
    .maybeSingle();

  if (recipientError) {
    return NextResponse.json({ error: recipientError.message }, { status: 500 });
  }
  if (!recipient) {
    return NextResponse.json({ error: "Recipient not found." }, { status: 404 });
  }
  const recipientRow = recipient as {
    id: string;
    full_name?: string | null;
    email?: string | null;
    is_archived?: boolean;
  };
  if (recipientRow.is_archived === true) {
    return NextResponse.json({ error: "Recipient is archived." }, { status: 400 });
  }

  const recipientLabel =
    recipientRow.full_name?.trim() ||
    recipientRow.email?.trim() ||
    "Employee";

  const studio = await ensureStudioChatsNotebook(sb);
  if ("error" in studio) {
    return NextResponse.json({ error: studio.error }, { status: 500 });
  }

  let resolvedSourceNoteId: string;

  if (sourceNoteId) {
    const { data: note, error: noteError } = await sb
      .from("notes")
      .select("id, notebook_id")
      .eq("id", sourceNoteId)
      .maybeSingle();

    if (noteError) {
      return NextResponse.json({ error: noteError.message }, { status: 500 });
    }
    if (!note) {
      return NextResponse.json({ error: "Source note not found." }, { status: 404 });
    }

    const noteRow = note as { id: string; notebook_id: string };
    if (noteRow.notebook_id !== studio.id) {
      return NextResponse.json(
        {
          error:
            "Sticky-note messages can only be sent from notes in the Studio Chats notebook.",
        },
        { status: 403 }
      );
    }
    resolvedSourceNoteId = noteRow.id;
  } else {
    // Fallback: create a Studio Chats note when no source note is supplied.
    const chatNote = await createStudioChatNote(sb, {
      title: `Chat · ${recipientLabel}`,
      contentPlain: content,
    });
    if ("error" in chatNote) {
      return NextResponse.json({ error: chatNote.error }, { status: 500 });
    }
    resolvedSourceNoteId = chatNote.id;
  }

  const { data, error } = await sb
    .from("employee_messages")
    .insert({
      sender_id: auth.userId,
      recipient_id: recipientId,
      content,
      is_read: false,
      source_note_id: resolvedSourceNoteId,
    })
    .select("id, sender_id, recipient_id, content, is_read, source_note_id, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    message: {
      id: data.id,
      senderId: data.sender_id,
      recipientId: data.recipient_id,
      content: data.content,
      isRead: data.is_read,
      sourceNoteId: data.source_note_id,
      createdAt: data.created_at,
    },
  });
}
