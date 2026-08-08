"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  ExternalLink,
  FileDown,
  Link2,
  Loader2,
  Plus,
  Save,
  StickyNote,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  formatCrmNoteAnchor,
  parseFountainToHtml,
  SCREENPLAY_PREVIEW_CSS,
} from "@/lib/fountainScreenplay";
import { exportScreenplayPdf } from "@/lib/exportScreenplayPdf";
import { SCRIPT_STATUSES, type ScriptStatus } from "@/lib/scriptStatuses";
import type { NotebookWithNotes } from "@/lib/server/notesSupabase";

const RichTextEditor = dynamic(() => import("@/app/components/RichTextEditor"), {
  ssr: false,
  loading: () => (
    <div className="flex h-40 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 text-xs text-zinc-500">
      Loading editor…
    </div>
  ),
});

type ScriptDetail = {
  id: string;
  title: string;
  content: string;
  status: ScriptStatus;
  projectId: string | null;
  projectName: string | null;
  shootId: string | null;
  shootName: string | null;
  moodboardId: string | null;
  moodboardName: string | null;
  updatedAt: string;
};

type AssetOption = { id: string; label: string };

type FullNote = {
  id: string;
  notebookId: string;
  title: string;
  content: string;
};

function toErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

function insertAtCursor(
  textarea: HTMLTextAreaElement | null,
  current: string,
  insertion: string
): { next: string; caret: number } {
  if (!textarea) {
    const next = `${current}${current.endsWith("\n") || !current ? "" : "\n"}${insertion}\n`;
    return { next, caret: next.length };
  }
  const start = textarea.selectionStart ?? current.length;
  const end = textarea.selectionEnd ?? start;
  const before = current.slice(0, start);
  const after = current.slice(end);
  const padBefore = before && !before.endsWith("\n") && !before.endsWith(" ") ? " " : "";
  const padAfter = after && !after.startsWith("\n") && !after.startsWith(" ") ? " " : "";
  const next = `${before}${padBefore}${insertion}${padAfter}${after}`;
  const caret = (before + padBefore + insertion).length;
  return { next, caret };
}

