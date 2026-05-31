import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { getAuthRole } from "@/lib/server/getAuthRole";

export const dynamic = "force-dynamic";

type StudioWidgetTaskRow = {
  id: string;
  title: string | null;
  status: string | null;
  started_at: string | null;
  elapsed_seconds: number | null;
  assigned_to: string | null;
};

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

async function getSessionUserId(): Promise<string | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }
  const cookieStore = await cookies();
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {
        // No-op on route reads.
      },
    },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function GET(request: Request) {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const sb = serviceSupabase();
  if (!sb) {
    return NextResponse.json({ ok: false, error: "Database is not configured." }, { status: 503 });
  }

  const url = new URL(request.url);
  const requestedLimit = Number.parseInt(url.searchParams.get("limit") ?? "3", 10);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 10) : 3;
  const userId = await getSessionUserId();
  const isGatekeeperMode = !userId;

  let activeQuery = sb
    .from("studio_tasks")
    .select("id,title,status,started_at,elapsed_seconds,assigned_to")
    .eq("status", "processing")
    .order("updated_at", { ascending: false })
    .limit(1);
  let listQuery = sb
    .from("studio_tasks")
    .select("id,title,status,started_at,elapsed_seconds,assigned_to")
    .not("status", "in", '("completed","template")')
    .order("order_index", { ascending: true })
    .limit(limit);

  if (userId) {
    activeQuery = activeQuery.or(`assigned_to.eq.${userId},assigned_to.is.null`);
    listQuery = listQuery.or(`assigned_to.eq.${userId},assigned_to.is.null`);
  }

  const [activeRes, listRes] = await Promise.all([activeQuery, listQuery]);
  if (activeRes.error) {
    return NextResponse.json({ ok: false, error: activeRes.error.message }, { status: 500 });
  }
  if (listRes.error) {
    return NextResponse.json({ ok: false, error: listRes.error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    mode: isGatekeeperMode ? "gatekeeper" : "supabase",
    userId,
    activeTask: ((activeRes.data ?? []) as StudioWidgetTaskRow[])[0] ?? null,
    tasks: (listRes.data ?? []) as StudioWidgetTaskRow[],
  });
}

export async function POST(request: Request) {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const sb = serviceSupabase();
  if (!sb) {
    return NextResponse.json({ ok: false, error: "Database is not configured." }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        action?: string;
        taskId?: string;
        status?: string;
        extra?: Record<string, unknown>;
        title?: string;
        assignedTo?: string | null;
      }
    | null;

  const action = body?.action?.trim() ?? "";
  if (action === "update-status") {
    const taskId = body?.taskId?.trim() ?? "";
    const status = body?.status?.trim() ?? "";
    if (!taskId || !status) {
      return NextResponse.json({ ok: false, error: "Missing taskId or status." }, { status: 400 });
    }
    const payload: Record<string, unknown> = {
      status,
      ...(body?.extra ?? {}),
    };
    if (status.toLowerCase() === "completed" && payload.completed_at == null) {
      payload.completed_at = new Date().toISOString();
    }
    const { error } = await sb.from("studio_tasks").update(payload).eq("id", taskId);
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (action === "create") {
    const title = body?.title?.trim() ?? "";
    if (!title) {
      return NextResponse.json({ ok: false, error: "Missing title." }, { status: 400 });
    }
    const sessionUserId = await getSessionUserId();
    const assignedTo = typeof body?.assignedTo === "string" ? body.assignedTo : sessionUserId;
    const { error } = await sb.from("studio_tasks").insert({
      title,
      description: "",
      status: "master",
      elapsed_seconds: 0,
      started_at: null,
      subtasks: [],
      assigned_users: [],
      assigned_to: assignedTo,
      order_index: 999999,
    });
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: "Unsupported action." }, { status: 400 });
}
