import { NextResponse } from "next/server";

import { getMessageAuth, getMessagesSupabase } from "@/lib/server/employeeMessages";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(_request: Request, context: RouteContext) {
  const auth = await getMessageAuth();
  if (!auth.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!auth.userId) {
    return NextResponse.json(
      { error: "A signed-in user account is required." },
      { status: 403 }
    );
  }

  const { id } = await context.params;
  const messageId = id?.trim();
  if (!messageId) {
    return NextResponse.json({ error: "Message id is required." }, { status: 400 });
  }

  const sb = getMessagesSupabase();
  if (!sb) {
    return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  }

  let query = sb
    .from("employee_messages")
    .update({ is_read: true })
    .eq("id", messageId)
    .eq("is_read", false);

  if (!auth.isAdmin) {
    query = query.eq("recipient_id", auth.userId);
  }

  const { data, error } = await query
    .select("id, is_read")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Message not found." }, { status: 404 });
  }

  return NextResponse.json({ message: { id: data.id, isRead: data.is_read } });
}
