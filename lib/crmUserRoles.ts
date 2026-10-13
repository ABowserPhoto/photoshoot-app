import { normalizeRole, type UserRole } from "@/lib/authRole";

export type CrmAssignableRole = UserRole;

export function normalizeAssignableRole(value: unknown): CrmAssignableRole | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();

  if (normalized === "admin") {
    return "admin";
  }
  if (normalized === "staff" || normalized === "editor") {
    return "editor";
  }

  return null;
}

export function formatCrmUserRole(value: unknown): string {
  return normalizeRole(value) === "admin" ? "Admin" : "Staff";
}

export function crmRoleFormValue(value: unknown): "admin" | "staff" {
  return normalizeAssignableRole(value) === "admin" ? "admin" : "staff";
}

function normalizedRole(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

export function isExternalClientRole(value: unknown): boolean {
  return normalizedRole(value) === "client";
}

export function isInternalStaffRole(value: unknown): boolean {
  const role = normalizedRole(value);
  return role === "admin" || role === "editor" || role === "staff";
}

/** User Management lists staff and admins. Website signups belong in Client Manager. */
export function isInternalCrmUser(input: {
  profileRole: unknown;
  metadataRole: unknown;
  hasClientRecord: boolean;
}): boolean {
  if (input.hasClientRecord) {
    return false;
  }
  if (isExternalClientRole(input.profileRole) || isExternalClientRole(input.metadataRole)) {
    return false;
  }
  return isInternalStaffRole(input.profileRole ?? input.metadataRole);
}
