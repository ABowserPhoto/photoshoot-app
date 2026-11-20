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
  Lock,
  Menu,
  Plus,
  Send,
  Settings2,
  Shield,
  Trash2,
  X,
} from "lucide-react";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { getAllMoodboards, type MoodboardSummary } from "@/app/actions/moodboard";
import NoteAccessControlFields from "@/app/components/NoteAccessControlFields";
import { useAuthRole } from "@/app/contexts/AuthRoleContext";
import {
  decideSaveConflict,
  forgetNotePlace,
  notesSearchWithNoteId,
  readNotesPlace,
  resolveOpenedNote,
  upsertNotePlace,
  writeNotesPlace,
} from "@/lib/notesPlace";
import { isSelectablePlannerStaffProfile } from "@/lib/plannerAssignees";
import type {
  NotebookAccessLevel,
  NotebookWithNotes,
  NoteRecord,
  NoteSummary,
} from "@/lib/server/notesSupabase";

type RecipientOption = {
  id: string;
  email: string | null;
  full_name: string | null;
  role?: string | null;
  is_archived?: boolean | null;
};

type NotebookFormState = {
  name: string;
  accessLevel: NotebookAccessLevel;
  assignedUserIds: string[];
};

const RichTextEditor = dynamic(() => import("@/app/components/RichTextEditor"), {
  ssr: false,
  loading: () => (
    <div className="flex flex-1 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950/60 text-sm text-zinc-500">
      Loading editor…
    </div>
  ),
});

/**
 * Sidebar row actions stay hover-reveal for a mouse on md+ screens.
 * Touch (`hover: none` / `pointer: coarse`) and the narrow layout always show them,
 * with a 36px target. Keyboard focus inside the row reveals them too.
 */
const ROW_ACTION_VISIBILITY =
  "opacity-0 max-md:opacity-100 [@media(hover:none)]:h-9 [@media(hover:none)]:w-9 [@media(hover:none)]:opacity-100 [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9 [@media(pointer:coarse)]:opacity-100";

type FullNote = NoteRecord;

function toErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

const NOTE_CONFLICT_MESSAGE =
  "This note changed somewhere else. Your unsaved text is still here and was not written over the newer copy.";

function notesStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readNoteIdFromLocation(): string | null {
  if (typeof window === "undefined") return null;
  const id = new URLSearchParams(window.location.search).get("noteId")?.trim();
  return id || null;
}

