import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { getAdminAreaAuth } from "@/lib/server/getAdminAreaAuth";

export const dynamic = "force-dynamic";

function serviceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

type LinkBody = {
  userId?: unknown;
  jibblePersonId?: unknown;
};

/**
 * PATCH /api/admin/crm/users/link-jibble
 * Body: { userId: string, jibblePersonId: string | null }
 *
 * Sets (or clears) profiles.jibble_employee_id for the given Supabase user.
 * Passing null or an empty string unlinks the account.
 */
export async function PATCH(request: Request) {
  const auth = await getAdminAreaAuth();
  if (!auth.authenticated || !auth.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: LinkBody;
  try {
    body = (await request.json()) as LinkBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  if (!userId) {
    return NextResponse.json({ error: "userId is required." }, { status: 400 });
  }

  const rawJibbleId =
    typeof body.jibblePersonId === "string" ? body.jibblePersonId.trim() : null;
  const jibbleEmployeeId = rawJibbleId || null;

  const supabase = serviceSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Database is not configured. Set SUPABASE_SERVICE_ROLE_KEY." },
      { status: 503 }
    );
  }

  const { error } = await supabase
    .from("profiles")
    .update({ jibble_employee_id: jibbleEmployeeId })
    .eq("id", userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    userId,
    jibblePersonId: jibbleEmployeeId,
  });
}
