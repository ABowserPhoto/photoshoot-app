export type UserRole = "admin" | "editor";

export function normalizeRole(value: unknown): UserRole {
  const s = String(value ?? "")
    .trim()
    .toLowerCase();
  if (s === "admin") {
    return "admin";
  }
  return "editor";
}

export function isAdminRole(role: UserRole): boolean {
  return role === "admin";
}
