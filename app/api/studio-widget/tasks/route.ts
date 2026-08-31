import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { getAuthRole } from "@/lib/server/getAuthRole";
import { isStudioTaskUnassigned, isUserOnStudioTask, parseAssignedUsers } from "@/lib/plannerAssignees";

export const dynamic = "force-dynamic";

type WidgetView = "studio" | "workflow";

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

type WorkflowTaskRow = {
  id: string;
  title: string | null;
  company_name: string | null;
  contact_first_name: string | null;
  contact_last_name: string | null;
  shoot_location: string | null;
  photoshoot_type: string | null;
  status: string | null;
  editing_started_at: string | null;
  total_editing_seconds: number | null;
  photoshoot_date: string | null;
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

function parseView(value: unknown): WidgetView {
  return String(value ?? "").trim().toLowerCase() === "workflow" ? "workflow" : "studio";
}

function workflowDisplayTitle(row: WorkflowTaskRow): string {
  const title = typeof row.title === "string" ? row.title.trim() : "";
  if (title) return title;
  const client =
    (typeof row.company_name === "string" && row.company_name.trim()) ||
    [row.contact_first_name, row.contact_last_name]
      .map((part) => (typeof part === "string" ? part.trim() : ""))
      .filter(Boolean)
      .join(" ");
  const parts = [row.photoshoot_type?.trim(), client, row.shoot_location?.trim()].filter(Boolean);
  return parts.join(" - ") || "Untitled Task";
}

function mapWorkflowRow(row: WorkflowTaskRow) {
  const startedAtMs = row.editing_started_at ? new Date(row.editing_started_at).getTime() : Number.NaN;
  const startedAt = Number.isFinite(startedAtMs) ? new Date(startedAtMs).toISOString() : null;
  return {
    id: String(row.id),
    title: workflowDisplayTitle(row),
    status: row.status,
    started_at: startedAt,
    elapsed_seconds: Math.max(0, row.total_editing_seconds ?? 0),
    assigned_to: null,
  };
}

async function getStudioWidgetState(
  sb: ReturnType<typeof createClient>,
  limit: number,
  userId: string | null
) {
  const isGatekeeperMode = !userId;
  const { data, error } = await sb
    .from("studio_tasks")
    .select("id,title,status,started_at,elapsed_seconds,assigned_to,assigned_users,subtasks")
    .not("status", "in", '("completed","template")')
    .order("order_index", { ascending: true })
    .limit(Math.max(limit * 10, 40));

  if (error) {
    return { ok: false as const, error: error.message };
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

  return {
    ok: true as const,
    mode: isGatekeeperMode ? ("gatekeeper" as const) : ("supabase" as const),
    userId,
    activeTask,
    tasks: visible.slice(0, limit),
  };
}

async function getWorkflowWidgetState(sb: ReturnType<typeof createClient>, limit: number) {
  const { data: readyRows, error: readyError } = await sb
    .from("tasks")
    .select(
      "id,title,company_name,contact_first_name,contact_last_name,shoot_location,photoshoot_type,status,editing_started_at,total_editing_seconds,photoshoot_date"
    )
    .eq("status", "Ready for Review")
    .eq("is_archived", false)
    .order("photoshoot_date", { ascending: true })
    .limit(limit);

  if (readyError) {
    return { ok: false as const, error: readyError.message };
  }

  const { data: editingRows, error: editingError } = await sb
    .from("tasks")
    .select(
      "id,title,company_name,contact_first_name,contact_last_name,shoot_location,photoshoot_type,status,editing_started_at,total_editing_seconds,photoshoot_date"
    )
    .eq("status", "Editing")
    .eq("is_archived", false)
    .order("editing_started_at", { ascending: false })
    .limit(10);

  if (editingError) {
    return { ok: false as const, error: editingError.message };
  }

  const editing = (editingRows ?? []) as WorkflowTaskRow[];
  const activeSource =
    editing.find(
      (row) => typeof row.editing_started_at === "string" && row.editing_started_at.trim().length > 0
    ) ??
    editing[0] ??
    null;

  return {
    ok: true as const,
    mode: "workflow" as const,
    userId: null as string | null,
    activeTask: activeSource ? mapWorkflowRow(activeSource) : null,
    tasks: ((readyRows ?? []) as WorkflowTaskRow[]).map(mapWorkflowRow),
  };
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
  const view = parseView(url.searchParams.get("view"));
  const requestedLimit = Number.parseInt(url.searchParams.get("limit") ?? "3", 10);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 10) : 3;
  const userId = await getSessionUserId();

  if (view === "workflow") {
    const result = await getWorkflowWidgetState(sb, limit);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
    }
    return NextResponse.json({
      ok: true,
      view,
      mode: result.mode,
      userId,
      activeTask: result.activeTask,
      tasks: result.tasks,
    });
  }

  const result = await getStudioWidgetState(sb, limit, userId);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    view,
    mode: result.mode,
    userId: result.userId,
    activeTask: result.activeTask,
    tasks: result.tasks,
  });
}

