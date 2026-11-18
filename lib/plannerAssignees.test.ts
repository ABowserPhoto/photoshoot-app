import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clientAccountIdSet,
  filterPlannerStaffProfiles,
  isClientProfileRole,
  isSelectablePlannerStaffProfile,
  isStaffProfileRole,
  serializeAssignedUsers,
} from "./plannerAssignees.ts";

test("client role matches only the client login", () => {
  assert.equal(isClientProfileRole("client"), true);
  assert.equal(isClientProfileRole(" Client "), true);
  assert.equal(isClientProfileRole("CLIENT"), true);
  assert.equal(isClientProfileRole("editor"), false);
  assert.equal(isClientProfileRole("staff"), false);
  assert.equal(isClientProfileRole("team"), false);
  assert.equal(isClientProfileRole(""), false);
  assert.equal(isClientProfileRole(null), false);
});

test("staff roles require a non-client value", () => {
  assert.equal(isStaffProfileRole("admin"), true);
  assert.equal(isStaffProfileRole("editor"), true);
  assert.equal(isStaffProfileRole(" Editor "), true);
  assert.equal(isStaffProfileRole("staff"), true);
  assert.equal(isStaffProfileRole("team"), true);
  assert.equal(isStaffProfileRole("owner"), true);
  assert.equal(isStaffProfileRole("client"), false);
  assert.equal(isStaffProfileRole(" Client "), false);
  assert.equal(isStaffProfileRole(""), false);
  assert.equal(isStaffProfileRole("   "), false);
  assert.equal(isStaffProfileRole(null), false);
  assert.equal(isStaffProfileRole(undefined), false);
});

test("planner pickers keep staff roles and drop clients and archived profiles", () => {
  const rows = [
    { id: "admin", role: "admin", is_archived: false },
    { id: "editor", role: "editor", is_archived: false },
    { id: "staff", role: "staff", is_archived: false },
    { id: "team", role: "Team", is_archived: false },
    { id: "owner", role: "owner", is_archived: null },
    { id: "member", role: "member", is_archived: false },
    { id: "client", role: "client", is_archived: false },
    { id: "client-cased", role: " Client ", is_archived: false },
    { id: "archived-editor", role: "editor", is_archived: true },
    { id: "archived-client", role: "client", is_archived: true },
  ];

  assert.deepEqual(
    filterPlannerStaffProfiles(rows).map((row) => row.id),
    ["admin", "editor", "staff", "team", "owner", "member"]
  );
  assert.equal(isSelectablePlannerStaffProfile({ role: "administrator" }), true);
  assert.equal(isSelectablePlannerStaffProfile({ role: "client", is_archived: false }), false);
  assert.equal(isSelectablePlannerStaffProfile({ role: "editor", is_archived: true }), false);
  assert.equal(isSelectablePlannerStaffProfile({ role: null }), false);
  assert.equal(isSelectablePlannerStaffProfile({}), false);
});

test("a clients.user_id is never selectable, even with a staff role", () => {
  const clientIds = clientAccountIdSet([
    { user_id: "annika" },
    { user_id: "  " },
    { user_id: null },
    { user_id: "funky" },
  ]);
  assert.deepEqual([...clientIds], ["annika", "funky"]);

  const rows = [
    { id: "aaron", full_name: "Aaron", role: "admin", is_archived: false },
    { id: "bot", full_name: "Bot", role: "editor", is_archived: false },
    { id: "annika", full_name: "Annika Appel", role: "client", is_archived: false },
    { id: "funky", full_name: "Funky Buty", role: "editor", is_archived: false },
    { id: "testy", full_name: "Testy Tester", role: "client", is_archived: false },
    { id: "catherine", full_name: "Catherine Yeboh", role: "editor", is_archived: true },
    { id: "florence", full_name: "Florence Eunice", role: "editor", is_archived: true },
    { id: "yasmina", full_name: "Yasmina", role: "editor", is_archived: true },
    { id: "norole", full_name: "Missing role", role: null, is_archived: false },
  ];

  assert.deepEqual(
    filterPlannerStaffProfiles(rows, clientIds).map((row) => row.full_name),
    ["Aaron", "Bot"]
  );
});

test("a directory payload that omits role cannot fill a picker", () => {
  const rows = [
    { id: "aaron", full_name: "Aaron", is_archived: false },
    { id: "annika", full_name: "Annika Appel", is_archived: false },
    { id: "bot", full_name: "Bot", is_archived: false },
  ];
  assert.deepEqual(filterPlannerStaffProfiles(rows), []);
});

test("saved assignees do not keep directory role or archive flags", () => {
  assert.deepEqual(
    serializeAssignedUsers([
      { id: "1", name: "Ada", role: "editor", is_archived: false, avatar: "a" },
      { id: "2", name: "Bea" },
    ]),
    [
      { id: "1", name: "Ada", avatar: "a" },
      { id: "2", name: "Bea" },
    ]
  );
});
