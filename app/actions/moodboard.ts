"use server";

import fs from "node:fs";
import path from "node:path";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { getAuthRole } from "@/lib/server/getAuthRole";

/**
 * Expected Supabase tables:
 *
 * moodboards (
 *   id uuid primary key default gen_random_uuid(),
 *   title text not null default 'Untitled Moodboard',
 *   studio_task_id uuid references studio_tasks(id),
 *   created_at timestamptz default now()
 * )
 *
 * moodboard_elements (
 *   id uuid primary key default gen_random_uuid(),
 *   moodboard_id uuid not null references moodboards(id) on delete cascade,
 *   type text not null check (type in ('note','color','image','link','video','line','drawing','arrow','comment','file','shape')),
 *   x double precision not null default 0,
 *   y double precision not null default 0,
 *   width double precision not null default 200,
 *   height double precision not null default 160,
 *   content jsonb not null default '{}'::jsonb,
 *   z_index integer not null default 0,
 *   created_at timestamptz default now()
 * )
 *
 * Optional storage bucket (public): moodboard-images — or set MOODBOARD_STORAGE_BUCKET.
 */

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

function moodboardBucket(): string {
  return process.env.MOODBOARD_STORAGE_BUCKET?.trim() || "moodboard-images";
}

export type MoodboardRecord = {
  id: string;
  title: string;
  studio_task_id?: string | null;
  created_at?: string;
};

export type MoodboardSummary = {
  id: string;
  title: string;
};

export type MoodboardElementRecord = {
  id: string;
  moodboard_id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z_index: number;
  content: Record<string, unknown>;
};

type Ok<T extends Record<string, unknown> = Record<string, never>> = { ok: true } & T;
type Err = { ok: false; error: string };

function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeElement(row: Record<string, unknown>): MoodboardElementRecord {
  const rawType = row.type ?? row.element_type ?? "note";
  const contentRaw = row.content;
  const content =
    contentRaw && typeof contentRaw === "object" && !Array.isArray(contentRaw)
      ? (contentRaw as Record<string, unknown>)
      : {};

  return {
    id: String(row.id),
    moodboard_id: String(row.moodboard_id),
    type: String(rawType),
    x: num(row.x),
    y: num(row.y),
    width: num(row.width, 200),
    height: num(row.height, 160),
    z_index: Math.round(num(row.z_index, 0)),
    content,
  };
}

function normalizeMoodboard(row: Record<string, unknown>): MoodboardRecord {
  return {
    id: String(row.id),
    title: String(row.title ?? "Untitled Moodboard"),
    studio_task_id:
      row.studio_task_id != null && String(row.studio_task_id).trim()
        ? String(row.studio_task_id)
        : null,
    created_at: row.created_at ? String(row.created_at) : undefined,
  };
}

async function fetchMoodboardElements(
  sb: NonNullable<ReturnType<typeof serviceSupabase>>,
  moodboardId: string
): Promise<Ok<{ elements: MoodboardElementRecord[] }> | Err> {
  const { data: elementsRaw, error: elErr } = await sb
    .from("moodboard_elements")
    .select("*")
    .eq("moodboard_id", moodboardId)
    .order("z_index", { ascending: true })
    .order("id", { ascending: true });

  if (elErr) {
    return { ok: false, error: elErr.message };
  }

  const elements = (elementsRaw ?? []).map((r) => normalizeElement(r as Record<string, unknown>));
  return { ok: true, elements };
}

export async function getAllMoodboards(): Promise<Ok<{ moodboards: MoodboardSummary[] }> | Err> {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return { ok: false, error: "Unauthorized" };
  }

  const sb = serviceSupabase();
  if (!sb) {
    return { ok: false, error: "Database is not configured." };
  }

  const { data, error } = await sb
    .from("moodboards")
    .select("id, title")
    .order("created_at", { ascending: false });

  if (error) {
    return { ok: false, error: error.message };
  }

  const moodboards: MoodboardSummary[] = (data ?? []).map((row) => {
    const r = row as { id: unknown; title: unknown };
    return {
      id: String(r.id),
      title: String(r.title ?? "Untitled Moodboard"),
    };
  });

  return { ok: true, moodboards };
}

