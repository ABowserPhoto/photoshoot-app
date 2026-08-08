export const SCRIPT_STATUSES = ["Idea", "Drafting", "Ready", "In Production"] as const;

export type ScriptStatus = (typeof SCRIPT_STATUSES)[number];

export function normalizeScriptStatus(value: unknown): ScriptStatus {
  const raw = typeof value === "string" ? value.trim() : "";
  if ((SCRIPT_STATUSES as readonly string[]).includes(raw)) {
    return raw as ScriptStatus;
  }
  return "Idea";
}

export function formatScriptProjectLabel(task: {
  title?: string | null;
  company_name?: string | null;
  photoshoot_type?: string | null;
  shoot_location?: string | null;
}): string {
  const parts = [
    task.photoshoot_type?.trim(),
    task.company_name?.trim(),
    task.shoot_location?.trim(),
  ].filter(Boolean) as string[];
  if (parts.length > 0) {
    return parts.join(" · ");
  }
  return task.title?.trim() || "Untitled project";
}
