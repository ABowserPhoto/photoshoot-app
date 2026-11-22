import assert from "node:assert/strict";
import { test } from "node:test";

import {
  loginHrefWithRedirect,
  shouldKeepModuleTreeMounted,
  shouldReloadAuthRoleOnEvent,
} from "./authRefresh.ts";

test("visibility recovery for the current user does not reload auth", () => {
  assert.equal(shouldReloadAuthRoleOnEvent("INITIAL_SESSION", "user-1", null), false);
  assert.equal(shouldReloadAuthRoleOnEvent("TOKEN_REFRESHED", "user-1", "user-1"), false);
  assert.equal(shouldReloadAuthRoleOnEvent("SIGNED_IN", "user-1", "user-1"), false);
});

test("sign-in, sign-out, and user updates still reload auth", () => {
  assert.equal(shouldReloadAuthRoleOnEvent("SIGNED_IN", "user-2", "user-1"), true);
  assert.equal(shouldReloadAuthRoleOnEvent("SIGNED_IN", "user-1", null), true);
  assert.equal(shouldReloadAuthRoleOnEvent("SIGNED_OUT", null, "user-1"), true);
  assert.equal(shouldReloadAuthRoleOnEvent("USER_UPDATED", "user-1", "user-1"), true);
  assert.equal(shouldReloadAuthRoleOnEvent("PASSWORD_RECOVERY", "user-1", "user-1"), true);
});

test("a module that is already visible stays mounted during a later auth load", () => {
  assert.equal(
    shouldKeepModuleTreeMounted({
      isLoading: true,
      authenticated: true,
      allowed: true,
      hasShownModule: true,
    }),
    true
  );
  assert.equal(
    shouldKeepModuleTreeMounted({
      isLoading: true,
      authenticated: true,
      allowed: true,
      hasShownModule: false,
    }),
    false
  );
  assert.equal(
    shouldKeepModuleTreeMounted({
      isLoading: false,
      authenticated: true,
      allowed: true,
      hasShownModule: true,
    }),
    false
  );
});

test("login return path keeps the open note and rejects off-site targets", () => {
  assert.equal(
    loginHrefWithRedirect("/notes?noteId=note-1"),
    "/login?redirect=" + encodeURIComponent("/notes?noteId=note-1")
  );
  assert.equal(loginHrefWithRedirect("/login"), "/login");
  assert.equal(loginHrefWithRedirect("//evil.example"), "/login");
  assert.equal(loginHrefWithRedirect("https://evil.example"), "/login");
});