export async function getMoodboardById(
  moodboardId: string
): Promise<Ok<{ moodboard: MoodboardRecord; elements: MoodboardElementRecord[] }> | Err> {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return { ok: false, error: "Unauthorized" };
  }

  const sb = serviceSupabase();
  if (!sb) {
    return { ok: false, error: "Database is not configured." };
  }

  const id = moodboardId.trim();
  if (!id) {
    return { ok: false, error: "Missing moodboard id." };
  }

  const { data: row, error: boardErr } = await sb
    .from("moodboards")
    .select("id, title, studio_task_id, created_at")
    .eq("id", id)
    .maybeSingle();

  if (boardErr) {
    return { ok: false, error: boardErr.message };
  }
  if (!row) {
    return { ok: false, error: "Moodboard not found." };
  }

  const moodboard = normalizeMoodboard(row as Record<string, unknown>);
  const elementsRes = await fetchMoodboardElements(sb, moodboard.id);
  if (!elementsRes.ok) {
    return elementsRes;
  }

  return { ok: true, moodboard, elements: elementsRes.elements };
}

export async function getOrCreateTaskMoodboard(
  taskId: string,
  taskTitle: string
): Promise<Ok<{ moodboardId: string }> | Err> {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return { ok: false, error: "Unauthorized" };
  }

  const sb = serviceSupabase();
  if (!sb) {
    return { ok: false, error: "Database is not configured." };
  }

  const id = taskId.trim();
  if (!id) {
    return { ok: false, error: "Missing task id." };
  }

  const { data: existing, error: findErr } = await sb
    .from("moodboards")
    .select("id")
    .eq("studio_task_id", id)
    .limit(1)
    .maybeSingle();

  if (findErr) {
    return { ok: false, error: findErr.message };
  }
  if (existing?.id) {
    return { ok: true, moodboardId: String(existing.id) };
  }

  const reviewTitle = `Review: ${taskTitle.trim() || "Untitled Task"}`;
  const { data, error } = await sb
    .from("moodboards")
    .insert({ title: reviewTitle, studio_task_id: id })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[getOrCreateTaskMoodboard]", error);
    return { ok: false, error: error?.message ?? "Could not create review moodboard." };
  }

  return { ok: true, moodboardId: String((data as { id: string }).id) };
}

export async function getOrCreateActiveMoodboard(): Promise<
  Ok<{ moodboard: MoodboardRecord; elements: MoodboardElementRecord[] }> | Err
> {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return { ok: false, error: "Unauthorized" };
  }

  const sb = serviceSupabase();
  if (!sb) {
    return { ok: false, error: "Database is not configured." };
  }

  const { data: boards, error: boardErr } = await sb
    .from("moodboards")
    .select("id, title, studio_task_id, created_at")
    .order("created_at", { ascending: false })
    .limit(1);

  if (boardErr) {
    return { ok: false, error: boardErr.message };
  }

  let moodboard: MoodboardRecord;

  if (!boards?.length) {
    const created = await createMoodboard("Untitled Moodboard");
    if (!created.ok) {
      return created;
    }
    const { data: row, error: fetchErr } = await sb
      .from("moodboards")
      .select("id, title, studio_task_id, created_at")
      .eq("id", created.id)
      .single();

    if (fetchErr || !row) {
      return { ok: false, error: fetchErr?.message ?? "Could not load new moodboard." };
    }
    moodboard = normalizeMoodboard(row as Record<string, unknown>);
  } else {
    moodboard = normalizeMoodboard(boards[0] as Record<string, unknown>);
  }

  const elementsRes = await fetchMoodboardElements(sb, moodboard.id);
  if (!elementsRes.ok) {
    return elementsRes;
  }

  return { ok: true, moodboard, elements: elementsRes.elements };
}

export async function createMoodboard(title: string): Promise<Ok<{ id: string }> | Err> {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return { ok: false, error: "Unauthorized" };
  }

  const sb = serviceSupabase();
  if (!sb) {
    return { ok: false, error: "Database is not configured." };
  }

  const t = title.trim() || "Untitled Moodboard";

  const { data, error } = await sb.from("moodboards").insert({ title: t }).select("id").single();

  if (error || !data) {
    console.error("[createMoodboard]", error);
    return { ok: false, error: error?.message ?? "Could not create moodboard." };
  }

  return { ok: true, id: String((data as { id: string }).id) };
}

