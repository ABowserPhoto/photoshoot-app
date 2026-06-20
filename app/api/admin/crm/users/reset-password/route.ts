import { NextResponse } from "next/server";

import { getAdminAreaAuth } from "@/lib/server/getAdminAreaAuth";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ResetPasswordBody = {
  userId?: unknown;
  newPassword?: unknown;
};

export async function POST(request: Request) {
  const auth = await getAdminAreaAuth();
  if (!auth.authenticated || !auth.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: ResetPasswordBody;
  try {
    body = (await request.json()) as ResetPasswordBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

  if (!userId) {
    return NextResponse.json({ error: "userId is required." }, { status: 400 });
  }
  if (!newPassword || newPassword.length < 8) {
    return NextResponse.json({ error: "newPassword must be at least 8 characters." }, { status: 400 });
  }

  const supabaseAdmin = createSupabaseAdminClient();
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: "Supabase admin client is not configured. Set SUPABASE_SERVICE_ROLE_KEY." },
      { status: 503 }
    );
  }

  const { data: existingData, error: existingError } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 400 });
  }
  if (!existingData.user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    password: newPassword,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