async function pauseOtherWorkflowTimers(
  sb: ReturnType<typeof createClient>,
  exceptTaskId: string
) {
  const nowSec = Math.floor(Date.now() / 1000);
  const { data: runningOthers } = await sb
    .from("tasks")
    .select("id, editing_started_at, total_editing_seconds")
    .eq("status", "Editing")
    .not("editing_started_at", "is", null)
    .neq("id", exceptTaskId);

  for (const row of runningOthers ?? []) {
    const other = row as {
      id: string;
      editing_started_at: string | null;
      total_editing_seconds: number | null;
    };
    const startedAtMs = other.editing_started_at ? new Date(other.editing_started_at).getTime() : Number.NaN;
    const startedAtSec = Number.isFinite(startedAtMs) ? Math.floor(startedAtMs / 1000) : null;
    const baseElapsed = Math.max(0, other.total_editing_seconds ?? 0);
    const elapsed =
      startedAtSec !== null ? baseElapsed + Math.max(0, nowSec - startedAtSec) : baseElapsed;
    await sb
      .from("tasks")
      .update({
        editing_started_at: null,
        total_editing_seconds: elapsed,
      })
      .eq("id", other.id);
  }
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
        view?: string;
        taskId?: string;
        status?: string;
        extra?: Record<string, unknown>;
        title?: string;
        assignedTo?: string | null;
      }
    | null;

  const action = body?.action?.trim() ?? "";
  const view = parseView(body?.view);

  if (action === "update-status" && view === "workflow") {
    const taskId = body?.taskId?.trim() ?? "";
    const status = body?.status?.trim() ?? "";
    if (!taskId || !status) {
      return NextResponse.json({ ok: false, error: "Missing taskId or status." }, { status: 400 });
    }

    const extra = body?.extra ?? {};
    const normalized = status.toLowerCase();
    const payload: Record<string, unknown> = { status, ...extra };

    if (normalized === "editing") {
      await pauseOtherWorkflowTimers(sb, taskId);
      if (payload.editing_started_at === undefined) {
        payload.editing_started_at = new Date().toISOString();
      }
    }

    // Pause while remaining in Editing: accumulate elapsed, clear started_at.
    if (
      normalized === "editing" &&
      Object.prototype.hasOwnProperty.call(extra, "editing_started_at") &&
      extra.editing_started_at === null
    ) {
      payload.editing_started_at = null;
      if (typeof extra.total_editing_seconds === "number") {
        payload.total_editing_seconds = extra.total_editing_seconds;
      }
    }

    const { error } = await sb.from("tasks").update(payload).eq("id", taskId);
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, view });
  }

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
    return NextResponse.json({ ok: true, view: "studio" });
  }

  if (action === "create") {
    if (view === "workflow") {
      return NextResponse.json(
        { ok: false, error: "Creating tasks from the Workflow widget is not supported." },
        { status: 400 }
      );
    }
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
