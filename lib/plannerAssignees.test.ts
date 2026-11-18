import assert from "node:assert/strict";
import { test } from "node:test";

import {
  filterPlannerStaffProfiles,
  isClientProfileRole,
  isSelectablePlannerStaffProfile,
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