export async function updateMoodboardTitle(moodboardId: string, title: string): Promise<{ ok: true } | Err> {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return { ok: false, error: "Unauthorized" };
  }

  const sb = serviceSupabase();
  if (!sb) {
    return { ok: false, error: "Database is not configured." };
  }

  const id = moodboardId.trim();
  if (!id) {
    return { ok: false, error: "Missing moodboard id." };
  }

  const { error } = await sb.from("moodboards").update({ title: title.trim() || "Untitled Moodboard" }).eq("id", id);

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

export async function deleteMoodboard(moodboardId: string): Promise<{ ok: true } | Err> {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return { ok: false, error: "Unauthorized" };
  }

  const sb = serviceSupabase();
  if (!sb) {
    return { ok: false, error: "Database is not configured." };
  }

  const id = moodboardId.trim();
  if (!id) {
    return { ok: false, error: "Missing moodboard id." };
  }

  const { error } = await sb.from("moodboards").delete().eq("id", id);

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

async function createAuthSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  const cookieStore = await cookies();
  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Cookie writes can fail in non-mutable contexts; session read still works.
        }
      },
    },
  });
}

async function getCommentAuthorDefaults(): Promise<{
  userName: string;
  avatarUrl: string;
} | null> {
  try {
    const supabase = await createAuthSupabaseClient();
    if (!supabase) {
      return null;
    }

    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      return null;
    }

    const user = data.user;
    const meta = user.user_metadata as Record<string, unknown> | undefined;
    const firstName =
      (typeof meta?.first_name === "string" && meta.first_name.trim()) ||
      (typeof meta?.full_name === "string" && meta.full_name.split(" ")[0]?.trim()) ||
      user.email?.split("@")[0] ||
      "User";
    const avatarUrl = (typeof meta?.avatar_url === "string" && meta.avatar_url) || "";

    return {
      userName: firstName,
      avatarUrl,
    };
  } catch (err) {
    console.warn("[getCommentAuthorDefaults]", err);
    return null;
  }
}

const COMMENT_PROFILE_FALLBACK = {
  userName: "User",
  avatarUrl: "",
} as const;

export async function updateUserProfileMetadata(input: {
  firstName?: string;
  avatarUrl?: string;
}): Promise<{ ok: true } | Err> {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return { ok: false, error: "Unauthorized" };
  }

  const supabase = await createAuthSupabaseClient();
  if (!supabase) {
    return { ok: false, error: "Auth is not configured." };
  }

  const data: Record<string, string> = {};
  if (input.firstName !== undefined) {
    data.first_name = input.firstName.trim();
  }
  if (input.avatarUrl !== undefined) {
    data.avatar_url = input.avatarUrl;
  }

  if (Object.keys(data).length === 0) {
    return { ok: false, error: "Nothing to update." };
  }

  const { error } = await supabase.auth.updateUser({ data });
  if (error) {
    console.error("[updateUserProfileMetadata]", error);
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

export async function createElement(input: {
  moodboardId: string;
  type:
    | "note"
    | "color"
    | "image"
    | "link"
    | "video"
    | "line"
    | "drawing"
    | "arrow"
    | "comment"
    | "file"
    | "shape";
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  content?: Record<string, unknown>;
}): Promise<Ok<{ element: MoodboardElementRecord }> | Err> {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return { ok: false, error: "Unauthorized" };
  }

  const sb = serviceSupabase();
  if (!sb) {
    return { ok: false, error: "Database is not configured." };
  }

  const moodboardId = input.moodboardId.trim();
  if (!moodboardId) {
    return { ok: false, error: "Missing moodboard id." };
  }

  const defaults: Record<string, { w: number; h: number; content: Record<string, unknown> }> = {
    note: { w: 240, h: 180, content: { text: "", bgHex: "#fef9c3" } },
    color: { w: 140, h: 140, content: { hex: "#eab308" } },
    image: { w: 320, h: 220, content: { url: "" } },
    link: { w: 320, h: 168, content: { url: "", label: "" } },
    video: { w: 420, h: 280, content: { url: "" } },
    line: {
      w: 280,
      h: 200,
      content: {
        strokeColor: "#52525b",
        strokeWidth: 4,
        curved: false,
        x1: 12,
        y1: 88,
        x2: 88,
        y2: 12,
        qx: 50,
        qy: 20,
      },
    },
    drawing: { w: 340, h: 260, content: { drawingData: { paths: [] }, strokeHex: "#fafafa" } },
    comment: { w: 280, h: 320, content: { text: "", userName: "User", avatarUrl: "" } },
    file: { w: 280, h: 120, content: { url: "", fileName: "" } },
    shape: { w: 200, h: 160, content: { shapeType: "rectangle", fillHex: "#d4d4d8" } },
    arrow: {
      w: 280,
      h: 200,
      content: {
        strokeColor: "#52525b",
        strokeWidth: 4,
        curved: false,
        x1: 12,
        y1: 88,
        x2: 88,
        y2: 12,
        qx: 50,
        qy: 20,
      },
    },
  };

  const d = defaults[input.type];
  const jitter = () => 40 + Math.floor(Math.random() * 80);

  let content = { ...d.content, ...input.content };
  if (input.type === "comment") {
    try {
      const profile = await getCommentAuthorDefaults();
      if (profile) {
        content = { ...content, ...profile };
      }
    } catch (err) {
      console.warn("[createElement comment profile]", err);
      content = { ...content, ...COMMENT_PROFILE_FALLBACK };
    }
  }

  const row = {
    moodboard_id: moodboardId,
    type: input.type,
    x: input.x ?? jitter(),
    y: input.y ?? jitter(),
    width: input.width ?? d.w,
    height: input.height ?? d.h,
    z_index: 0,
    content,
  };

  const { data, error } = await sb.from("moodboard_elements").insert(row).select("*").single();

  if (error || !data) {
    console.error("[createElement]", error);
    return { ok: false, error: error?.message ?? "Could not create element." };
  }

  return { ok: true, element: normalizeElement(data as Record<string, unknown>) };
}

