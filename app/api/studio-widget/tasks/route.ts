import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { getAuthRole } from "@/lib/server/getAuthRole";
import { isStudioTaskUnassigned, isUserOnStudioTask, parseAssignedUsers } from "@/lib/plannerAssignees";

export const dynamic = "force-dynamic";

type StudioWidgetTaskRow = {
  id: string;
  title: string | null;
  status: string | null;
  started_at: string | null;
  elapsed_seconds: number | null;
  assigned_to: string | null;
  assigned_users?: unknown;
  subtasks?: unknown;
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

function belongsToUser(row: StudioWidgetTaskRow, userId: string): boolean {
  return isUserOnStudioTask({
    userId,
    assignedTo: row.assigned_to,
    assignedUsers: row.assigned_users,
  });
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

  // Fetch a larger candidate set, then filter by assignee in JS (assigned_users is JSON).
  const { data, error } = await sb
    .from("studio_tasks")
    .select("id,title,status,started_at,elapsed_seconds,assigned_to,assigned_users,subtasks")
    .not("status", "in", '("completed","template")')
    .order("order_index", { ascending: true })
    .limit(Math.max(limit * 10, 40));

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as StudioWidgetTaskRow[];
  const visible = userId
    ? rows.filter((row) => belongsToUser(row, userId))
    : isGatekeeperMode
      ? rows
      : [];

  const activeTask =
    visible.find(
      (row) =>
        String(row.status ?? "").toLowerCase() === "processing" &&
        typeof row.started_at === "string" &&
        row.started_at.trim().length > 0
    ) ?? null;

  const tasks = visible.slice(0, limit);

  return NextResponse.json({
    ok: true,
    mode: isGatekeeperMode ? "gatekeeper" : "supabase",
    userId,
    activeTask,
    tasks,
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

    const sessionUserId = await getSessionUserId();

    // Per-user timer concurrency: pause only this user's other running timers.
    if (status.toLowerCase() === "processing") {
      const nowSec = Math.floor(Date.now() / 1000);

      // Claim unassigned tasks for the user who starts Processing.
      if (sessionUserId) {
        const { data: currentRow } = await sb
          .from("studio_tasks")
          .select("id, assigned_to, assigned_users")
          .eq("id", taskId)
          .maybeSingle();
        const current = currentRow as {
          assigned_to?: string | null;
          assigned_users?: unknown;
        } | null;
        if (
          current &&
          isStudioTaskUnassigned({
            assignedTo: current.assigned_to,
            assignedUsers: current.assigned_users,
          })
        ) {
          payload.assigned_to = sessionUserId;
          const { data: profile } = await sb
            .from("profiles")
            .select("id, full_name, email")
            .eq("id", sessionUserId)
            .maybeSingle();
          const profileRow = profile as { full_name?: string | null; email?: string | null } | null;
          const displayName =
            (typeof profileRow?.full_name === "string" && profileRow.full_name.trim()) ||
            (typeof profileRow?.email === "string" && profileRow.email.trim()) ||
            "You";
          const existingUsers = parseAssignedUsers(current.assigned_users);
          if (!existingUsers.some((u) => u.id === sessionUserId)) {
            payload.assigned_users = [...existingUsers, { id: sessionUserId, name: displayName }];
          } else {
            payload.assigned_users = existingUsers;
          }
        }
      }

      const { data: runningOthers } = await sb
        .from("studio_tasks")
        .select("id, started_at, elapsed_seconds, assigned_to, assigned_users")
        .eq("status", "processing")
        .not("started_at", "is", null)
        .neq("id", taskId);

      for (const row of runningOthers ?? []) {
        const other = row as {
          id: string;
          started_at: string | null;
          elapsed_seconds: number | null;
          assigned_to: string | null;
          assigned_users?: unknown;
        };
        if (sessionUserId) {
          const sameUser = isUserOnStudioTask({
            userId: sessionUserId,
            assignedTo: other.assigned_to,
            assignedUsers: other.assigned_users,
          });
          if (!sameUser) continue;
        }
        const startedAtMs = other.started_at ? new Date(other.started_at).getTime() : Number.NaN;
        const startedAtSec = Number.isFinite(startedAtMs) ? Math.floor(startedAtMs / 1000) : null;
        const baseElapsed = Math.max(0, other.elapsed_seconds ?? 0);
        const elapsed =
          startedAtSec !== null ? baseElapsed + Math.max(0, nowSec - startedAtSec) : baseElapsed;
        await sb
          .from("studio_tasks")
          .update({
            status: "planning",
            started_at: null,
            elapsed_seconds: elapsed,
          })
          .eq("id", other.id);
      }

      if (payload.started_at == null) {
        payload.started_at = new Date().toISOString();
      }
    }

    if (status.toLowerCase() === "planning" && payload.started_at === undefined) {
      payload.started_at = null;
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