function replaceNotesQuery(noteId: string | null) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const nextSearch = notesSearchWithNoteId(url.search, noteId);
  const next = `${url.pathname}${nextSearch}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next === current) return;
  window.history.replaceState(window.history.state, "", next);
}

function NotesPageContent() {
  const searchParams = useSearchParams();
  const routerNoteId = searchParams.get("noteId")?.trim() || null;
  // The address bar is updated with history.replaceState so opening a note does
  // not remount the page. After that, location is ahead of useSearchParams.
  const noteIdParam = readNoteIdFromLocation() || routerNoteId;
  const { isAdmin } = useAuthRole();

  const [notebooks, setNotebooks] = useState<NotebookWithNotes[]>([]);
  const [moodboards, setMoodboards] = useState<MoodboardSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(noteIdParam);
  const [activeNote, setActiveNote] = useState<FullNote | null>(null);
  const [noteLoading, setNoteLoading] = useState(Boolean(noteIdParam));
  const [titleDraft, setTitleDraft] = useState("");
  const [contentDraft, setContentDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isCreateNotebookModalOpen, setIsCreateNotebookModalOpen] = useState(false);
  const [editingNotebookId, setEditingNotebookId] = useState<string | null>(null);
  const [notebookForm, setNotebookForm] = useState<NotebookFormState>({
    name: "",
    accessLevel: "all",
    assignedUserIds: [],
  });
  const [savingNotebook, setSavingNotebook] = useState(false);
  const [recipients, setRecipients] = useState<RecipientOption[]>([]);
  const [sendRecipientId, setSendRecipientId] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [sendFeedback, setSendFeedback] = useState<string | null>(null);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [editorScrollTop, setEditorScrollTop] = useState(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const placeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeNoteIdRef = useRef<string | null>(null);
  const openedNoteParamRef = useRef<string | null>(null);
  const titleDraftRef = useRef("");
  const contentDraftRef = useRef("");
  const baseUpdatedAtRef = useRef("");
  const baseTitleRef = useRef("");
  const baseContentRef = useRef("");
  const scrollTopRef = useRef(0);
  const conflictRef = useRef(false);
  const scheduleSaveRef = useRef<(noteId: string, title: string, content: string) => void>(() => {});

  const capturePlace = useCallback((noteId: string | null) => {
    if (!noteId || !baseUpdatedAtRef.current) return;
    const storage = notesStorage();
    writeNotesPlace(
      storage,
      upsertNotePlace(readNotesPlace(storage), {
        noteId,
        title: titleDraftRef.current,
        content: contentDraftRef.current,
        baseUpdatedAt: baseUpdatedAtRef.current,
        baseTitle: baseTitleRef.current,
        baseContent: baseContentRef.current,
        scrollTop: scrollTopRef.current,
      })
    );
  }, []);

  const queuePlaceSave = useCallback(() => {
    if (placeTimerRef.current) clearTimeout(placeTimerRef.current);
    placeTimerRef.current = setTimeout(() => {
      placeTimerRef.current = null;
      capturePlace(activeNoteIdRef.current);
    }, 200);
  }, [capturePlace]);

  const commitSavedPlace = useCallback(
    (
      noteId: string,
      saved: { title: string; content: string; updatedAt: string },
      sent: { title?: string; content?: string }
    ) => {
      const storage = notesStorage();
      const place = readNotesPlace(storage);
      const stored = place.drafts[noteId];
      const isActive = activeNoteIdRef.current === noteId;
      const baseTitle =
        sent.title !== undefined
          ? saved.title
          : isActive
            ? baseTitleRef.current
            : (stored?.baseTitle ?? saved.title);
      const baseContent =
        sent.content !== undefined
          ? sent.content
          : isActive
            ? baseContentRef.current
            : (stored?.baseContent ?? saved.content);
      writeNotesPlace(
        storage,
        upsertNotePlace(place, {
          noteId,
          title: isActive ? titleDraftRef.current : (stored?.title ?? saved.title),
          content: isActive ? contentDraftRef.current : (stored?.content ?? saved.content),
          baseUpdatedAt: saved.updatedAt,
          baseTitle,
          baseContent,
          scrollTop: isActive
            ? scrollTopRef.current
            : (place.scroll[noteId] ?? stored?.scrollTop ?? 0),
        })
      );
    },
    []
  );

  const forgetPlace = useCallback((noteId: string) => {
    const storage = notesStorage();
    writeNotesPlace(storage, forgetNotePlace(readNotesPlace(storage), noteId));
  }, []);

  const clearOpenNote = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (placeTimerRef.current) clearTimeout(placeTimerRef.current);
    setSelectedNoteId(null);
    setActiveNote(null);
    setTitleDraft("");
    setContentDraft("");
    titleDraftRef.current = "";
    contentDraftRef.current = "";
    baseUpdatedAtRef.current = "";
    baseTitleRef.current = "";
    baseContentRef.current = "";
    scrollTopRef.current = 0;
    conflictRef.current = false;
    activeNoteIdRef.current = null;
    openedNoteParamRef.current = null;
    replaceNotesQuery(null);
  }, []);

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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/planner/assignees", {
          cache: "no-store",
          credentials: "include",
        });
        const payload = (await response.json().catch(() => null)) as
          | { data?: RecipientOption[]; error?: string }
          | null;
        if (!response.ok || cancelled) return;
        const employees = (payload?.data ?? []).filter((user) => isSelectablePlannerStaffProfile(user));
        setRecipients(employees);
      } catch {
        if (!cancelled) setRecipients([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const sendNoteAsMessage = useCallback(async () => {
    if (!activeNote || !sendRecipientId || sendingMessage) return;
    const activeNotebook = notebooks.find((nb) => nb.id === activeNote.notebookId);
    if (activeNotebook?.isSystem !== true) {
      setSendFeedback("Messages can only be sent from Studio Chats.");
      return;
    }
    const bodyParts = [titleDraft.trim(), contentDraft].filter(Boolean);
    const content = bodyParts.join("\n\n");
    if (!content.trim()) {
      setSendFeedback("Note is empty — add a title or content first.");
      return;
    }

    setSendingMessage(true);
    setSendFeedback(null);
    try {
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientId: sendRecipientId,
          content,
          sourceNoteId: activeNote.id,
        }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error || `Failed to send (${response.status}).`);
      }
      const recipient = recipients.find((r) => r.id === sendRecipientId);
      const label =
        recipient?.full_name?.trim() || recipient?.email?.trim() || "employee";
      setSendFeedback(`Sent to ${label}.`);
      setSendRecipientId("");
    } catch (err) {
      setSendFeedback(toErrorMessage(err, "Failed to send message."));
    } finally {
      setSendingMessage(false);
    }
  }, [
    activeNote,
    contentDraft,
    notebooks,
    recipients,
    sendRecipientId,
    sendingMessage,
    titleDraft,
  ]);

  const selectNote = useCallback(async (noteId: string) => {
    replaceNotesQuery(noteId);
    openedNoteParamRef.current = noteId;
    if (activeNoteIdRef.current === noteId) return;

    if (placeTimerRef.current) {
      clearTimeout(placeTimerRef.current);
      placeTimerRef.current = null;
    }
    capturePlace(activeNoteIdRef.current);

    setSelectedNoteId(noteId);
    setIsMobileSidebarOpen(false);
    activeNoteIdRef.current = noteId;
    conflictRef.current = false;
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
      const place = readNotesPlace(notesStorage());
      const draft = place.drafts[noteId] ?? null;
      const resolved = resolveOpenedNote({
        server: {
          title: payload.note.title,
          content: payload.note.content || "",
          updatedAt: payload.note.updatedAt,
        },
        draft,
        scrollTop: place.scroll[noteId] ?? draft?.scrollTop ?? 0,
      });
      titleDraftRef.current = resolved.title;
      contentDraftRef.current = resolved.content;
      baseUpdatedAtRef.current = resolved.baseUpdatedAt;
      baseTitleRef.current = resolved.baseTitle;
      baseContentRef.current = resolved.baseContent;
      scrollTopRef.current = resolved.scrollTop;
      setEditorScrollTop(resolved.scrollTop);
      setActiveNote({ ...payload.note, title: resolved.title, content: resolved.content });
      setTitleDraft(resolved.title);
      setContentDraft(resolved.content);
      setExpanded((prev) => ({ ...prev, [payload.note!.notebookId]: true }));
      if (resolved.clearDraft || resolved.pendingSave || resolved.conflict) {
        writeNotesPlace(
          notesStorage(),
          upsertNotePlace(place, {
            noteId,
            title: resolved.title,
            content: resolved.content,
            baseUpdatedAt: resolved.baseUpdatedAt,
            baseTitle: resolved.baseTitle,
            baseContent: resolved.baseContent,
            scrollTop: resolved.scrollTop,
          })
        );
      }
      if (resolved.conflict) {
        conflictRef.current = true;
        setSaveError(NOTE_CONFLICT_MESSAGE);
      } else if (resolved.pendingSave) {
        scheduleSaveRef.current(noteId, resolved.title, resolved.content);
      }
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
  }, [capturePlace]);

  useEffect(() => {
    const id = noteIdParam?.trim();
    if (!id || loading) return;
    if (openedNoteParamRef.current === id || activeNoteIdRef.current === id) return;
    openedNoteParamRef.current = id;
    void selectNote(id);
  }, [noteIdParam, loading, selectNote]);

  const persistNote = useCallback(
    async (
      noteId: string,
      patch: {
        title?: string;
        content?: string;
        accessLevel?: NotebookAccessLevel;
        assignedUserIds?: string[];
        moodboardId?: string | null;
      }
    ) => {
      const applySavedNote = (saved: FullNote, sent: typeof patch) => {
        const writesText = sent.title !== undefined || sent.content !== undefined;
        if (writesText) {
          baseUpdatedAtRef.current = saved.updatedAt;
          if (sent.title !== undefined) {
            baseTitleRef.current = saved.title;
            if (titleDraftRef.current === sent.title) {
              titleDraftRef.current = saved.title;
              setTitleDraft(saved.title);
            }
          }
          if (sent.content !== undefined) {
            baseContentRef.current = sent.content;
          }
          conflictRef.current = false;
        } else if (activeNoteIdRef.current === noteId) {
          baseUpdatedAtRef.current = saved.updatedAt;
        }
        if (activeNoteIdRef.current === noteId) {
          const patchTouchedAccess =
            sent.accessLevel !== undefined || sent.assignedUserIds !== undefined;
          const patchTouchedMoodboard = Object.prototype.hasOwnProperty.call(sent, "moodboardId");
          setActiveNote((prev) => {
            if (!prev || prev.id !== noteId) return saved;
            return {
              ...saved,
              title: titleDraftRef.current,
              content: contentDraftRef.current,
              accessLevel: patchTouchedAccess ? saved.accessLevel : prev.accessLevel,
              assignedUserIds: patchTouchedAccess ? saved.assignedUserIds : prev.assignedUserIds,
              moodboardId: patchTouchedMoodboard ? saved.moodboardId : prev.moodboardId,
            };
          });
        }
        setNotebooks((prev) =>
          prev.map((nb) => {
            if (nb.id !== saved.notebookId) {
              return {
                ...nb,
                notes: nb.notes.filter((n) => n.id !== noteId),
              };
            }
            const summary: NoteSummary = {
              id: saved.id,
              notebookId: saved.notebookId,
              title: saved.title,
              visibility: saved.visibility,
              accessLevel: saved.accessLevel,
              assignedUserIds: saved.assignedUserIds,
              moodboardId: saved.moodboardId,
              updatedAt: saved.updatedAt,
              createdAt: saved.createdAt,
            };
            const notes = [summary, ...nb.notes.filter((n) => n.id !== noteId)].sort((a, b) =>
              b.updatedAt.localeCompare(a.updatedAt)
            );
            return { ...nb, notes, updatedAt: saved.updatedAt };
          })
        );
        commitSavedPlace(noteId, saved, sent);
      };

      const run = async (nextPatch: typeof patch, allowRetry: boolean) => {
        const response = await fetch(`/api/notes/${noteId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...nextPatch,
            expectedUpdatedAt: baseUpdatedAtRef.current,
          }),
        });
        const payload = (await response.json().catch(() => null)) as
          | { note?: FullNote; error?: string; conflict?: boolean }
          | null;
        if (response.status === 409 && payload?.note && payload.conflict) {
          const decision = decideSaveConflict({
            serverTitle: payload.note.title,
            serverContent: payload.note.content || "",
            localTitle: titleDraftRef.current,
            localContent: contentDraftRef.current,
            baseTitle: baseTitleRef.current,
            baseContent: baseContentRef.current,
          });
          if (decision === "apply-server") {
            baseUpdatedAtRef.current = payload.note.updatedAt;
            baseTitleRef.current = payload.note.title;
            baseContentRef.current = payload.note.content || "";
            conflictRef.current = false;
            capturePlace(noteId);
            return;
          }
          if (decision === "retry" && allowRetry) {
            baseUpdatedAtRef.current = payload.note.updatedAt;
            baseTitleRef.current = payload.note.title;
            baseContentRef.current = payload.note.content || "";
            await run(
              {
                ...nextPatch,
                title: titleDraftRef.current,
                content: contentDraftRef.current,
              },
              false
            );
            return;
          }
          if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
          conflictRef.current = true;
          setSaveError(NOTE_CONFLICT_MESSAGE);
          capturePlace(noteId);
          return;
        }
        if (!response.ok || !payload?.note) {
          throw new Error(payload?.error || `Save failed (${response.status}).`);
        }
        applySavedNote(payload.note, nextPatch);
      };

      setSaving(true);
      setSaveError(null);
      try {
        await run(patch, true);
      } catch (err) {
        setSaveError(toErrorMessage(err, "Failed to save note."));
      } finally {
        setSaving(false);
      }
    },
    [capturePlace, commitSavedPlace]
  );

  const scheduleSave = useCallback(
    (noteId: string, title: string, content: string) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (conflictRef.current) return;
      saveTimerRef.current = setTimeout(() => {
        void persistNote(noteId, { title, content });
      }, 600);
    },
    [persistNote]
  );
  useEffect(() => {
    scheduleSaveRef.current = scheduleSave;
  }, [scheduleSave]);

  useEffect(() => {
    const flush = () => {
      if (placeTimerRef.current) {
        clearTimeout(placeTimerRef.current);
        placeTimerRef.current = null;
      }
      capturePlace(activeNoteIdRef.current);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      flush();
    };
  }, [capturePlace]);

  const closeCreateNotebookModal = useCallback(() => {
    setIsCreateNotebookModalOpen(false);
    setEditingNotebookId(null);
    setNotebookForm({ name: "", accessLevel: "all", assignedUserIds: [] });
  }, []);

  const openCreateNotebookModal = useCallback(() => {
    setNotebookForm({ name: "New Notebook", accessLevel: "all", assignedUserIds: [] });
    setEditingNotebookId(null);
    setIsCreateNotebookModalOpen(true);
  }, []);

  const openEditNotebookModal = useCallback((nb: NotebookWithNotes) => {
    if (nb.isSystem || !nb.canEdit) return;
    setEditingNotebookId(nb.id);
    setNotebookForm({
      name: nb.name,
      accessLevel: nb.accessLevel,
      assignedUserIds: [...nb.assignedUserIds],
    });
    setIsCreateNotebookModalOpen(true);
  }, []);

  const toggleAssignedUser = useCallback((userId: string) => {
    setNotebookForm((prev) => {
      const has = prev.assignedUserIds.includes(userId);
      return {
        ...prev,
        assignedUserIds: has
          ? prev.assignedUserIds.filter((id) => id !== userId)
          : [...prev.assignedUserIds, userId],
      };
    });
  }, []);

  const updateActiveNoteAccess = useCallback(
    (next: { accessLevel: NotebookAccessLevel; assignedUserIds: string[] }) => {
      if (!activeNote) return;

      // Always update local UI so the Specific Users checklist can appear even
      // before any checkboxes are selected. Persist only when the selection is valid.
      setActiveNote((prev) =>
        prev
          ? {
              ...prev,
              accessLevel: next.accessLevel,
              assignedUserIds: [...next.assignedUserIds],
            }
          : prev
      );

      if (next.accessLevel === "specific" && next.assignedUserIds.length === 0) {
        setSaveError("Select at least one user for Specific Users access.");
        return;
      }

      setSaveError(null);
      void persistNote(activeNote.id, {
        accessLevel: next.accessLevel,
        assignedUserIds:
          next.accessLevel === "specific" ? next.assignedUserIds : [],
      });
    },
    [activeNote, persistNote]
  );

  const toggleActiveNoteAssignedUser = useCallback(
    (userId: string) => {
      if (!activeNote) return;
      const has = activeNote.assignedUserIds.includes(userId);
      const assignedUserIds = has
        ? activeNote.assignedUserIds.filter((id) => id !== userId)
        : [...activeNote.assignedUserIds, userId];
      updateActiveNoteAccess({
        accessLevel: "specific",
        assignedUserIds,
      });
    },
    [activeNote, updateActiveNoteAccess]
  );

  const saveNotebook = useCallback(async () => {
    const name = notebookForm.name.trim();
    if (!name || savingNotebook) return;
    if (
      notebookForm.accessLevel === "specific" &&
      notebookForm.assignedUserIds.length === 0
    ) {
      setError("Select at least one user for Specific Users access.");
      return;
    }

    setSavingNotebook(true);
    try {
      const body = {
        name,
        accessLevel: notebookForm.accessLevel,
        assignedUserIds:
          notebookForm.accessLevel === "specific" ? notebookForm.assignedUserIds : [],
      };

      if (editingNotebookId) {
        const response = await fetch(`/api/notes/notebooks/${editingNotebookId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = (await response.json().catch(() => null)) as
          | { notebook?: Omit<NotebookWithNotes, "notes">; error?: string }
          | null;
        if (!response.ok || !payload?.notebook) {
          throw new Error(payload?.error || "Failed to update notebook.");
        }
        setNotebooks((prev) =>
          prev.map((nb) =>
            nb.id === editingNotebookId ? { ...nb, ...payload.notebook!, notes: nb.notes } : nb
          )
        );
      } else {
        const response = await fetch("/api/notes/notebooks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = (await response.json().catch(() => null)) as
          | { notebook?: NotebookWithNotes; error?: string }
          | null;
        if (!response.ok || !payload?.notebook) {
          throw new Error(payload?.error || "Failed to create notebook.");
        }
        setNotebooks((prev) => [payload.notebook!, ...prev]);
        setExpanded((prev) => ({ ...prev, [payload.notebook!.id]: true }));
      }
      closeCreateNotebookModal();
      setEditingNotebookId(null);
    } catch (err) {
      setError(toErrorMessage(err, "Failed to save notebook."));
    } finally {
      setSavingNotebook(false);
    }
  }, [closeCreateNotebookModal, editingNotebookId, notebookForm, savingNotebook]);

  const createNote = useCallback(
    async (notebookId: string) => {
      try {
        const response = await fetch("/api/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notebookId, title: "Untitled", accessLevel: "all" }),
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
          accessLevel: note.accessLevel,
          assignedUserIds: note.assignedUserIds,
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
        forgetPlace(noteId);
        if (selectedNoteId === noteId) {
          clearOpenNote();
        }
      } catch (err) {
        setError(toErrorMessage(err, "Failed to delete note."));
      }
    },
    [clearOpenNote, forgetPlace, selectedNoteId]
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
        for (const note of removed?.notes ?? []) {
          forgetPlace(note.id);
        }
        if (removed?.notes.some((n) => n.id === selectedNoteId)) {
          clearOpenNote();
        }
      } catch (err) {
        setError(toErrorMessage(err, "Failed to delete notebook."));
      }
    },
    [clearOpenNote, forgetPlace, notebooks, selectedNoteId]
  );

  const selectedNotebook = useMemo(() => {
    if (!activeNote) return null;
    return notebooks.find((nb) => nb.id === activeNote.notebookId) ?? null;
  }, [activeNote, notebooks]);

  const selectedNotebookName = selectedNotebook?.name ?? null;
  const canSendStickyMessage = selectedNotebook?.isSystem === true;

  return (
    <main className="relative mx-auto flex h-[calc(100vh-10rem)] w-full max-w-[1800px] min-h-[480px] gap-0 px-3 py-3 sm:px-4">
      {isMobileSidebarOpen ? (
        <button
          type="button"
          aria-label="Close notes menu"
          className="fixed inset-0 z-[60] bg-black/55 md:hidden"
          onClick={() => setIsMobileSidebarOpen(false)}
        />
      ) : null}

      <aside
        className={`z-[70] w-[min(20rem,88vw)] shrink-0 flex-col border border-zinc-800 bg-zinc-950 shadow-2xl transition-transform duration-200 ease-out md:static md:z-auto md:w-80 md:shadow-none md:transition-none ${
          isMobileSidebarOpen
            ? "fixed inset-y-0 left-0 flex translate-x-0"
            : "fixed inset-y-0 left-0 hidden -translate-x-full md:flex md:translate-x-0"
        }`}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <Book className="h-4 w-4 text-amber-400" />
            Notes
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={openCreateNotebookModal}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs font-medium text-zinc-100 hover:bg-zinc-800"
            >
              <Plus className="h-3.5 w-3.5" />
              Notebook
            </button>
            <button
              type="button"
              aria-label="Close notes menu"
              onClick={() => setIsMobileSidebarOpen(false)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 md:hidden"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
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
                        <span className="inline-flex items-center gap-1.5">
                          {nb.isSystem ? (
                            <Lock className="h-3 w-3 shrink-0 text-amber-400/80" aria-hidden />
                          ) : null}
                          <span className="truncate">{nb.name}</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        title="New note"
                        onClick={() => void createNote(nb.id)}
                        className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 ${ROW_ACTION_VISIBILITY} group-hover:opacity-100 group-focus-within:opacity-100`}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                      {nb.canEdit ? (
                        <button
                          type="button"
                          title="Notebook settings"
                          onClick={() => openEditNotebookModal(nb)}
                          className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 ${ROW_ACTION_VISIBILITY} group-hover:opacity-100 group-focus-within:opacity-100`}
                        >
                          <Settings2 className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                      {nb.canDelete ? (
                        <button
                          type="button"
                          title="Delete notebook"
                          onClick={() => void deleteNotebook(nb.id)}
                          className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-zinc-500 hover:bg-red-950/50 hover:text-red-300 ${ROW_ACTION_VISIBILITY} group-hover:opacity-100 group-focus-within:opacity-100`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
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
                                  {note.accessLevel === "admin_only" ? (
                                    <Shield
                                      className="h-3 w-3 shrink-0 text-amber-400/80"
                                      aria-label="Admin only"
                                    />
                                  ) : note.accessLevel === "specific" ? (
                                    <Lock
                                      className="h-3 w-3 shrink-0 text-zinc-500"
                                      aria-label="Specific users"
                                    />
                                  ) : null}
                                </button>
                                <button
                                  type="button"
                                  title="Delete note"
                                  onClick={() => void deleteNote(note.id)}
                                  className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-zinc-500 hover:bg-red-950/50 hover:text-red-300 ${ROW_ACTION_VISIBILITY} group-hover/note:opacity-100 group-focus-within/note:opacity-100`}
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

      <section className="flex min-w-0 flex-1 flex-col border border-zinc-800 bg-zinc-900/40 md:border-l-0">
        <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2 md:hidden">
          <button
            type="button"
            aria-label="Open notes menu"
            onClick={() => setIsMobileSidebarOpen(true)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-700 bg-zinc-950 text-zinc-200 hover:bg-zinc-800"
          >
            <Menu className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-zinc-100">
              {activeNote?.title?.trim() || selectedNotebookName || "Notes"}
            </p>
            <p className="truncate text-[11px] text-zinc-500">
              {selectedNoteId ? "Editing note" : "Choose a notebook or note"}
            </p>
          </div>
        </div>

        {!selectedNoteId ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <FileText className="h-10 w-10 text-zinc-600" />
            <p className="text-sm font-medium text-zinc-300">Select a note to edit</p>
            <p className="max-w-sm text-xs text-zinc-500">
              Create a notebook, add a note, then write with checklists, headings, and separators.
            </p>
            <button
              type="button"
              onClick={() => setIsMobileSidebarOpen(true)}
              className="mt-2 inline-flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-800 md:hidden"
            >
              <Menu className="h-4 w-4" />
              Open notebooks
            </button>
          </div>
        ) : noteLoading ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading note…
          </div>
        ) : !activeNote ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <FileText className="h-10 w-10 text-zinc-600" />
            <p className="text-sm font-medium text-zinc-300">Could not open this note</p>
            <p className="max-w-sm text-xs text-red-300">
              {saveError || "It may have been deleted."}
            </p>
            <button
              type="button"
              onClick={clearOpenNote}
              className="mt-2 inline-flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-800"
            >
              Back to notes
            </button>
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
                    titleDraftRef.current = next;
                    setTitleDraft(next);
                    scheduleSave(activeNote.id, next, contentDraftRef.current);
                    queuePlaceSave();
                  }}
                  placeholder="Untitled"
                  className="w-full bg-transparent text-xl font-semibold text-zinc-50 outline-none placeholder:text-zinc-600"
                />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <NoteAccessControlFields
                    compact
                    inline
                    accessLevel={activeNote.accessLevel}
                    assignedUserIds={activeNote.assignedUserIds}
                    recipients={recipients}
                    isAdmin={isAdmin}
                    onAccessLevelChange={(accessLevel) =>
                      updateActiveNoteAccess({
                        accessLevel,
                        assignedUserIds:
                          accessLevel === "specific"
                            ? activeNote.assignedUserIds
                            : [],
                      })
                    }
                    onToggleUser={toggleActiveNoteAssignedUser}
                  />
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
                  {canSendStickyMessage ? (
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
                      <span>Send to</span>
                      <select
                        value={sendRecipientId}
                        onChange={(event) => {
                          setSendRecipientId(event.target.value);
                          setSendFeedback(null);
                        }}
                        className="max-w-[180px] rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-200 outline-none"
                      >
                        <option value="">Choose employee…</option>
                        {recipients.map((user) => (
                          <option key={user.id} value={user.id}>
                            {user.full_name?.trim() || user.email?.trim() || user.id}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => void sendNoteAsMessage()}
                        disabled={!sendRecipientId || sendingMessage}
                        className="inline-flex items-center gap-1 rounded border border-amber-600/50 bg-amber-500/15 px-2 py-1 text-[11px] font-medium text-amber-100 hover:bg-amber-500/25 disabled:opacity-40"
                      >
                        {sendingMessage ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Send className="h-3 w-3" />
                        )}
                        Send
                      </button>
                      {sendFeedback ? (
                        <span
                          className={
                            sendFeedback.startsWith("Sent")
                              ? "text-emerald-400"
                              : "text-red-300"
                          }
                        >
                          {sendFeedback}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
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
                initialScrollTop={editorScrollTop}
                scrollRestoreKey={activeNote.id}
                onScrollPosition={(scrollTop) => {
                  scrollTopRef.current = scrollTop;
                  queuePlaceSave();
                }}
                onChange={(html) => {
                  contentDraftRef.current = html;
                  setContentDraft(html);
                  scheduleSave(activeNote.id, titleDraftRef.current, html);
                  queuePlaceSave();
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
            className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-950 p-4 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="create-notebook-title" className="text-sm font-semibold text-zinc-100">
              {editingNotebookId ? "Edit notebook" : "New notebook"}
            </h2>
            <label className="mt-3 block text-xs text-zinc-400">
              Name
              <input
                type="text"
                autoFocus
                value={notebookForm.name}
                onChange={(event) =>
                  setNotebookForm((prev) => ({ ...prev, name: event.target.value }))
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void saveNotebook();
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

            <NoteAccessControlFields
              accessLevel={notebookForm.accessLevel}
              assignedUserIds={notebookForm.assignedUserIds}
              recipients={recipients}
              isAdmin={isAdmin}
              onAccessLevelChange={(accessLevel) =>
                setNotebookForm((prev) => ({ ...prev, accessLevel }))
              }
              onToggleUser={toggleAssignedUser}
            />

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeCreateNotebookModal}
                disabled={savingNotebook}
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveNotebook()}
                disabled={
                  !notebookForm.name.trim() ||
                  savingNotebook ||
                  (notebookForm.accessLevel === "specific" &&
                    notebookForm.assignedUserIds.length === 0)
                }
                className="rounded-lg border border-amber-600/50 bg-amber-500/15 px-3 py-1.5 text-sm font-medium text-amber-100 hover:bg-amber-500/25 disabled:opacity-50"
              >
                {savingNotebook
                  ? editingNotebookId
                    ? "Saving…"
                    : "Creating…"
                  : editingNotebookId
                    ? "Save"
                    : "Create"}
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
