import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { filterPlannerStaffProfiles } from "@/lib/plannerAssignees";
import { getAuthRole } from "@/lib/server/getAuthRole";

export const dynamic = "force-dynamic";

function serviceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const key = serviceKey || anonKey;
  if (!url || !key) {
    return null;
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET() {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = serviceSupabase();
  if (!sb) {
    return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  }

  // Staff and team accounts only. Client logins live in profiles.role = 'client'
  // and must never be offered as task assignees. Archived profiles stay in the
  // database so historical tasks can still resolve names.
  const { data, error } = await sb
    .from("profiles")
    .select("id, email, full_name, role, is_archived")
    .or("is_archived.eq.false,is_archived.is.null")
    .not("role", "ilike", "client")
    .order("full_name");

  if (error) {
    // Older DBs without is_archived still must not return client logins.
    if (/is_archived|column|schema|Could not find/i.test(error.message)) {
      const retry = await sb
        .from("profiles")
        .select("id, email, full_name, role")
        .not("role", "ilike", "client")
        .order("full_name");
      if (retry.error) {
        return NextResponse.json({ error: retry.error.message }, { status: 500 });
      }
      return NextResponse.json({ data: toAssigneePayload(retry.data ?? []) });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: toAssigneePayload(data ?? []) });
}

type AssigneeProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  role?: string | null;
  is_archived?: boolean | null;
};

function toAssigneePayload(rows: AssigneeProfileRow[]) {
  return filterPlannerStaffProfiles(rows).map((row) => ({
    id: row.id,
    email: row.email ?? null,
    full_name: row.full_name ?? null,
    role: typeof row.role === "string" ? row.role : null,
    is_archived: row.is_archived === true,
  }));
}
