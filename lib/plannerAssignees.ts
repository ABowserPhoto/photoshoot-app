export type PlannerAssignee = {
  id: string;
  name: string;
  avatar?: string;
};

export function parseAssignedUsers(value: unknown): PlannerAssignee[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: PlannerAssignee[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const r = item as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id.trim() : "";
    const name = typeof r.name === "string" ? r.name.trim() : "";
    if (!id || !name) {
      continue;
    }
    const avatar = typeof r.avatar === "string" && r.avatar.trim() ? r.avatar : undefined;
    out.push({ id, name, avatar });
  }
  return out;
}

export function serializeAssignedUsers(users: PlannerAssignee[]): PlannerAssignee[] {
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    ...(u.avatar ? { avatar: u.avatar } : {}),
  }));
}

/** Ensures the signed-in profile appears in `assigned_users` when starting timer workflows. */
export function appendCurrentUserIfMissing(
  assignedUsers: PlannerAssignee[],
  current: PlannerAssignee | null
): PlannerAssignee[] {
  if (!current?.id) {
    return assignedUsers;
  }
  if (assignedUsers.some((u) => u.id === current.id)) {
    return assignedUsers;
  }
  return [...assignedUsers, current];
}
