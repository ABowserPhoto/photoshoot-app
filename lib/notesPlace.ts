export const NOTES_PLACE_STORAGE_KEY = "workflow-notes-place-v1";

export type NotePlaceDraft = {
  noteId: string;
  title: string;
  content: string;
  baseUpdatedAt: string;
  baseTitle: string;
  baseContent: string;
  scrollTop: number;
};

export type NotesPlaceState = {
  drafts: Record<string, NotePlaceDraft>;
  scroll: Record<string, number>;
};

export type OpenedNoteResolution = {
  title: string;
  content: string;
  scrollTop: number;
  baseUpdatedAt: string;
  baseTitle: string;
  baseContent: string;
  /** Local edits still need to be written. The server copy has not moved on. */
  pendingSave: boolean;
  /** Drop the stored draft. The editor is showing the server copy, or it matches. */
  clearDraft: boolean;
  /** Server copy diverged. Keep the local text and do not write over the server. */
  conflict: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readDraft(value: unknown): NotePlaceDraft | null {
  if (!isRecord(value)) return null;
  if (typeof value.noteId !== "string" || !value.noteId) return null;
  if (typeof value.title !== "string" || typeof value.content !== "string") return null;
  if (typeof value.baseUpdatedAt !== "string") return null;
  if (typeof value.baseTitle !== "string" || typeof value.baseContent !== "string") return null;
  const scrollTop = typeof value.scrollTop === "number" && Number.isFinite(value.scrollTop) ? value.scrollTop : 0;
  return {
    noteId: value.noteId,
    title: value.title,
    content: value.content,
    baseUpdatedAt: value.baseUpdatedAt,
    baseTitle: value.baseTitle,
    baseContent: value.baseContent,
    scrollTop,
  };
}

export function emptyNotesPlace(): NotesPlaceState {
  return { drafts: {}, scroll: {} };
}

export function parseNotesPlace(raw: string | null): NotesPlaceState {
  if (!raw) return emptyNotesPlace();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return emptyNotesPlace();
    const drafts: Record<string, NotePlaceDraft> = {};
    if (isRecord(parsed.drafts)) {
      for (const [key, value] of Object.entries(parsed.drafts)) {
        const draft = readDraft(value);
        if (draft && draft.noteId === key) drafts[key] = draft;
      }
    }
    const scroll: Record<string, number> = {};
    if (isRecord(parsed.scroll)) {
      for (const [key, value] of Object.entries(parsed.scroll)) {
        if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
          scroll[key] = value;
        }
      }
    }
    return { drafts, scroll };
  } catch {
    return emptyNotesPlace();
  }
}

export function readNotesPlace(storage: Pick<Storage, "getItem"> | null): NotesPlaceState {
  if (!storage) return emptyNotesPlace();
  try {
    return parseNotesPlace(storage.getItem(NOTES_PLACE_STORAGE_KEY));
  } catch {
    return emptyNotesPlace();
  }
}

