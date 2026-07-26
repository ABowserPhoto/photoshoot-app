import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { fetchWithTimeout } from "@/lib/server/fetchWithTimeout";

const FETCH_TIMEOUT_MS = Number(process.env.TASKS_FETCH_TIMEOUT_MS ?? "8000");

export const NOTE_VISIBILITIES = ["public", "user", "admin_only"] as const;
export type NoteVisibility = (typeof NOTE_VISIBILITIES)[number];

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

export type NotebookRow = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
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

export function mapNotebook(row: NotebookRow): Omit<NotebookWithNotes, "notes"> {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