export async function updateElementPosition(input: {
  elementId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}): Promise<{ ok: true } | Err> {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return { ok: false, error: "Unauthorized" };
  }

  const sb = serviceSupabase();
  if (!sb) {
    return { ok: false, error: "Database is not configured." };
  }

  const id = input.elementId.trim();
  if (!id) {
    return { ok: false, error: "Missing element id." };
  }

  const x = Math.round(Number(input.x));
  const y = Math.round(Number(input.y));
  const width = Math.max(1, Math.round(Number(input.width)));
  const height = Math.max(1, Math.round(Number(input.height)));
  if (![x, y, width, height].every((value) => Number.isFinite(value))) {
    return { ok: false, error: "Invalid x/y/width/height payload." };
  }

  const { error } = await sb
    .from("moodboard_elements")
    .update({
      x,
      y,
      width,
      height,
    })
    .eq("id", id);

  if (error) {
    console.error("[updateElementPosition]", {
      elementId: id,
      payload: {
        x,
        y,
        width,
        height,
      },
      error: error.message,
    });
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

/**
 * Replace element JSONB content. Payload is deep-cloned via JSON so only
 * serializable structures (paths, urls, nested drawingData, etc.) are persisted.
 */
export async function updateElementContent(input: {
  elementId: string;
  content: Record<string, unknown>;
}): Promise<{ ok: true } | Err> {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return { ok: false, error: "Unauthorized" };
  }

  const sb = serviceSupabase();
  if (!sb) {
    return { ok: false, error: "Database is not configured." };
  }

  const id = input.elementId.trim();
  if (!id) {
    return { ok: false, error: "Missing element id." };
  }

  let sanitized: Record<string, unknown>;
  try {
    sanitized = JSON.parse(JSON.stringify(input.content)) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "Invalid content payload (must be JSON-serializable)." };
  }

  const { error } = await sb.from("moodboard_elements").update({ content: sanitized }).eq("id", id);

  if (error) {
    console.error("[updateElementContent]", {
      elementId: id,
      payload: sanitized,
      error: error.message,
    });
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

export async function updateElementZIndex(input: {
  elementId: string;
  zIndex: number;
}): Promise<{ ok: true } | Err> {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return { ok: false, error: "Unauthorized" };
  }

  const sb = serviceSupabase();
  if (!sb) {
    return { ok: false, error: "Database is not configured." };
  }

  const id = input.elementId.trim();
  if (!id) {
    return { ok: false, error: "Missing element id." };
  }

  const z = Math.round(Number(input.zIndex));
  if (!Number.isFinite(z)) {
    return { ok: false, error: "Invalid z_index." };
  }

  const { error } = await sb.from("moodboard_elements").update({ z_index: z }).eq("id", id);

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

export async function deleteElement(elementId: string): Promise<{ ok: true } | Err> {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return { ok: false, error: "Unauthorized" };
  }

  const sb = serviceSupabase();
  if (!sb) {
    return { ok: false, error: "Database is not configured." };
  }

  const id = elementId.trim();
  if (!id) {
    return { ok: false, error: "Missing element id." };
  }

  const { error } = await sb.from("moodboard_elements").delete().eq("id", id);

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

export async function uploadMoodboardImage(formData: FormData): Promise<Ok<{ publicUrl: string }> | Err> {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return { ok: false, error: "Unauthorized" };
  }

  const sb = serviceSupabase();
  if (!sb) {
    return { ok: false, error: "Database is not configured." };
  }

  const moodboardId = String(formData.get("moodboardId") ?? "").trim();
  const file = formData.get("file");

  if (!moodboardId || !(file instanceof Blob) || file.size === 0) {
    return { ok: false, error: "Missing moodboard or file." };
  }

  const bucket = moodboardBucket();
  const ext =
    file instanceof File && file.name.includes(".")
      ? file.name.slice(file.name.lastIndexOf("."))
      : ".png";
  const path = `${moodboardId}/${crypto.randomUUID()}${ext}`;

  const buf = Buffer.from(await file.arrayBuffer());

  const { error: upErr } = await sb.storage.from(bucket).upload(path, buf, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });

  if (upErr) {
    console.error("[uploadMoodboardImage]", upErr);
    return { ok: false, error: upErr.message };
  }

  const { data: pub } = sb.storage.from(bucket).getPublicUrl(path);
  const publicUrl = pub.publicUrl;

  return { ok: true, publicUrl };
}

