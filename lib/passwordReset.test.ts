import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyRecoveryArrival,
  isUnauthenticatedAppPath,
  passwordIssue,
  passwordIssueMessage,
  passwordResetRedirectUrl,
  recoveryLandingUrl,
  RESET_LINK_SENT_MESSAGE,
} from "./passwordReset.ts";

test("password reset redirect stays on the host that asked", () => {
  assert.equal(
    passwordResetRedirectUrl("https://workflow.abowserphoto.com"),
    "https://workflow.abowserphoto.com/reset-password"
  );
  assert.equal(
    passwordResetRedirectUrl("https://photoshoot-app-git-feature-team.vercel.app"),
    "https://photoshoot-app-git-feature-team.vercel.app/reset-password"
  );
  assert.equal(
    passwordResetRedirectUrl("http://localhost:3000/"),
    "http://localhost:3000/reset-password"
  );
  assert.equal(
    passwordResetRedirectUrl("https://workflow.abowserphoto.com/login"),
    "https://workflow.abowserphoto.com/reset-password"
  );
  assert.equal(passwordResetRedirectUrl("not a url"), null);
  assert.equal(passwordResetRedirectUrl("javascript:alert(1)"), null);
});

test("forgot and reset pages stay reachable without a session", () => {
  assert.equal(isUnauthenticatedAppPath("/login"), true);
  assert.equal(isUnauthenticatedAppPath("/forgot-password"), true);
  assert.equal(isUnauthenticatedAppPath("/reset-password"), true);
  assert.equal(isUnauthenticatedAppPath("/gallery/shoot-1"), true);
  assert.equal(isUnauthenticatedAppPath("/admin/crm"), false);
  assert.equal(isUnauthenticatedAppPath("/"), false);
});

test("password confirmation rejects a short or mismatched password", () => {
  assert.equal(passwordIssue("short", "short"), "too-short");
  assert.equal(passwordIssue("longenough", "different"), "mismatch");
  assert.equal(passwordIssue("longenough", "longenough"), null);
  assert.equal(passwordIssueMessage("too-short"), "Password must be at least 8 characters.");
  assert.equal(passwordIssueMessage("mismatch"), "The passwords do not match.");
});

test("recovery links are classified without treating a normal visit as signed in", () => {
  assert.deepEqual(classifyRecoveryArrival("", ""), { kind: "invalid" });
  assert.deepEqual(classifyRecoveryArrival("?error=access_denied&error_code=otp_expired", ""), {
    kind: "invalid",
  });
  assert.deepEqual(classifyRecoveryArrival("?code=abc", "#error=access_denied"), { kind: "invalid" });
  assert.deepEqual(classifyRecoveryArrival("?code=abc", ""), { kind: "exchange", code: "abc" });
  assert.deepEqual(classifyRecoveryArrival("", "#access_token=token&type=recovery"), { kind: "implicit" });
  assert.deepEqual(classifyRecoveryArrival("?recovery=1", ""), { kind: "session" });
  assert.equal(RESET_LINK_SENT_MESSAGE, "If an account exists, we sent you a link.");
});

test("recovery redirect removes the one-time code", () => {
  const ready = recoveryLandingUrl(
    new URL("https://workflow.abowserphoto.com/reset-password?code=abc&error_code=old"),
    "ready"
  );
  assert.equal(ready.pathname, "/reset-password");
  assert.equal(ready.search, "?recovery=1");
  assert.equal(ready.hash, "");

  const invalid = recoveryLandingUrl(
    new URL("https://preview.vercel.app/reset-password?code=abc&recovery=1"),
    "invalid"
  );
  assert.equal(invalid.origin, "https://preview.vercel.app");
  assert.equal(invalid.search, "?error=invalid");
});
