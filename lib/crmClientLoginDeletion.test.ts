import assert from "node:assert/strict";
import { test } from "node:test";

import {
  collectAccountRoles,
  decideClientLoginDeletion,
  isProtectedClientLoginEmail,
  type ClientLoginDeletionInput,
} from "./crmClientLoginDeletion.ts";

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";

function input(overrides: Partial<ClientLoginDeletionInput> = {}): ClientLoginDeletionInput {
  return {
    linkedUserId: CLIENT_ID,
    callerUserId: OTHER_ID,
    otherClientLinks: 0,
    profile: {
      role: "client",
      email: "visitor@example.com",
      isArchived: false,
      jibbleEmployeeId: null,
      accessibleModules: [],
    },
    authUser: {
      id: CLIENT_ID,
      email: "visitor@example.com",
      roles: ["client"],
    },
    staffUsage: {
      taskEditor: 0,
      studioAssignment: 0,
      shifts: 0,
      messages: 0,
      notes: 0,
    },
    ...overrides,
  };
}

test("deletes a login that belongs only to this client", () => {
  assert.deepEqual(decideClientLoginDeletion(input()), { action: "delete-login" });
});

test("accepts a client role with different casing", () => {
  assert.deepEqual(
    decideClientLoginDeletion(
      input({
        profile: {
          role: " Client ",
          email: "visitor@example.com",
          isArchived: false,
          jibbleEmployeeId: null,
          accessibleModules: [],
        },
      })
    ),
    { action: "delete-login" }
  );
});

test("does nothing when the client has no linked login", () => {
  assert.deepEqual(
    decideClientLoginDeletion(input({ linkedUserId: null, authUser: null, profile: null })),
    { action: "none" }
  );
});

test("keeps a login that is still linked to another client", () => {
  const decision = decideClientLoginDeletion(input({ otherClientLinks: 1 }));
  assert.equal(decision.action, "keep");
});

test("keeps every privileged profile role", () => {
  for (const role of ["admin", "staff", "editor", "owner", "team", "bot"]) {
    const decision = decideClientLoginDeletion(
      input({
        profile: {
          role,
          email: "person@example.com",
          isArchived: false,
          jibbleEmployeeId: null,
          accessibleModules: [],
        },
        authUser: { id: CLIENT_ID, email: "person@example.com", roles: [] },
      })
    );
    assert.equal(decision.action, "keep", role);
  }
});

test("keeps a client profile when auth metadata says the account is staff", () => {
  const decision = decideClientLoginDeletion(
    input({
      authUser: { id: CLIENT_ID, email: "visitor@example.com", roles: ["team"] },
    })
  );
  assert.equal(decision.action, "keep");
});

test("never deletes the protected staff email, even with a client role", () => {
  assert.equal(isProtectedClientLoginEmail("  HiSswiftness2003@yahoo.com "), true);
  const decision = decideClientLoginDeletion(
    input({
      profile: {
        role: "client",
        email: "hisswiftness2003@yahoo.com",
        isArchived: false,
        jibbleEmployeeId: null,
        accessibleModules: [],
      },
      authUser: {
        id: CLIENT_ID,
        email: "hisswiftness2003@yahoo.com",
        roles: ["client"],
      },
    })
  );
  assert.equal(decision.action, "keep");
  assert.match(decision.action === "keep" ? decision.reason : "", /protected staff/i);
});

test("keeps the protected email when only the auth user carries it", () => {
  const decision = decideClientLoginDeletion(
    input({
      authUser: {
        id: CLIENT_ID,
        email: "hisswiftness2003@yahoo.com",
        roles: [],
      },
    })
  );
  assert.equal(decision.action, "keep");
});

test("keeps the signed-in admin from deleting their own login", () => {
  const decision = decideClientLoginDeletion(input({ callerUserId: CLIENT_ID }));
  assert.equal(decision.action, "keep");
});

test("keeps logins that still appear on staff records", () => {
  for (const staffUsage of [
    { taskEditor: 1, studioAssignment: 0, shifts: 0, messages: 0, notes: 0 },
    { taskEditor: 0, studioAssignment: 2, shifts: 0, messages: 0, notes: 0 },
    { taskEditor: 0, studioAssignment: 0, shifts: 1, messages: 0, notes: 0 },
    { taskEditor: 0, studioAssignment: 0, shifts: 0, messages: 1, notes: 0 },
    { taskEditor: 0, studioAssignment: 0, shifts: 0, messages: 0, notes: 1 },
  ]) {
    assert.equal(decideClientLoginDeletion(input({ staffUsage })).action, "keep");
  }
});

test("keeps archived, jibble, and module-granted accounts", () => {
  assert.equal(
    decideClientLoginDeletion(
      input({
        profile: {
          role: "client",
          email: "visitor@example.com",
          isArchived: true,
          jibbleEmployeeId: null,
          accessibleModules: [],
        },
      })
    ).action,
    "keep"
  );
  assert.equal(
    decideClientLoginDeletion(
      input({
        profile: {
          role: "client",
          email: "visitor@example.com",
          isArchived: false,
          jibbleEmployeeId: "jibble-1",
          accessibleModules: [],
        },
      })
    ).action,
    "keep"
  );
  assert.equal(
    decideClientLoginDeletion(
      input({
        profile: {
          role: "client",
          email: "visitor@example.com",
          isArchived: false,
          jibbleEmployeeId: null,
          accessibleModules: ["crm"],
        },
      })
    ).action,
    "keep"
  );
});

test("keeps a profile whose role is not exactly client", () => {
  const decision = decideClientLoginDeletion(
    input({
      profile: {
        role: "customer",
        email: "visitor@example.com",
        isArchived: false,
        jibbleEmployeeId: null,
        accessibleModules: [],
      },
    })
  );
  assert.equal(decision.action, "keep");
});

test("does not delete an auth user whose profile is missing", () => {
  const decision = decideClientLoginDeletion(input({ profile: null }));
  assert.equal(decision.action, "keep");
});

test("removes an orphan client profile when the auth user is already gone", () => {
  assert.deepEqual(decideClientLoginDeletion(input({ authUser: null })), {
    action: "delete-profile-only",
  });
});

test("reads roles from auth metadata objects", () => {
  assert.deepEqual(
    collectAccountRoles(
      { role: "client", name: "Ada" },
      { app_role: "owner" },
      null,
      "nope"
    ),
    ["client", "owner"]
  );
});