async function resolveMoodboardImageUrl(
  moodboardId: string,
  imageUrl: string
): Promise<{ ok: true; url: string } | Err> {
  const trimmed = imageUrl.trim();
  if (!trimmed) {
    return { ok: false, error: "Missing image URL." };
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return { ok: true, url: trimmed.split("?")[0] };
  }

  let pathname = trimmed;
  try {
    pathname = new URL(trimmed, "http://localhost").pathname;
  } catch {
    pathname = trimmed.split("?")[0]?.split("#")[0] ?? trimmed;
  }

  if (!pathname.startsWith("/temp_ai/")) {
    const relative = pathname.startsWith("/") ? pathname : `/${pathname}`;
    return { ok: true, url: relative };
  }

  const sb = serviceSupabase();
  if (!sb) {
    return { ok: false, error: "Database is not configured." };
  }

  const safeFile = path.basename(decodeURIComponent(pathname));
  const filePath = path.resolve(process.cwd(), "public", "temp_ai", safeFile);
  const tempRoot = path.resolve(process.cwd(), "public", "temp_ai");
  if (!filePath.toLowerCase().startsWith(tempRoot.toLowerCase() + path.sep)) {
    return { ok: false, error: "Invalid preview image path." };
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return { ok: false, error: "Preview image file not found." };
  }

  const buf = fs.readFileSync(filePath);
  const ext = path.extname(safeFile) || ".png";
  const storagePath = `${moodboardId}/${crypto.randomUUID()}${ext}`;
  const contentType =
    ext.toLowerCase() === ".png"
      ? "image/png"
      : ext.toLowerCase() === ".webp"
        ? "image/webp"
        : "image/jpeg";

  const { error: upErr } = await sb.storage.from(moodboardBucket()).upload(storagePath, buf, {
    contentType,
    upsert: false,
  });

  if (upErr) {
    console.error("[resolveMoodboardImageUrl]", upErr);
    return { ok: false, error: upErr.message };
  }

  const { data: pub } = sb.storage.from(moodboardBucket()).getPublicUrl(storagePath);
  return { ok: true, url: pub.publicUrl };
}

export async function sendImageToMoodboard(
  boardId: string,
  imageUrl: string
): Promise<{ success: true } | { success: false; error: string }> {
  const trimmedBoardId = boardId.trim();
  const trimmedUrl = imageUrl.trim();

  if (!trimmedBoardId || !trimmedUrl) {
    return { success: false, error: "Missing moodboard or image URL." };
  }

  const resolved = await resolveMoodboardImageUrl(trimmedBoardId, trimmedUrl);
  if (!resolved.ok) {
    return { success: false, error: resolved.error };
  }

  const result = await createElement({
    moodboardId: trimmedBoardId,
    type: "image",
    x: 500,
    y: 300,
    width: 320,
    height: 320,
    content: { url: resolved.url },
  });

  if (!result.ok) {
    return { success: false, error: result.error };
  }

  return { success: true };
}
