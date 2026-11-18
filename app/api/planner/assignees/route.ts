import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { clientAccountIdSet, filterPlannerStaffProfiles } from "@/lib/plannerAssignees";
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
  // and on clients.user_id. Archived profiles stay in the database so historical
  // tasks can still resolve names, but they are not picker options.
  const [profilesResult, clientIds] = await Promise.all([
    loadStaffProfileRows(sb),
    loadClientAccountIds(sb),
  ]);

  if (profilesResult.error) {
    return NextResponse.json({ error: profilesResult.error }, { status: 500 });
  }

  return NextResponse.json(
    { data: toAssigneePayload(profilesResult.rows, clientIds) },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}

type ServiceClient = NonNullable<ReturnType<typeof serviceSupabase>>;

async function loadStaffProfileRows(
  sb: ServiceClient
): Promise<{ rows: AssigneeProfileRow[]; error: string | null }> {
  const primary = await sb
    .from("profiles")
    .select("id, email, full_name, role, is_archived")
    .or("is_archived.eq.false,is_archived.is.null")
    .not("role", "is", null)
    .not("role", "ilike", "client")
    .order("full_name");

  if (!primary.error) {
    return { rows: (primary.data ?? []) as AssigneeProfileRow[], error: null };
  }

  // Older DBs without is_archived still must not return client logins.
  if (/is_archived|schema cache|Could not find/i.test(primary.error.message)) {
    const retry = await sb
      .from("profiles")
      .select("id, email, full_name, role")
      .not("role", "is", null)
      .not("role", "ilike", "client")
      .order("full_name");
    if (retry.error) {
      return { rows: [], error: retry.error.message };
    }
    return { rows: (retry.data ?? []) as AssigneeProfileRow[], error: null };
  }

  return { rows: [], error: primary.error.message };
}

async function loadClientAccountIds(sb: ServiceClient): Promise<Set<string>> {
  const { data, error } = await sb.from("clients").select("user_id");
  if (error) {
    console.warn("[planner/assignees] clients lookup skipped:", error.message);
    return new Set();
  }
  return clientAccountIdSet((data ?? []) as { user_id?: unknown }[]);
}

type AssigneeProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  role?: string | null;
  is_archived?: boolean | null;
};

function toAssigneePayload(rows: AssigneeProfileRow[], clientAccountIds: ReadonlySet<string>) {
  return filterPlannerStaffProfiles(rows, clientAccountIds).map((row) => ({
    id: row.id,
    email: row.email ?? null,
    full_name: row.full_name ?? null,
    role: typeof row.role === "string" ? row.role : null,
    is_archived: row.is_archived === true,
  }));
}
