import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { formatScriptProjectLabel, normalizeScriptStatus, type ScriptStatus } from "@/lib/scriptStatuses";

export type ScriptRow = {
  id: string;
  title: string;
  content: string;
  project_id: string | null;
  shoot_id: string | null;
  moodboard_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export type ScriptListItem = {
  id: string;
  title: string;
  status: ScriptStatus;
  projectId: string | null;
  projectName: string | null;
  shootId: string | null;
  shootName: string | null;
  moodboardId: string | null;
  moodboardName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ScriptDetail = ScriptListItem & {
  content: string;
};

export const SCRIPT_SELECT_COLUMNS =
  "id, title, content, project_id, shoot_id, moodboard_id, status, created_at, updated_at" as const;

export function getScriptsSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) {
    return null;
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export type LinkedAssetNames = {
  projectName: string | null;
  shootName: string | null;
  moodboardName: string | null;
};

export function mapScriptRow(
  row: ScriptRow,
  names: LinkedAssetNames = {
    projectName: null,
    shootName: null,
    moodboardName: null,
  }
): ScriptDetail {
  return {
    id: row.id,
    title: row.title?.trim() || "Untitled Script",
    content: typeof row.content === "string" ? row.content : "",
    status: normalizeScriptStatus(row.status),
    projectId: row.project_id?.trim() ? row.project_id.trim() : null,
    projectName: names.projectName,
    shootId: row.shoot_id?.trim() ? row.shoot_id.trim() : null,
    shootName: names.shootName,
    moodboardId: row.moodboard_id?.trim() ? row.moodboard_id.trim() : null,
    moodboardName: names.moodboardName,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function resolveLabels(
  sb: SupabaseClient,
  table: string,
  ids: string[],
  labelFn: (row: Record<string, unknown>) => string
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;

  const { data, error } = await sb.from(table).select("*").in("id", unique);
  if (error || !data) {
    console.warn(`[scripts] Failed to resolve labels from ${table}:`, error?.message);
    return map;
  }
  for (const row of data) {
    const r = row as Record<string, unknown>;
    const id = String(r.id ?? "").trim();
    if (id) map.set(id, labelFn(r));
  }
  return map;
}

export async function resolveLinkedAssetNames(
  sb: SupabaseClient,
  rows: Array<Pick<ScriptRow, "project_id" | "shoot_id" | "moodboard_id">>
): Promise<{
  projectNames: Map<string, string>;
  shootNames: Map<string, string>;
  moodboardNames: Map<string, string>;
}> {
  const projectIds = rows
    .map((r) => r.project_id)
    .filter((id): id is string => typeof id === "string" && Boolean(id.trim()));
  const shootIds = rows
    .map((r) => r.shoot_id)
    .filter((id): id is string => typeof id === "string" && Boolean(id.trim()));
  const moodboardIds = rows
    .map((r) => r.moodboard_id)
    .filter((id): id is string => typeof id === "string" && Boolean(id.trim()));

  const [projectNames, shootNames, moodboardNames] = await Promise.all([
    resolveLabels(sb, "studio_tasks", projectIds, (r) => {
      const title = typeof r.title === "string" ? r.title.trim() : "";
      const client = typeof r.client_name === "string" ? r.client_name.trim() : "";
      if (title && client) return `${title} · ${client}`;
      return title || client || String(r.id).slice(0, 8);
    }),
    resolveLabels(sb, "tasks", shootIds, (r) =>
      formatScriptProjectLabel({
        title: typeof r.title === "string" ? r.title : null,
        company_name: typeof r.company_name === "string" ? r.company_name : null,
        photoshoot_type: typeof r.photoshoot_type === "string" ? r.photoshoot_type : null,
        shoot_location: typeof r.shoot_location === "string" ? r.shoot_location : null,
      })
    ),
    resolveLabels(sb, "moodboards", moodboardIds, (r) => {
      const title = typeof r.title === "string" ? r.title.trim() : "";
      return title || "Untitled Moodboard";
    }),
  ]);

  return { projectNames, shootNames, moodboardNames };
}

export function namesForRow(
  row: ScriptRow,
  maps: Awaited<ReturnType<typeof resolveLinkedAssetNames>>
): LinkedAssetNames {
  return {
    projectName: row.project_id ? maps.projectNames.get(row.project_id) ?? null : null,
    shootName: row.shoot_id ? maps.shootNames.get(row.shoot_id) ?? null : null,
    moodboardName: row.moodboard_id
      ? maps.moodboardNames.get(row.moodboard_id) ?? null
      : null,
  };
}

export type AssetOption = { id: string; label: string };

export async function listLinkedAssetOptions(sb: SupabaseClient): Promise<{
  shoots: AssetOption[];
  plannerTasks: AssetOption[];
  moodboards: AssetOption[];
}> {
  const [shootsRes, tasksRes, boardsRes] = await Promise.all([
    sb
      .from("tasks")
      .select("id, title, company_name, photoshoot_type, shoot_location, is_archived")
      .order("photoshoot_date", { ascending: false, nullsFirst: false })
      .limit(400),
    sb
      .from("studio_tasks")
      .select("id, title, client_name, status")
      .order("order_index", { ascending: true, nullsFirst: false })
      .limit(400),
    sb.from("moodboards").select("id, title").order("created_at", { ascending: false }).limit(400),
  ]);

  if (shootsRes.error) throw new Error(shootsRes.error.message);
  if (tasksRes.error) throw new Error(tasksRes.error.message);
  if (boardsRes.error) throw new Error(boardsRes.error.message);

  const shoots = (shootsRes.data ?? [])
    .filter((row) => (row as { is_archived?: boolean | null }).is_archived !== true)
    .map((row) => {
      const r = row as {
        id: string;
        title?: string | null;
        company_name?: string | null;
        photoshoot_type?: string | null;
        shoot_location?: string | null;
      };
      return { id: r.id, label: formatScriptProjectLabel(r) };
    });

  const plannerTasks = (tasksRes.data ?? []).map((row) => {
    const r = row as { id: string; title?: string | null; client_name?: string | null };
    const title = r.title?.trim() || "Untitled task";
    const client = r.client_name?.trim();
    return { id: r.id, label: client ? `${title} · ${client}` : title };
  });

  const moodboards = (boardsRes.data ?? []).map((row) => {
    const r = row as { id: string; title?: string | null };
    return { id: r.id, label: r.title?.trim() || "Untitled Moodboard" };
  });

  return { shoots, plannerTasks, moodboards };
}
