import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { fetchWithTimeout } from "@/lib/server/fetchWithTimeout";
import { getAuthRole } from "@/lib/server/getAuthRole";

const FETCH_TIMEOUT_MS = Number(process.env.TASKS_FETCH_TIMEOUT_MS ?? "8000");

export const NOTE_VISIBILITIES = ["public", "user", "admin_only"] as const;
export type NoteVisibility = (typeof NOTE_VISIBILITIES)[number];

export const NOTEBOOK_ACCESS_LEVELS = ["all", "admin_only", "specific"] as const;
export type NotebookAccessLevel = (typeof NOTEBOOK_ACCESS_LEVELS)[number];

export const STUDIO_CHATS_NAME = "Studio Chats";

export const NOTEBOOK_SELECT_COLUMNS =
  "id, name, created_at, updated_at, creator_id, access_level, assigned_user_ids, is_system";

export function getNotesSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false },
    global: {
      fetch: (input, init) => fetchWithTimeout(input, init, FETCH_TIMEOUT_MS),
    },
  });
}

export type NotesAuth = {
  authenticated: boolean;
  isAdmin: boolean;
  userId: string | null;
};

/** Auth role plus session user id (null for gate-cookie-only sessions). */
export async function getNotesAuth(): Promise<NotesAuth> {
  const auth = await getAuthRole();
  let userId: string | null = null;

  const cookieStore = await cookies();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (supabaseUrl && supabaseAnonKey) {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
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

    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  }

  return {
    authenticated: auth.authenticated,
    isAdmin: auth.isAdmin,
    userId,
  };
}

export type NotebookRow = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  creator_id?: string | null;
  access_level?: string | null;
  assigned_user_ids?: string[] | null;
  is_system?: boolean | null;
};

export type NoteRow = {
  id: string;
  notebook_id: string;
  title: string;
  content: string;
  visibility: NoteVisibility | string;
  moodboard_id: string | null;
  created_at: string;
  updated_at: string;
};

export type NoteSummary = {
  id: string;
  notebookId: string;
  title: string;
  visibility: NoteVisibility;
  moodboardId: string | null;
  updatedAt: string;
  createdAt: string;
};

export type NotebookWithNotes = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  creatorId: string | null;
  accessLevel: NotebookAccessLevel;
  assignedUserIds: string[];
  isSystem: boolean;
  canDelete: boolean;
  canEdit: boolean;
  notes: NoteSummary[];
};

export const NOTE_SELECT_COLUMNS =
  "id, notebook_id, title, content, visibility, moodboard_id, created_at, updated_at";

export function normalizeVisibility(value: unknown): NoteVisibility {
  if (value === "public" || value === "user" || value === "admin_only") {
    return value;
  }
  return "user";
}

export function normalizeAccessLevel(value: unknown): NotebookAccessLevel {
  if (value === "all" || value === "admin_only" || value === "specific") {
    return value;
  }
  return "all";
}

export function normalizeUuidArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
}

/** Non-admins never see admin_only notes. */
export function canViewNoteVisibility(
  visibility: NoteVisibility | string,
  isAdmin: boolean
): boolean {
  if (normalizeVisibility(visibility) === "admin_only") {
    return isAdmin;
  }
  return true;
}

export function canViewNotebook(
  row: Pick<NotebookRow, "creator_id" | "access_level" | "assigned_user_ids" | "is_system">,
  userId: string | null,
  isAdmin: boolean
): boolean {
  if (isAdmin) return true;
  if (row.is_system === true) return true;
  if (userId && row.creator_id === userId) return true;
  const level = normalizeAccessLevel(row.access_level);
  if (level === "all") return true;
  if (level === "admin_only") return false;
  if (level === "specific") {
    if (!userId) return false;
    return normalizeUuidArray(row.assigned_user_ids).includes(userId);
  }
  return false;
}

/**
 * System notebooks are never deletable.
 * Non-admins cannot delete notebooks created by an admin (or legacy notebooks with unknown creator).
 */
export function canDeleteNotebook(
  row: Pick<NotebookRow, "creator_id" | "is_system">,
  opts: { userId: string | null; isAdmin: boolean; creatorIsAdmin: boolean }
): boolean {
  if (row.is_system === true) return false;
  if (opts.isAdmin) return true;
  if (!opts.userId) return false;
  if (opts.creatorIsAdmin) return false;
  if (!row.creator_id) return false;
  return row.creator_id === opts.userId;
}

export function canEditNotebook(
  row: Pick<NotebookRow, "creator_id" | "is_system">,
  opts: { userId: string | null; isAdmin: boolean }
): boolean {
  if (row.is_system === true) return false;
  if (opts.isAdmin) return true;
  if (!opts.userId) return false;
  return row.creator_id === opts.userId;
}

