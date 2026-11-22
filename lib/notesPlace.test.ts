import assert from "node:assert/strict";
import { test } from "node:test";

import {
  contentWriteConflicts,
  decideSaveConflict,
  forgetNotePlace,
  notesSearchWithNoteId,
  parseNotesPlace,
  resolveOpenedNote,
  upsertNotePlace,
  type NotePlaceDraft,
} from "./notesPlace.ts";

const draft = (overrides: Partial<NotePlaceDraft> = {}): NotePlaceDraft => ({
  noteId: "note-1",
  title: "Local title",
  content: "<p>Local</p>",
  baseUpdatedAt: "2026-11-20T12:00:00.000Z",
  baseTitle: "Server title",
  baseContent: "<p>Server</p>",
  scrollTop: 240,
  ...overrides,
});

test("note query keeps an existing notebook filter and clears when closed", () => {
  assert.equal(notesSearchWithNoteId("?folder=studio", "note-1"), "?folder=studio&noteId=note-1");
  assert.equal(notesSearchWithNoteId("?noteId=note-1&folder=studio", null), "?folder=studio");
  assert.equal(notesSearchWithNoteId("", null), "");
});

test("reload restores an unsaved draft when the server copy is unchanged", () => {
  const resolved = resolveOpenedNote({
    server: {
      title: "Server title",
      content: "<p>Server</p>",
      updatedAt: "2026-11-20T12:00:00.000Z",
    },
    draft: draft(),
    scrollTop: 240,
  });
  assert.equal(resolved.title, "Local title");
  assert.equal(resolved.content, "<p>Local</p>");
  assert.equal(resolved.scrollTop, 240);
  assert.equal(resolved.pendingSave, true);
  assert.equal(resolved.conflict, false);
});

test("a newer server copy is not overwritten by a stale draft", () => {
  const resolved = resolveOpenedNote({
    server: {
      title: "Someone else",
      content: "<p>Newer</p>",
      updatedAt: "2026-11-20T13:00:00.000Z",
    },
    draft: draft(),
    scrollTop: 80,
  });
  assert.equal(resolved.title, "Local title");
  assert.equal(resolved.content, "<p>Local</p>");
  assert.equal(resolved.pendingSave, false);
  assert.equal(resolved.conflict, true);
  assert.equal(resolved.clearDraft, false);
});

test("a timestamp-only server bump still saves the local draft", () => {
  const resolved = resolveOpenedNote({
    server: {
      title: "Server title",
      content: "<p>Server</p>",
      updatedAt: "2026-11-20T12:05:00.000Z",
    },
    draft: draft(),
    scrollTop: 10,
  });
  assert.equal(resolved.pendingSave, true);
  assert.equal(resolved.baseUpdatedAt, "2026-11-20T12:05:00.000Z");
  assert.equal(resolved.conflict, false);
});

test("matching server text drops the draft and keeps scroll", () => {
  const resolved = resolveOpenedNote({
    server: {
      title: "Local title",
      content: "<p>Local</p>",
      updatedAt: "2026-11-20T12:06:00.000Z",
    },
    draft: draft({ title: "Local title", content: "<p>Local</p>" }),
    scrollTop: 55,
  });
  assert.equal(resolved.pendingSave, false);
  assert.equal(resolved.clearDraft, true);
  assert.equal(resolved.scrollTop, 55);
  assert.equal(resolved.baseUpdatedAt, "2026-11-20T12:06:00.000Z");
});

test("save conflict retries only when the server text is still the edit base", () => {
  assert.equal(
    decideSaveConflict({
      serverTitle: "Server title",
      serverContent: "<p>Server</p>",
      localTitle: "Local title",
      localContent: "<p>Local</p>",
      baseTitle: "Server title",
      baseContent: "<p>Server</p>",
    }),
    "retry"
  );
  assert.equal(
    decideSaveConflict({
      serverTitle: "Local title",
      serverContent: "<p>Local</p>",
      localTitle: "Local title",
      localContent: "<p>Local</p>",
      baseTitle: "Server title",
      baseContent: "<p>Server</p>",
    }),
    "apply-server"
  );
  assert.equal(
    decideSaveConflict({
      serverTitle: "Other",
      serverContent: "<p>Other</p>",
      localTitle: "Local title",
      localContent: "<p>Local</p>",
      baseTitle: "Server title",
      baseContent: "<p>Server</p>",
    }),
    "keep-local"
  );
});

test("content writes conflict only when the text would replace a newer server copy", () => {
  assert.equal(
    contentWriteConflicts({
      expectedUpdatedAt: "2026-11-20T12:00:00.000Z",
      serverUpdatedAt: "2026-11-20T13:00:00.000Z",
      serverTitle: "Newer",
      serverContent: "<p>Newer</p>",
      nextTitle: "Local",
      nextContent: "<p>Local</p>",
      writesContent: true,
    }),
    true
  );
  assert.equal(
    contentWriteConflicts({
      expectedUpdatedAt: "2026-11-20T12:00:00.000Z",
      serverUpdatedAt: "2026-11-20T13:00:00.000Z",
      serverTitle: "Same",
      serverContent: "<p>Same</p>",
      nextTitle: "Same",
      nextContent: "<p>Same</p>",
      writesContent: true,
    }),
    false
  );
  assert.equal(
    contentWriteConflicts({
      expectedUpdatedAt: "2026-11-20T12:00:00.000Z",
      serverUpdatedAt: "2026-11-20T13:00:00.000Z",
      serverTitle: "Newer",
      serverContent: "<p>Newer</p>",
      nextTitle: "Newer",
      nextContent: "<p>Newer</p>",
      writesContent: false,
    }),
    false
  );
  assert.equal(
    contentWriteConflicts({
      expectedUpdatedAt: "2026-11-20T12:00:00.000Z",
      serverUpdatedAt: "2026-11-20T12:00:00+00:00",
      serverTitle: "Same",
      serverContent: "<p>Same</p>",
      nextTitle: "Edited",
      nextContent: "<p>Edited</p>",
      writesContent: true,
    }),
    false
  );
});

test("place storage keeps a dirty draft and forgets it when the text matches the server", () => {
  const dirty = upsertNotePlace(
    { drafts: {}, scroll: {} },
    draft()
  );
  assert.equal(dirty.drafts["note-1"]?.content, "<p>Local</p>");
  assert.equal(dirty.scroll["note-1"], 240);

  const clean = upsertNotePlace(dirty, draft({ title: "Server title", content: "<p>Server</p>", scrollTop: 12 }));
  assert.equal(clean.drafts["note-1"], undefined);
  assert.equal(clean.scroll["note-1"], 12);

  const forgotten = forgetNotePlace(clean, "note-1");
  assert.deepEqual(forgotten, { drafts: {}, scroll: {} });

  const parsed = parseNotesPlace(JSON.stringify(dirty));
  assert.equal(parsed.drafts["note-1"]?.title, "Local title");
  assert.equal(parseNotesPlace("not-json").drafts["note-1"], undefined);
});