export function writeNotesPlace(
  storage: Pick<Storage, "setItem"> | null,
  state: NotesPlaceState
): void {
  if (!storage) return;
  try {
    storage.setItem(NOTES_PLACE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore quota and private-mode errors. The open note is still in the URL.
  }
}

export function notesSearchWithNoteId(currentSearch: string, noteId: string | null): string {
  const raw = currentSearch.startsWith("?") ? currentSearch.slice(1) : currentSearch;
  const params = new URLSearchParams(raw);
  if (noteId) params.set("noteId", noteId);
  else params.delete("noteId");
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function resolveOpenedNote(params: {
  server: { title: string; content: string; updatedAt: string };
  draft: NotePlaceDraft | null;
  scrollTop: number;
}): OpenedNoteResolution {
  const { server, draft } = params;
  const scrollTop = params.scrollTop;
  const serverState: OpenedNoteResolution = {
    title: server.title,
    content: server.content,
    scrollTop,
    baseUpdatedAt: server.updatedAt,
    baseTitle: server.title,
    baseContent: server.content,
    pendingSave: false,
    clearDraft: Boolean(draft),
    conflict: false,
  };
  if (!draft) return { ...serverState, clearDraft: false };

  const draftDiffersFromServer = draft.title !== server.title || draft.content !== server.content;
  if (!draftDiffersFromServer) {
    return serverState;
  }

  // The draft is only safe to write when the server text is still the text it
  // was typed on. A newer title or body from anywhere else is left untouched.
  const serverMatchesBase =
    server.title === draft.baseTitle && server.content === draft.baseContent;
  if (!serverMatchesBase) {
    return {
      title: draft.title,
      content: draft.content,
      scrollTop,
      baseUpdatedAt: draft.baseUpdatedAt,
      baseTitle: draft.baseTitle,
      baseContent: draft.baseContent,
      pendingSave: false,
      clearDraft: false,
      conflict: true,
    };
  }

  return {
    title: draft.title,
    content: draft.content,
    scrollTop,
    baseUpdatedAt: server.updatedAt,
    baseTitle: server.title,
    baseContent: server.content,
    pendingSave: true,
    clearDraft: false,
    conflict: false,
  };
}

export type SaveConflictDecision = "apply-server" | "retry" | "keep-local";

/**
 * A 409 means the server note changed after this editor last read it.
 * Retry only when that change did not touch the text this draft is based on.
 * Otherwise keep the local text and leave the newer server copy alone.
 */
export function decideSaveConflict(params: {
  serverTitle: string;
  serverContent: string;
  localTitle: string;
  localContent: string;
  baseTitle: string;
  baseContent: string;
}): SaveConflictDecision {
  const localMatchesServer =
    params.localTitle === params.serverTitle && params.localContent === params.serverContent;
  if (localMatchesServer) return "apply-server";
  const serverMatchesBase =
    params.serverTitle === params.baseTitle && params.serverContent === params.baseContent;
  if (serverMatchesBase) return "retry";
  return "keep-local";
}

function sameTimestamp(left: string, right: string): boolean {
  if (left === right) return true;
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  return Number.isFinite(leftMs) && leftMs === rightMs;
}

export function contentWriteConflicts(params: {
  expectedUpdatedAt: string | null;
  serverUpdatedAt: string;
  serverTitle: string;
  serverContent: string;
  nextTitle: string;
  nextContent: string;
  writesContent: boolean;
}): boolean {
  if (!params.writesContent) return false;
  if (!params.expectedUpdatedAt || sameTimestamp(params.expectedUpdatedAt, params.serverUpdatedAt)) {
    return false;
  }
  return params.nextTitle !== params.serverTitle || params.nextContent !== params.serverContent;
}

export function upsertNotePlace(
  state: NotesPlaceState,
  update: NotePlaceDraft
): NotesPlaceState {
  const scroll = { ...state.scroll, [update.noteId]: Math.max(0, update.scrollTop) };
  const dirty = update.title !== update.baseTitle || update.content !== update.baseContent;
  if (!dirty) {
    if (!(update.noteId in state.drafts) && state.scroll[update.noteId] === scroll[update.noteId]) {
      return state;
    }
    const drafts = { ...state.drafts };
    delete drafts[update.noteId];
    return { drafts, scroll };
  }
  const draft: NotePlaceDraft = { ...update, scrollTop: scroll[update.noteId] ?? 0 };
  const previous = state.drafts[update.noteId];
  if (
    previous &&
    previous.title === draft.title &&
    previous.content === draft.content &&
    previous.baseUpdatedAt === draft.baseUpdatedAt &&
    previous.baseTitle === draft.baseTitle &&
    previous.baseContent === draft.baseContent &&
    previous.scrollTop === draft.scrollTop
  ) {
    return state.scroll[update.noteId] === draft.scrollTop ? state : { ...state, scroll };
  }
  return {
    drafts: { ...state.drafts, [update.noteId]: draft },
    scroll,
  };
}

export function forgetNotePlace(state: NotesPlaceState, noteId: string): NotesPlaceState {
  if (!(noteId in state.drafts) && !(noteId in state.scroll)) return state;
  const drafts = { ...state.drafts };
  const scroll = { ...state.scroll };
  delete drafts[noteId];
  delete scroll[noteId];
  return { drafts, scroll };
}