export function mapNotebook(
  row: NotebookRow,
  opts?: { userId?: string | null; isAdmin?: boolean; creatorIsAdmin?: boolean }
): Omit<NotebookWithNotes, "notes"> {
  const userId = opts?.userId ?? null;
  const isAdmin = opts?.isAdmin ?? false;
  const creatorIsAdmin = opts?.creatorIsAdmin ?? false;
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    creatorId: typeof row.creator_id === "string" ? row.creator_id : null,
    accessLevel: normalizeAccessLevel(row.access_level),
    assignedUserIds: normalizeUuidArray(row.assigned_user_ids),
    isSystem: row.is_system === true,
    canDelete: canDeleteNotebook(row, { userId, isAdmin, creatorIsAdmin }),
    canEdit: canEditNotebook(row, { userId, isAdmin }),
  };
}

export function mapNoteSummary(row: NoteRow): NoteSummary {
  return {
    id: row.id,
    notebookId: row.notebook_id,
    title: row.title,
    visibility: normalizeVisibility(row.visibility),
    moodboardId: typeof row.moodboard_id === "string" ? row.moodboard_id : null,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

export function mapNote(row: NoteRow) {
  return {
    id: row.id,
    notebookId: row.notebook_id,
    title: row.title,
    content: row.content ?? "",
    visibility: normalizeVisibility(row.visibility),
    moodboardId: typeof row.moodboard_id === "string" ? row.moodboard_id : null,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

export function escapeNoteHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function plainTextToNoteHtml(text: string): string {
  const safe = escapeNoteHtml(text.trim()).replace(/\n/g, "<br>");
  return safe ? `<p>${safe}</p>` : "<p></p>";
}

/** Ensure the permanent Studio Chats notebook exists; returns its id. */
export async function ensureStudioChatsNotebook(
  sb: SupabaseClient
): Promise<{ id: string; name: string } | { error: string }> {
  const { data: existing, error: existingError } = await sb
    .from("notebooks")
    .select(NOTEBOOK_SELECT_COLUMNS)
    .eq("is_system", true)
    .maybeSingle();

  if (existingError) {
    return { error: existingError.message };
  }
  if (existing) {
    const row = existing as NotebookRow;
    if (row.name !== STUDIO_CHATS_NAME) {
      await sb
        .from("notebooks")
        .update({ name: STUDIO_CHATS_NAME, updated_at: new Date().toISOString() })
        .eq("id", row.id);
    }
    return { id: row.id, name: STUDIO_CHATS_NAME };
  }

  const now = new Date().toISOString();
  const { data: created, error: createError } = await sb
    .from("notebooks")
    .insert({
      name: STUDIO_CHATS_NAME,
      access_level: "all",
      assigned_user_ids: [],
      is_system: true,
      created_at: now,
      updated_at: now,
    })
    .select(NOTEBOOK_SELECT_COLUMNS)
    .single();

  if (createError || !created) {
    return { error: createError?.message ?? "Failed to create Studio Chats notebook." };
  }
  return { id: (created as NotebookRow).id, name: STUDIO_CHATS_NAME };
}

/** Create a chat note inside Studio Chats for sticky-message threading. */
export async function createStudioChatNote(
  sb: SupabaseClient,
  opts: { title: string; contentPlain: string; visibility?: NoteVisibility }
): Promise<{ id: string } | { error: string }> {
  const studio = await ensureStudioChatsNotebook(sb);
  if ("error" in studio) return studio;

  const now = new Date().toISOString();
  const title = opts.title.trim() || "Chat";
  const { data, error } = await sb
    .from("notes")
    .insert({
      notebook_id: studio.id,
      title: title.slice(0, 120),
      content: plainTextToNoteHtml(opts.contentPlain),
      visibility: opts.visibility ?? "user",
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { error: error?.message ?? "Failed to create Studio Chats note." };
  }
  return { id: (data as { id: string }).id };
}

export async function resolveCreatorAdminFlags(
  sb: SupabaseClient,
  creatorIds: Array<string | null | undefined>
): Promise<Map<string, boolean>> {
  const unique = [...new Set(creatorIds.filter((id): id is string => typeof id === "string" && id.length > 0))];
  const map = new Map<string, boolean>();
  if (unique.length === 0) return map;

  const { data, error } = await sb.from("profiles").select("id, role").in("id", unique);
  if (error || !data) return map;
  for (const row of data as Array<{ id: string; role?: string | null }>) {
    map.set(row.id, row.role === "admin");
  }
  return map;
}
