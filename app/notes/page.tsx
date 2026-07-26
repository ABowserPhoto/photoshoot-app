"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import {
  ArrowLeft,
  Book,
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  Plus,
  Shield,
  Trash2,
} from "lucide-react";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { getAllMoodboards, type MoodboardSummary } from "@/app/actions/moodboard";
import { useAuthRole } from "@/app/contexts/AuthRoleContext";
import type {
  NotebookWithNotes,
  NoteSummary,
  NoteVisibility,
} from "@/lib/server/notesSupabase";

const RichTextEditor = dynamic(() => import("@/app/components/RichTextEditor"), {
  ssr: false,
  loading: () => (
    <div className="flex flex-1 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950/60 text-sm text-zinc-500">
      Loading editor…
    </div>
  ),
});

type FullNote = {
  id: string;
  notebookId: string;
  title: string;
  content: string;
  visibility: NoteVisibility;
  moodboardId: string | null;
  updatedAt: string;
  createdAt: string;
};

function toErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

function NotesPageContent() {
  const searchParams = useSearchParams();
  const noteIdParam = searchParams.get("noteId");
  const { isAdmin } = useAuthRole();

  const [notebooks, setNotebooks] = useState<NotebookWithNotes[]>([]);
  const [moodboards, setMoodboards] = useState<MoodboardSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [activeNote, setActiveNote] = useState<FullNote | null>(null);
  const [noteLoading, setNoteLoading] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [contentDraft, setContentDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isCreateNotebookModalOpen, setIsCreateNotebookModalOpen] = useState(false);
  const [newNotebookName, setNewNotebookName] = useState("");
  const [creatingNotebook, setCreatingNotebook] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeNoteIdRef = useRef<string | null>(null);
  const openedNoteParamRef = useRef<string | null>(null);

  const loadNotebooks = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/api/notes/notebooks");
      const payload = (await response.json().catch(() => null)) as
        | { notebooks?: NotebookWithNotes[]; error?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error || `Failed to load notebooks (${response.status}).`);
      }
      const list = payload?.notebooks ?? [];
      setNotebooks(list);
      setExpanded((prev) => {
        const next = { ...prev };
        for (const nb of list) {
          if (next[nb.id] === undefined) next[nb.id] = true;
        }
        return next;
      });
      return list;
    } catch (err) {
      setError(toErrorMessage(err, "Failed to load notebooks."));
      return [] as NotebookWithNotes[];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadNotebooks();
    void getAllMoodboards().then((res) => {
      if (res.ok) setMoodboards(res.moodboards);
    });
  }, [loadNotebooks]);

  const selectNote = useCallback(async (noteId: string) => {
    setSelectedNoteId(noteId);
    activeNoteIdRef.current = noteId;
    setNoteLoading(true);
    setSaveError(null);
    try {
      const response = await fetch(`/api/notes/${noteId}`);
      const payload = (await response.json().catch(() => null)) as
        | { note?: FullNote; error?: string }
        | null;
      if (!response.ok || !payload?.note) {
        throw new Error(payload?.error || `Failed to load note (${response.status}).`);
      }
      if (activeNoteIdRef.current !== noteId) return;
      setActiveNote(payload.note);
      setTitleDraft(payload.note.title);
      setContentDraft(payload.note.content || "");
      setExpanded((prev) => ({ ...prev, [payload.note!.notebookId]: true }));
    } catch (err) {
      if (activeNoteIdRef.current === noteId) {
        setSaveError(toErrorMessage(err, "Failed to load note."));
        setActiveNote(null);
      }
    } finally {
      if (activeNoteIdRef.current === noteId) {
        setNoteLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const id = noteIdParam?.trim();
    if (!id || loading) return;
    if (openedNoteParamRef.current === id) return;
    openedNoteParamRef.current = id;
    void selectNote(id);
  }, [noteIdParam, loading, selectNote]);

  const persistNote = useCallback(
    async (
      noteId: string,
      patch: {
        title?: string;
        content?: string;
        visibility?: NoteVisibility;
        moodboardId?: string | null;
      }
    ) => {
      setSaving(true);
      setSaveError(null);
      try {
        const response = await fetch(`/api/notes/${noteId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const payload = (await response.json().catch(() => null)) as
          | { note?: FullNote; error?: string }
          | null;
        if (!response.ok || !payload?.note) {
          throw new Error(payload?.error || `Save failed (${response.status}).`);
        }
        if (activeNoteIdRef.current === noteId) {
          setActiveNote(payload.note);
          setTitleDraft(payload.note.title);
        }
        setNotebooks((prev) =>
          prev.map((nb) => {
            if (nb.id !== payload.note!.notebookId) {
              return {
                ...nb,
                notes: nb.notes.filter((n) => n.id !== noteId),
              };
            }
            const summary: NoteSummary = {
              id: payload.note!.id,
              notebookId: payload.note!.notebookId,
              title: payload.note!.title,
              visibility: payload.note!.visibility,
              moodboardId: payload.note!.moodboardId,
              updatedAt: payload.note!.updatedAt,
              createdAt: payload.note!.createdAt,
            };
            const notes = [
              summary,
              ...nb.notes.filter((n) => n.id !== noteId),
            ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
            return { ...nb, notes, updatedAt: payload.note!.updatedAt };
          })
        );
      } catch (err) {
        setSaveError(toErrorMessage(err, "Failed to save note."));
      } finally {
        setSaving(false);
      }
    },
    []
  );

  const scheduleSave = useCallback(
    (noteId: string, title: string, content: string) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        void persistNote(noteId, { title, content });
      }, 600);
    },
    [persistNote]
  );

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const closeCreateNotebookModal = useCallback(() => {
    setIsCreateNotebookModalOpen(false);
    setNewNotebookName("");
  }, []);

  const createNotebook = useCallback(async () => {
    const name = newNotebookName.trim();
    if (!name || creatingNotebook) return;
    setCreatingNotebook(true);
    try {
      const response = await fetch("/api/notes/notebooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { notebook?: NotebookWithNotes; error?: string }
        | null;
      if (!response.ok || !payload?.notebook) {
        throw new Error(payload?.error || "Failed to create notebook.");
      }
      setNotebooks((prev) => [payload.notebook!, ...prev]);
      setExpanded((prev) => ({ ...prev, [payload.notebook!.id]: true }));
      closeCreateNotebookModal();
    } catch (err) {
      setError(toErrorMessage(err, "Failed to create notebook."));
    } finally {
      setCreatingNotebook(false);
    }
  }, [closeCreateNotebookModal, creatingNotebook, newNotebookName]);

  const createNote = useCallback(
    async (notebookId: string) => {
      try {
        const response = await fetch("/api/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notebookId, title: "Untitled", visibility: "user" }),
        });
        const payload = (await response.json().catch(() => null)) as
          | { note?: FullNote; error?: string }
          | null;
        if (!response.ok || !payload?.note) {
          throw new Error(payload?.error || "Failed to create note.");
        }
        const note = payload.note;
        const summary: NoteSummary = {
          id: note.id,
          notebookId: note.notebookId,
          title: note.title,
          visibility: note.visibility,
          moodboardId: note.moodboardId,
          updatedAt: note.updatedAt,
          createdAt: note.createdAt,
        };
        setNotebooks((prev) =>
          prev.map((nb) =>
            nb.id === notebookId
              ? { ...nb, notes: [summary, ...nb.notes], updatedAt: note.updatedAt }
              : nb
          )
        );
        setExpanded((prev) => ({ ...prev, [notebookId]: true }));
        await selectNote(note.id);
      } catch (err) {
        setError(toErrorMessage(err, "Failed to create note."));
      }
    },
    [selectNote]
  );

  const deleteNote = useCallback(
    async (noteId: string) => {
      if (!window.confirm("Delete this note?")) return;
      try {
        const response = await fetch(`/api/notes/${noteId}`, { method: "DELETE" });
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to delete note.");
        }
        setNotebooks((prev) =>
          prev.map((nb) => ({
            ...nb,
            notes: nb.notes.filter((n) => n.id !== noteId),
          }))
        );
        if (selectedNoteId === noteId) {
          setSelectedNoteId(null);
          setActiveNote(null);
          setTitleDraft("");
          setContentDraft("");
        }
      } catch (err) {
        setError(toErrorMessage(err, "Failed to delete note."));
      }
    },
    [selectedNoteId]
  );

  const deleteNotebook = useCallback(
    async (notebookId: string) => {
      if (!window.confirm("Delete this notebook and all of its notes?")) return;
      try {
        const response = await fetch(`/api/notes/notebooks/${notebookId}`, {
          method: "DELETE",
        });
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to delete notebook.");
        }
        const removed = notebooks.find((nb) => nb.id === notebookId);
        setNotebooks((prev) => prev.filter((nb) => nb.id !== notebookId));
        if (removed?.notes.some((n) => n.id === selectedNoteId)) {
          setSelectedNoteId(null);
          setActiveNote(null);
          setTitleDraft("");
          setContentDraft("");
        }
      } catch (err) {
        setError(toErrorMessage(err, "Failed to delete notebook."));
      }
    },
    [notebooks, selectedNoteId]
  );

  const selectedNotebookName = useMemo(() => {
    if (!activeNote) return null;
    return notebooks.find((nb) => nb.id === activeNote.notebookId)?.name ?? null;
  }, [activeNote, notebooks]);

  const visibilityOptions = useMemo(() => {
    const base: Array<{ value: NoteVisibility; label: string }> = [
      { value: "public", label: "Public" },
      { value: "user", label: "Users" },
    ];
    if (isAdmin) {
      base.push({ value: "admin_only", label: "Admin only" });
    }
    return base;
  }, [isAdmin]);

  return (
    <main className="mx-auto flex h-[calc(100vh-10rem)] w-full max-w-[1800px] min-h-[480px] gap-0 px-3 py-3 sm:px-4">
      <aside className="flex w-72 shrink-0 flex-col border border-zinc-800 bg-zinc-950/80 sm:w-80">
        <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <Book className="h-4 w-4 text-amber-400" />
            Notes
          </div>
          <button
            type="button"
            onClick={() => {
              setNewNotebookName("New Notebook");
              setIsCreateNotebookModalOpen(true);
            }}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs font-medium text-zinc-100 hover:bg-zinc-800"
          >
            <Plus className="h-3.5 w-3.5" />
            Notebook
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {loading ? (
            <div className="flex items-center gap-2 px-2 py-6 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : notebooks.length === 0 ? (
            <div className="px-2 py-6 text-sm text-zinc-500">
              No notebooks yet. Create one to start writing.
            </div>
          ) : (
            <ul className="space-y-1">
              {notebooks.map((nb) => {
                const open = expanded[nb.id] !== false;
                return (
                  <li key={nb.id}>
                    <div className="group flex items-center gap-1 rounded-md px-1 py-1 hover:bg-zinc-900">
                      <button
                        type="button"
                        aria-label={open ? "Collapse notebook" : "Expand notebook"}
                        onClick={() =>
                          setExpanded((prev) => ({ ...prev, [nb.id]: !open }))
                        }
                        className="inline-flex h-7 w-7 items-center justify-center text-zinc-400"
                      >
                        {open ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setExpanded((prev) => ({ ...prev, [nb.id]: !open }))
                        }
                        className="min-w-0 flex-1 truncate text-left text-sm font-medium text-zinc-100"
                      >
                        {nb.name}
                      </button>
                      <button
                        type="button"
                        title="New note"
                        onClick={() => void createNote(nb.id)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded text-zinc-400 opacity-0 hover:bg-zinc-800 hover:text-zinc-100 group-hover:opacity-100"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Delete notebook"
                        onClick={() => void deleteNotebook(nb.id)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded text-zinc-500 opacity-0 hover:bg-red-950/50 hover:text-red-300 group-hover:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {open ? (
                      <ul className="mb-1 ml-4 space-y-0.5 border-l border-zinc-800 pl-2">
                        {nb.notes.length === 0 ? (
                          <li className="px-2 py-1 text-xs text-zinc-600">No notes</li>
                        ) : (
                          nb.notes.map((note) => {
                            const selected = note.id === selectedNoteId;
                            return (
                              <li key={note.id} className="group/note flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => void selectNote(note.id)}
                                  className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm ${
                                    selected
                                      ? "bg-amber-500/15 text-amber-100"
                                      : "text-zinc-300 hover:bg-zinc-900"
                                  }`}
                                >
                                  <FileText className="h-3.5 w-3.5 shrink-0 opacity-70" />
                                  <span className="truncate">{note.title || "Untitled"}</span>
                                  {note.visibility === "admin_only" ? (
                                    <Shield
                                      className="h-3 w-3 shrink-0 text-amber-400/80"
                                      aria-label="Admin only"
                                    />
                                  ) : null}
                                </button>
                                <button
                                  type="button"
                                  title="Delete note"
                                  onClick={() => void deleteNote(note.id)}
                                  className="inline-flex h-7 w-7 items-center justify-center rounded text-zinc-500 opacity-0 hover:bg-red-950/50 hover:text-red-300 group-hover/note:opacity-100"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </li>
                            );
                          })
                        )}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {error ? (
          <div className="border-t border-zinc-800 px-3 py-2 text-xs text-red-300">{error}</div>
        ) : null}
      </aside>

      <section className="flex min-w-0 flex-1 flex-col border border-l-0 border-zinc-800 bg-zinc-900/40">
        {!selectedNoteId ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <FileText className="h-10 w-10 text-zinc-600" />
            <p className="text-sm font-medium text-zinc-300">Select a note to edit</p>
            <p className="max-w-sm text-xs text-zinc-500">
              Create a notebook, add a note, then write with checklists, headings, and separators.
            </p>
          </div>
        ) : noteLoading || !activeNote ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading note…
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3 border-b border-zinc-800 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                  {selectedNotebookName ? (
                    <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                      {selectedNotebookName}
                    </p>
                  ) : null}
                  {activeNote.moodboardId ? (
                    <Link
                      href={`/moodboard?boardId=${encodeURIComponent(activeNote.moodboardId)}`}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-400 transition hover:text-zinc-200"
                    >
                      <ArrowLeft className="h-3 w-3" />
                      Back to Moodboard
                    </Link>
                  ) : null}
                </div>
                <input
                  type="text"
                  value={titleDraft}
                  onChange={(event) => {
                    const next = event.target.value;
                    setTitleDraft(next);
                    scheduleSave(activeNote.id, next, contentDraft);
                  }}
                  placeholder="Untitled"
                  className="w-full bg-transparent text-xl font-semibold text-zinc-50 outline-none placeholder:text-zinc-600"
                />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                    Access
                    <select
                      value={activeNote.visibility}
                      onChange={(event) => {
                        const visibility = event.target.value as NoteVisibility;
                        setActiveNote((prev) => (prev ? { ...prev, visibility } : prev));
                        void persistNote(activeNote.id, { visibility });
                      }}
                      className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-200 outline-none"
                    >
                      {visibilityOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex min-w-0 items-center gap-1.5 text-[11px] text-zinc-500">
                    Moodboard
                    <select
                      value={activeNote.moodboardId ?? ""}
                      onChange={(event) => {
                        const moodboardId = event.target.value.trim() || null;
                        setActiveNote((prev) => (prev ? { ...prev, moodboardId } : prev));
                        void persistNote(activeNote.id, { moodboardId });
                      }}
                      className="max-w-[180px] rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-200 outline-none"
                    >
                      <option value="">None</option>
                      {moodboards.map((board) => (
                        <option key={board.id} value={board.id}>
                          {board.title}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
              <div className="shrink-0 pt-1 text-[11px] text-zinc-500">
                {saving ? "Saving…" : saveError ? "Save failed" : "Saved"}
              </div>
            </div>
            {saveError ? (
              <div className="border-b border-red-900/50 bg-red-950/30 px-4 py-1.5 text-xs text-red-300">
                {saveError}
              </div>
            ) : null}
            <div className="flex min-h-0 flex-1 flex-col p-3">
              <RichTextEditor
                key={activeNote.id}
                content={contentDraft}
                onChange={(html) => {
                  setContentDraft(html);
                  scheduleSave(activeNote.id, titleDraft, html);
                }}
              />
            </div>
          </>
        )}
      </section>

      {isCreateNotebookModalOpen ? (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-black/65 p-4"
          onClick={closeCreateNotebookModal}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-notebook-title"
            className="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-950 p-4 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="create-notebook-title" className="text-sm font-semibold text-zinc-100">
              New notebook
            </h2>
            <label className="mt-3 block text-xs text-zinc-400">
              Name
              <input
                type="text"
                autoFocus
                value={newNotebookName}
                onChange={(event) => setNewNotebookName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void createNotebook();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    closeCreateNotebookModal();
                  }
                }}
                placeholder="New Notebook"
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none ring-zinc-500 focus:ring-2"
              />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeCreateNotebookModal}
                disabled={creatingNotebook}
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void createNotebook()}
                disabled={!newNotebookName.trim() || creatingNotebook}
                className="rounded-lg border border-amber-600/50 bg-amber-500/15 px-3 py-1.5 text-sm font-medium text-amber-100 hover:bg-amber-500/25 disabled:opacity-50"
              >
                {creatingNotebook ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

export default function NotesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-[calc(100vh-10rem)] items-center justify-center text-sm text-zinc-500">
          Loading notes…
        </div>
      }
    >
      <NotesPageContent />
    </Suspense>
  );
}