export default function ScriptEditorPage() {
  const params = useParams();
  const router = useRouter();
  const scriptId = typeof params?.id === "string" ? params.id : "";

  const [script, setScript] = useState<ScriptDetail | null>(null);
  const [shoots, setShoots] = useState<AssetOption[]>([]);
  const [plannerTasks, setPlannerTasks] = useState<AssetOption[]>([]);
  const [moodboards, setMoodboards] = useState<AssetOption[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<ScriptStatus>("Idea");
  const [projectId, setProjectId] = useState("");
  const [shootId, setShootId] = useState("");
  const [moodboardId, setMoodboardId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [assetsOpen, setAssetsOpen] = useState(true);

  const [notePickerOpen, setNotePickerOpen] = useState(false);
  const [notebooks, setNotebooks] = useState<NotebookWithNotes[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [creatingNote, setCreatingNote] = useState(false);
  const [newNoteTitle, setNewNoteTitle] = useState("");
  const [newNoteNotebookId, setNewNoteNotebookId] = useState("");

  const [viewNoteOpen, setViewNoteOpen] = useState(false);
  const [viewNoteLoading, setViewNoteLoading] = useState(false);
  const [viewNoteSaving, setViewNoteSaving] = useState(false);
  const [viewNote, setViewNote] = useState<FullNote | null>(null);
  const [viewNoteTitle, setViewNoteTitle] = useState("");
  const [viewNoteContent, setViewNoteContent] = useState("");

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydratedRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    if (!scriptId) return;
    setLoading(true);
    setError(null);
    try {
      const [scriptRes, assetsRes] = await Promise.all([
        fetch(`/api/scripts/${scriptId}`, { cache: "no-store", credentials: "include" }),
        fetch("/api/scripts/projects", { cache: "no-store", credentials: "include" }),
      ]);

      const scriptJson = (await scriptRes.json().catch(() => null)) as
        | { script?: ScriptDetail; error?: string }
        | null;
      if (!scriptRes.ok || !scriptJson?.script) {
        throw new Error(scriptJson?.error ?? `Failed to load script (${scriptRes.status})`);
      }

      const assetsJson = (await assetsRes.json().catch(() => null)) as {
        shoots?: AssetOption[];
        plannerTasks?: AssetOption[];
        moodboards?: AssetOption[];
        error?: string;
      } | null;
      if (assetsRes.ok) {
        setShoots(assetsJson?.shoots ?? []);
        setPlannerTasks(assetsJson?.plannerTasks ?? []);
        setMoodboards(assetsJson?.moodboards ?? []);
      }

      const s = scriptJson.script;
      setScript(s);
      setTitle(s.title);
      setContent(s.content);
      setStatus(s.status);
      setProjectId(s.projectId ?? "");
      setShootId(s.shootId ?? "");
      setMoodboardId(s.moodboardId ?? "");
      hydratedRef.current = true;
    } catch (e) {
      setError(toErrorMessage(e, "Failed to load script."));
      setScript(null);
    } finally {
      setLoading(false);
    }
  }, [scriptId]);

  useEffect(() => {
    void load();
  }, [load]);

  const persist = useCallback(
    async (payload: {
      title?: string;
      content?: string;
      status?: ScriptStatus;
      projectId?: string | null;
      shootId?: string | null;
      moodboardId?: string | null;
    }) => {
      if (!scriptId) return;
      setSaving(true);
      setSaveMessage(null);
      setError(null);
      try {
        const res = await fetch(`/api/scripts/${scriptId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        });
        const json = (await res.json().catch(() => null)) as
          | { script?: ScriptDetail; error?: string }
          | null;
        if (!res.ok || !json?.script) {
          throw new Error(json?.error ?? "Failed to save script.");
        }
        setScript(json.script);
        setSaveMessage("Saved");
      } catch (e) {
        setError(toErrorMessage(e, "Failed to save script."));
      } finally {
        setSaving(false);
      }
    },
    [scriptId]
  );

  useEffect(() => {
    if (!hydratedRef.current || !script) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const dirty =
        title !== script.title ||
        content !== script.content ||
        status !== script.status ||
        (projectId || null) !== (script.projectId || null) ||
        (shootId || null) !== (script.shootId || null) ||
        (moodboardId || null) !== (script.moodboardId || null);
      if (!dirty) return;
      void persist({
        title,
        content,
        status,
        projectId: projectId || null,
        shootId: shootId || null,
        moodboardId: moodboardId || null,
      });
    }, 900);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [title, content, status, projectId, shootId, moodboardId, script, persist]);

  const preview = useMemo(() => parseFountainToHtml(content), [content]);

  const openNotePicker = async () => {
    setNotePickerOpen(true);
    setNotesLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/notes/notebooks", { cache: "no-store", credentials: "include" });
      const json = (await res.json().catch(() => null)) as
        | { notebooks?: NotebookWithNotes[]; error?: string }
        | null;
      if (!res.ok) throw new Error(json?.error ?? "Failed to load notes.");
      const list = json?.notebooks ?? [];
      setNotebooks(list);
      if (!newNoteNotebookId && list[0]?.id) {
        setNewNoteNotebookId(list[0].id);
      }
    } catch (e) {
      setError(toErrorMessage(e, "Failed to load notes."));
    } finally {
      setNotesLoading(false);
    }
  };

  const injectNoteAnchor = (noteId: string) => {
    const anchor = formatCrmNoteAnchor(noteId);
    const { next, caret } = insertAtCursor(textareaRef.current, content, anchor);
    setContent(next);
    setNotePickerOpen(false);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };

  const handleCreateAndInsertNote = async () => {
    if (!newNoteNotebookId) {
      setError("Create a notebook in Notes first, then insert a CRM note.");
      return;
    }
    setCreatingNote(true);
    setError(null);
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          notebookId: newNoteNotebookId,
          title: newNoteTitle.trim() || "Script note",
          content: "",
          visibility: "user",
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | { note?: { id: string }; error?: string }
        | null;
      if (!res.ok || !json?.note?.id) {
        throw new Error(json?.error ?? "Failed to create note.");
      }
      injectNoteAnchor(json.note.id);
      setNewNoteTitle("");
    } catch (e) {
      setError(toErrorMessage(e, "Failed to create note."));
    } finally {
      setCreatingNote(false);
    }
  };

  const openCrmNote = useCallback(async (noteId: string) => {
    setViewNoteOpen(true);
    setViewNoteLoading(true);
    setViewNote(null);
    setError(null);
    try {
      const res = await fetch(`/api/notes/${noteId}`, {
        cache: "no-store",
        credentials: "include",
      });
      const json = (await res.json().catch(() => null)) as
        | { note?: FullNote; error?: string }
        | null;
      if (!res.ok || !json?.note) {
        throw new Error(json?.error ?? "Failed to load note.");
      }
      setViewNote(json.note);
      setViewNoteTitle(json.note.title);
      setViewNoteContent(json.note.content);
    } catch (e) {
      setError(toErrorMessage(e, "Failed to open CRM note."));
      setViewNoteOpen(false);
    } finally {
      setViewNoteLoading(false);
    }
  }, []);

  useEffect(() => {
    const root = previewRef.current;
    if (!root) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const chip = target?.closest?.(".crm-note-chip") as HTMLElement | null;
      if (!chip) return;
      event.preventDefault();
      const noteId = chip.getAttribute("data-note-id");
      if (noteId) void openCrmNote(noteId);
    };
    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, [openCrmNote, preview.script, preview.titlePage]);

  const saveViewNote = async () => {
    if (!viewNote) return;
    setViewNoteSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/notes/${viewNote.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title: viewNoteTitle.trim() || "Untitled",
          content: viewNoteContent,
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | { note?: FullNote; error?: string }
        | null;
      if (!res.ok || !json?.note) {
        throw new Error(json?.error ?? "Failed to save note.");
      }
      setViewNote(json.note);
      setSaveMessage("Note saved");
    } catch (e) {
      setError(toErrorMessage(e, "Failed to save note."));
    } finally {
      setViewNoteSaving(false);
    }
  };

  const handleManualSave = () => {
    void persist({
      title,
      content,
      status,
      projectId: projectId || null,
      shootId: shootId || null,
      moodboardId: moodboardId || null,
    });
  };

  const handleExportPdf = () => {
    setExporting(true);
    try {
      exportScreenplayPdf(content, `${title || "screenplay"}.pdf`);
    } catch (e) {
      setError(toErrorMessage(e, "PDF export failed."));
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <main className="flex min-h-[calc(100dvh-64px)] items-center justify-center bg-zinc-950 text-sm text-zinc-400">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
        Opening script…
      </main>
    );
  }

  if (!script) {
    return (
      <main className="min-h-[calc(100dvh-64px)] bg-zinc-950 px-4 py-10">
        <div className="mx-auto max-w-lg rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 text-center">
          <p className="text-sm text-red-300">{error ?? "Script not found."}</p>
          <button
            type="button"
            onClick={() => router.push("/scripts")}
            className="mt-4 inline-flex h-10 items-center rounded-lg border border-zinc-700 px-4 text-sm font-semibold text-zinc-100 hover:bg-zinc-800"
          >
            Back to Scripts
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-[calc(100dvh-64px)] flex-col bg-zinc-950">
      <header className="border-b border-zinc-800 bg-zinc-950/90 px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-3">
          <Link
            href="/scripts"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-700 px-3 text-xs font-semibold text-zinc-200 hover:bg-zinc-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Scripts
          </Link>

          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="min-w-[200px] flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-semibold text-white outline-none focus:border-violet-500"
            placeholder="Script title"
          />

          <label className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-zinc-500">
            Status
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as ScriptStatus)}
              className="h-9 rounded-lg border border-zinc-700 bg-zinc-900 px-2 text-xs font-semibold normal-case tracking-normal text-zinc-100 outline-none focus:border-violet-500"
            >
              {SCRIPT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() => setAssetsOpen((v) => !v)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-xs font-semibold text-zinc-100 hover:bg-zinc-800"
          >
            <Link2 className="h-3.5 w-3.5" aria-hidden />
            Linked Assets
          </button>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span className="text-xs text-zinc-500">
              {saving ? "Saving…" : saveMessage ?? ""}
            </span>
            <button
              type="button"
              onClick={handleManualSave}
              disabled={saving}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-xs font-semibold text-zinc-100 hover:bg-zinc-800 disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Save className="h-3.5 w-3.5" aria-hidden />
              )}
              Save
            </button>
            <button
              type="button"
              onClick={handleExportPdf}
              disabled={exporting}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-violet-600 px-3 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
            >
              {exporting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <FileDown className="h-3.5 w-3.5" aria-hidden />
              )}
              Export to PDF
            </button>
          </div>
        </div>

        {assetsOpen ? (
          <div className="mx-auto mt-3 grid max-w-[1800px] gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 sm:grid-cols-3">
            <label className="block text-[11px] uppercase tracking-wide text-zinc-500">
              Workflow shoot
              <select
                value={shootId}
                onChange={(e) => setShootId(e.target.value)}
                className="mt-1 h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 text-xs font-semibold normal-case tracking-normal text-zinc-100 outline-none focus:border-violet-500"
              >
                <option value="">Unlinked</option>
                {shoots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-[11px] uppercase tracking-wide text-zinc-500">
              Planner task
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="mt-1 h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 text-xs font-semibold normal-case tracking-normal text-zinc-100 outline-none focus:border-violet-500"
              >
                <option value="">Unlinked</option>
                {plannerTasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>

            <div>
              <label className="block text-[11px] uppercase tracking-wide text-zinc-500">
                Moodboard
                <select
                  value={moodboardId}
                  onChange={(e) => setMoodboardId(e.target.value)}
                  className="mt-1 h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 text-xs font-semibold normal-case tracking-normal text-zinc-100 outline-none focus:border-violet-500"
                >
                  <option value="">Unlinked</option>
                  {moodboards.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              {moodboardId ? (
                <Link
                  href={`/moodboard?boardId=${encodeURIComponent(moodboardId)}`}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-violet-300 hover:text-violet-200"
                >
                  Open moodboard
                  <ExternalLink className="h-3 w-3" aria-hidden />
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}

        {error ? (
          <p className="mx-auto mt-2 max-w-[1800px] text-xs text-red-300">{error}</p>
        ) : null}
      </header>

      <div className="mx-auto grid w-full max-w-[1800px] flex-1 grid-cols-1 gap-0 lg:grid-cols-2">
        <section className="flex min-h-[50vh] flex-col border-b border-zinc-800 lg:min-h-0 lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between gap-2 border-b border-zinc-800 px-4 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              Fountain editor
            </span>
            <button
              type="button"
              onClick={() => void openNotePicker()}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-violet-700/60 bg-violet-950/40 px-2.5 text-[11px] font-semibold text-violet-100 hover:bg-violet-900/50"
            >
              <StickyNote className="h-3.5 w-3.5" aria-hidden />
              Insert CRM Note
            </button>
          </div>
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
            className="min-h-[50vh] flex-1 resize-none bg-zinc-950 px-4 py-4 font-mono text-[13px] leading-relaxed text-zinc-100 outline-none placeholder:text-zinc-600 lg:min-h-0"
            placeholder="Write Fountain screenplay markup…"
          />
        </section>

        <section className="flex min-h-[50vh] flex-col bg-zinc-900/40 lg:min-h-0">
          <div className="border-b border-zinc-800 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Screenplay preview
          </div>
          <div ref={previewRef} className="flex-1 overflow-auto px-4 py-6 sm:px-8">
            <style dangerouslySetInnerHTML={{ __html: SCREENPLAY_PREVIEW_CSS }} />
            <div className="screenplay-page mx-auto">
              {preview.titlePage ? (
                <div
                  className="title-page"
                  dangerouslySetInnerHTML={{ __html: preview.titlePage }}
                />
              ) : null}
              <div dangerouslySetInnerHTML={{ __html: preview.script }} />
            </div>
          </div>
        </section>
      </div>

      {notePickerOpen ? (
        <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
          <div className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl">
            <div className="border-b border-zinc-800 px-5 py-4">
              <h3 className="text-lg font-semibold text-white">Insert CRM Note</h3>
              <p className="mt-1 text-sm text-zinc-400">
                Choose an existing note or create one. Inserts{" "}
                <code className="text-violet-300">[[note: UUID]]</code> at the cursor.
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {notesLoading ? (
                <div className="flex items-center gap-2 py-8 text-sm text-zinc-400">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Loading notes…
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                      Create new note
                    </p>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <select
                        value={newNoteNotebookId}
                        onChange={(e) => setNewNoteNotebookId(e.target.value)}
                        className="h-9 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-100"
                      >
                        {notebooks.length === 0 ? (
                          <option value="">No notebooks</option>
                        ) : (
                          notebooks.map((nb) => (
                            <option key={nb.id} value={nb.id}>
                              {nb.name}
                            </option>
                          ))
                        )}
                      </select>
                      <input
                        value={newNoteTitle}
                        onChange={(e) => setNewNoteTitle(e.target.value)}
                        placeholder="Note title"
                        className="h-9 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-xs text-zinc-100"
                      />
                      <button
                        type="button"
                        disabled={creatingNote || !newNoteNotebookId}
                        onClick={() => void handleCreateAndInsertNote()}
                        className="inline-flex h-9 items-center justify-center gap-1 rounded-lg bg-violet-600 px-3 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
                      >
                        {creatingNote ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        ) : (
                          <Plus className="h-3.5 w-3.5" aria-hidden />
                        )}
                        Create & insert
                      </button>
                    </div>
                  </div>

                  {notebooks.map((nb) => (
                    <div key={nb.id}>
                      <p className="mb-1 text-xs font-semibold text-zinc-400">{nb.name}</p>
                      {nb.notes.length === 0 ? (
                        <p className="text-xs italic text-zinc-600">No notes</p>
                      ) : (
                        <ul className="space-y-1">
                          {nb.notes.map((note) => (
                            <li key={note.id}>
                              <button
                                type="button"
                                onClick={() => injectNoteAnchor(note.id)}
                                className="flex w-full items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-left text-sm text-zinc-100 hover:border-violet-700 hover:bg-violet-950/30"
                              >
                                <span className="truncate">{note.title}</span>
                                <span className="ml-2 shrink-0 text-[10px] uppercase text-zinc-500">
                                  Insert
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex justify-end border-t border-zinc-800 px-5 py-3">
              <button
                type="button"
                onClick={() => setNotePickerOpen(false)}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-800"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {viewNoteOpen ? (
        <div className="fixed inset-0 z-[170] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-5 py-4">
              <h3 className="text-lg font-semibold text-white">CRM Note</h3>
              <div className="flex gap-2">
                {viewNote ? (
                  <Link
                    href={`/notes?noteId=${encodeURIComponent(viewNote.id)}`}
                    className="inline-flex h-8 items-center gap-1 rounded-lg border border-zinc-700 px-2.5 text-[11px] font-semibold text-zinc-200 hover:bg-zinc-800"
                  >
                    Open in Notes
                    <ExternalLink className="h-3 w-3" aria-hidden />
                  </Link>
                ) : null}
                <button
                  type="button"
                  onClick={() => setViewNoteOpen(false)}
                  className="rounded-lg border border-zinc-700 px-3 text-xs font-semibold text-zinc-200 hover:bg-zinc-800"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {viewNoteLoading || !viewNote ? (
                <div className="flex items-center gap-2 py-10 text-sm text-zinc-400">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Loading note…
                </div>
              ) : (
                <>
                  <input
                    value={viewNoteTitle}
                    onChange={(e) => setViewNoteTitle(e.target.value)}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-semibold text-white outline-none focus:border-violet-500"
                  />
                  <RichTextEditor
                    content={viewNoteContent}
                    onChange={setViewNoteContent}
                    className="min-h-[240px]"
                  />
                </>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-zinc-800 px-5 py-3">
              <button
                type="button"
                disabled={viewNoteSaving || !viewNote}
                onClick={() => void saveViewNote()}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-violet-600 px-4 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
              >
                {viewNoteSaving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Save className="h-3.5 w-3.5" aria-hidden />
                )}
                Save note
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
