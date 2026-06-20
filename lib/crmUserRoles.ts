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
