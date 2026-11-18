export type PlannerAssignee = {
  id: string;
  name: string;
  avatar?: string;
  /**
   * `profiles.role` for picker options loaded from the directory.
   * Omitted when an assignee is saved on a task.
   */
  role?: string | null;
  /** Present only on directory rows. Archived profiles are not selectable. */
  is_archived?: boolean | null;
};

function normalizedProfileRole(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

/** True when `profiles.role` is the external client login, ignoring case and surrounding space. */
export function isClientProfileRole(value: unknown): boolean {
  return normalizedProfileRole(value) === "client";
}

/**
 * Active staff and team profiles that may appear in planner user pickers.
 * Client logins and archived profiles are excluded. Every other role
 * (admin, staff, editor, team, owner, and similar) stays selectable.
 */
export function isSelectablePlannerStaffProfile(profile: {
  role?: unknown;
  is_archived?: boolean | null;
}): boolean {
  if (profile.is_archived === true) return false;
  if (isClientProfileRole(profile.role)) return false;
  return true;
}

export function filterPlannerStaffProfiles<
  T extends { role?: unknown; is_archived?: boolean | null },
>(rows: readonly T[]): T[] {
  return rows.filter((row) => isSelectablePlannerStaffProfile(row));
}

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

/**
 * Adds the signed-in creator to `assigned_users` when they are neither the
 * primary assignee nor an existing collaborator.
 * Pass `includeCreator: false` for admins so their assignee lists stay unchanged.
 */
export function appendCreatorCollaboratorIfMissing(
  assignedUsers: PlannerAssignee[],
  creator: PlannerAssignee | null,
  options?: {
    assignedTo?: string | null;
    includeCreator?: boolean;
  }
): PlannerAssignee[] {
  if (options?.includeCreator === false) {
    return assignedUsers;
  }
  const creatorId = creator?.id?.trim() ?? "";
  if (!creatorId) {
    return assignedUsers;
  }
  const primaryId = typeof options?.assignedTo === "string" ? options.assignedTo.trim() : "";
  if (primaryId === creatorId) {
    return assignedUsers;
  }
  const normalizedCreator: PlannerAssignee =
    creator && creator.id === creatorId
      ? creator
      : {
          id: creatorId,
          name: creator?.name?.trim() || "You",
          ...(creator?.avatar ? { avatar: creator.avatar } : {}),
        };
  return appendCurrentUserIfMissing(assignedUsers, normalizedCreator);
}

/**
 * True when there is no primary assignee and no collaborators.
 */
export function isStudioTaskUnassigned(params: {
  assignedTo?: string | null;
  assignedUsers?: PlannerAssignee[] | unknown;
}): boolean {
  const assignedTo =
    typeof params.assignedTo === "string" && params.assignedTo.trim()
      ? params.assignedTo.trim()
      : "";
  if (assignedTo) return false;

  const users = Array.isArray(params.assignedUsers)
    ? parseAssignedUsers(params.assignedUsers)
    : [];
  return users.length === 0;
}

/**
 * True when the user is the primary assignee (`assigned_to`) or listed in `assigned_users`.
 */
export function isUserOnStudioTask(params: {
  userId: string | null | undefined;
  assignedTo?: string | null;
  assignedUsers?: PlannerAssignee[] | unknown;
}): boolean {
  const userId = typeof params.userId === "string" ? params.userId.trim() : "";
  if (!userId) return false;

  const assignedTo =
    typeof params.assignedTo === "string" && params.assignedTo.trim()
      ? params.assignedTo.trim()
      : "";
  if (assignedTo === userId) return true;

  const users = Array.isArray(params.assignedUsers)
    ? parseAssignedUsers(params.assignedUsers)
    : [];
  return users.some((u) => u.id === userId);
}

/** Ensures the primary assignee is present in the collaborators list (for avatars / visibility). */
export function ensurePrimaryInAssignedUsers(
  assignedTo: string | null | undefined,
  assignedUsers: PlannerAssignee[],
  options: PlannerAssignee[]
): PlannerAssignee[] {
  const primaryId = typeof assignedTo === "string" ? assignedTo.trim() : "";
  if (!primaryId) return assignedUsers;
  if (assignedUsers.some((u) => u.id === primaryId)) return assignedUsers;
  const fromOptions = options.find((u) => u.id === primaryId);
  return [...assignedUsers, fromOptions ?? { id: primaryId, name: "Assignee" }];
}
