/**
 * Decides whether a CRM client delete may also remove that client's Auth user.
 * Pure: callers must pass only the Auth user stored on this client's user_id.
 * Never resolve a login by email — a CRM email can match a staff account.
 */

/** Staff/bot login that must never be deleted, even if a client row uses the same email. */
export const PROTECTED_CLIENT_LOGIN_EMAILS = ["hisswiftness2003@yahoo.com"] as const;

const PRIVILEGED_ACCOUNT_ROLES = new Set([
  "admin",
  "administrator",
  "staff",
  "editor",
  "owner",
  "team",
  "bot",
  "superadmin",
  "super_admin",
  "super-admin",
  "manager",
  "employee",
  "internal",
]);

const ROLE_KEYS = ["role", "app_role", "user_role"] as const;

export type ClientLoginDecision =
  | { action: "none" }
  | { action: "delete-login" }
  | { action: "delete-profile-only" }
  | { action: "keep"; reason: string };

export type ClientLoginProfile = {
  role: unknown;
  email: unknown;
  isArchived: unknown;
  jibbleEmployeeId: unknown;
  accessibleModules: unknown;
};

export type ClientLoginAuthUser = {
  id: string;
  email: unknown;
  /** Roles read from app_metadata and user_metadata. Empty when unset. */
  roles: unknown[];
};

export type ClientLoginStaffUsage = {
  taskEditor: number;
  studioAssignment: number;
  shifts: number;
  messages: number;
  notes: number;
};

export type ClientLoginDeletionInput = {
  /** auth.users id stored on this client. Null when the CRM row has no login. */
  linkedUserId: string | null;
  /** Signed-in admin, when the session is a Supabase user. */
  callerUserId: string | null;
  /** Other client rows that still reference the same user id. */
  otherClientLinks: number;
  profile: ClientLoginProfile | null;
  authUser: ClientLoginAuthUser | null;
  staffUsage: ClientLoginStaffUsage;
};

export function normalizeAccountToken(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

export function isClientAccountRole(value: unknown): boolean {
  return normalizeAccountToken(value) === "client";
}

export function isPrivilegedAccountRole(value: unknown): boolean {
  const role = normalizeAccountToken(value);
  if (!role) {
    return false;
  }
  return PRIVILEGED_ACCOUNT_ROLES.has(role);
}

export function isProtectedClientLoginEmail(value: unknown): boolean {
  const email = normalizeAccountToken(value);
  return PROTECTED_CLIENT_LOGIN_EMAILS.some((protectedEmail) => protectedEmail === email);
}

export function collectAccountRoles(...sources: unknown[]): unknown[] {
  const roles: unknown[] = [];
  for (const source of sources) {
    if (!source || typeof source !== "object") {
      continue;
    }
    const record = source as Record<string, unknown>;
    for (const key of ROLE_KEYS) {
      if (key in record) {
        roles.push(record[key]);
      }
    }
  }
  return roles;
}

function hasStaffModules(value: unknown): boolean {
  if (value == null) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((item) => String(item ?? "").trim() !== "");
  }
  return true;
}

function hasJibbleLink(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

function usageBlocksDeletion(value: number): boolean {
  return !Number.isFinite(value) || value > 0;
}

function staffUsageBlocksDeletion(usage: ClientLoginStaffUsage): boolean {
  return (
    usageBlocksDeletion(usage.taskEditor) ||
    usageBlocksDeletion(usage.studioAssignment) ||
    usageBlocksDeletion(usage.shifts) ||
    usageBlocksDeletion(usage.messages) ||
    usageBlocksDeletion(usage.notes)
  );
}

/**
 * Allow deletion only for the Auth user linked to this client when the profile
 * role is exactly "client" and every staff signal is absent.
 */
export function decideClientLoginDeletion(input: ClientLoginDeletionInput): ClientLoginDecision {
  const linkedUserId = input.linkedUserId?.trim() ?? "";
  if (!linkedUserId) {
    return { action: "none" };
  }

  const callerUserId = input.callerUserId?.trim() ?? "";
  if (callerUserId && callerUserId === linkedUserId) {
    return {
      action: "keep",
      reason: "This login is the account you are signed in with and was not removed.",
    };
  }

  if (
    isProtectedClientLoginEmail(input.authUser?.email) ||
    isProtectedClientLoginEmail(input.profile?.email)
  ) {
    return {
      action: "keep",
      reason: "This login is a protected staff account and was not removed.",
    };
  }

  if (!Number.isFinite(input.otherClientLinks) || input.otherClientLinks > 0) {
    return {
      action: "keep",
      reason: "This login is still linked to another client and was not removed.",
    };
  }

  const profileRole = input.profile?.role;
  const authRoles = input.authUser?.roles ?? [];
  if (isPrivilegedAccountRole(profileRole) || authRoles.some((role) => isPrivilegedAccountRole(role))) {
    return {
      action: "keep",
      reason: "This login belongs to a staff, admin, owner, or team account and was not removed.",
    };
  }

  if (staffUsageBlocksDeletion(input.staffUsage)) {
    return {
      action: "keep",
      reason: "This login is still used by tasks, shifts, notes, or messages and was not removed.",
    };
  }

  if (
    input.profile?.isArchived === true ||
    hasJibbleLink(input.profile?.jibbleEmployeeId) ||
    hasStaffModules(input.profile?.accessibleModules)
  ) {
    return {
      action: "keep",
      reason: "This login has staff access and was not removed.",
    };
  }

  if (input.authUser && input.authUser.id !== linkedUserId) {
    return {
      action: "keep",
      reason: "The linked login does not match this client and was not removed.",
    };
  }

  if (!input.authUser) {
    if (input.profile && isClientAccountRole(profileRole)) {
      return { action: "delete-profile-only" };
    }
    if (!input.profile) {
      return { action: "none" };
    }
    return {
      action: "keep",
      reason: "This login has no client profile and was not removed.",
    };
  }

  if (!input.profile || !isClientAccountRole(profileRole)) {
    return {
      action: "keep",
      reason: "This login has no client profile and was not removed.",
    };
  }

  return { action: "delete-login" };
}
