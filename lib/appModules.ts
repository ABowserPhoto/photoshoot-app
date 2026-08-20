/**
 * App modules that can be granted to Staff via `profiles.accessible_modules`.
 * Admins always have full access and ignore this list.
 */
export const APP_MODULES = [
  "planner",
  "workflow",
  "social_scheduler",
  "ai_studio",
  "moodboard",
  "notes",
  "scripts",
  "booking",
  "statistics",
  "crm",
] as const;

export type AppModule = (typeof APP_MODULES)[number];

export const APP_MODULE_LABELS: Record<AppModule, string> = {
  planner: "Planner",
  workflow: "Workflow",
  social_scheduler: "Social Scheduler",
  ai_studio: "AI Studio",
  moodboard: "Moodboard",
  notes: "Notes",
  scripts: "Scripts",
  booking: "Booking",
  statistics: "Statistics",
  crm: "CRM",
};

/** Default modules backfilled for existing Staff (pre-permissions era). */
export const DEFAULT_STAFF_MODULES: AppModule[] = [
  "planner",
  "workflow",
  "social_scheduler",
  "ai_studio",
  "moodboard",
  "notes",
  "scripts",
  "booking",
];

const MODULE_SET = new Set<string>(APP_MODULES);

export function isAppModule(value: unknown): value is AppModule {
  return typeof value === "string" && MODULE_SET.has(value);
}

export function normalizeAccessibleModules(value: unknown): AppModule[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<AppModule>();
  const result: AppModule[] = [];
  for (const item of value) {
    if (!isAppModule(item) || seen.has(item)) continue;
    seen.add(item);
    result.push(item);
  }
  return result;
}

export function canAccessModule(params: {
  isAdmin: boolean;
  accessibleModules: readonly AppModule[] | null | undefined;
  module: AppModule;
}): boolean {
  if (params.isAdmin) {
    return true;
  }
  return (params.accessibleModules ?? []).includes(params.module);
}

/** Preferred landing order when redirecting a restricted user. */
const MODULE_HOME_PRIORITY: AppModule[] = [
  "planner",
  "workflow",
  "booking",
  "social_scheduler",
  "ai_studio",
  "moodboard",
  "notes",
  "scripts",
  "statistics",
  "crm",
];

export function hrefForModule(module: AppModule): string {
  switch (module) {
    case "planner":
      return "/planner";
    case "workflow":
      return "/kanban";
    case "social_scheduler":
      return "/scheduler";
    case "ai_studio":
      return "/ai-studio";
    case "moodboard":
      return "/moodboard";
    case "notes":
      return "/notes";
    case "scripts":
      return "/scripts";
    case "booking":
      return "/?booking=1";
    case "statistics":
      return "/admin/statistics";
    case "crm":
      return "/admin/crm";
    default: {
      const _exhaustive: never = module;
      return _exhaustive;
    }
  }
}

export function firstAccessibleHref(params: {
  isAdmin: boolean;
  accessibleModules: readonly AppModule[] | null | undefined;
}): string {
  if (params.isAdmin) {
    return "/planner";
  }
  const granted = new Set(params.accessibleModules ?? []);
  for (const module of MODULE_HOME_PRIORITY) {
    if (granted.has(module)) {
      return hrefForModule(module);
    }
  }
  // Staff with no modules can still use the clock widget.
  return "/desktop-widget";
}

/**
 * Maps a pathname (+ optional search) to the module that guards it, or null
 * if the route is not module-gated (login, gallery, desktop-widget, etc.).
 */
export function moduleForPathname(pathname: string, search = ""): AppModule | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const bookingIntent = params.get("booking") === "1";

  if (pathname === "/planner" || pathname.startsWith("/planner/")) {
    return "planner";
  }
  // Booking opens on the workflow board; prefer booking when explicitly requested.
  if (
    bookingIntent &&
    (pathname === "/" || pathname === "/kanban" || pathname.startsWith("/kanban/"))
  ) {
    return "booking";
  }
  if (pathname === "/" || pathname === "/kanban" || pathname.startsWith("/kanban/")) {
    return "workflow";
  }
  if (pathname === "/scheduler" || pathname.startsWith("/scheduler/")) {
    return "social_scheduler";
  }
  if (pathname === "/ai-studio" || pathname.startsWith("/ai-studio/")) {
    return "ai_studio";
  }
  if (pathname === "/moodboard" || pathname.startsWith("/moodboard/")) {
    return "moodboard";
  }
  if (pathname === "/notes" || pathname.startsWith("/notes/")) {
    return "notes";
  }
  if (pathname === "/scripts" || pathname.startsWith("/scripts/")) {
    return "scripts";
  }
  if (pathname === "/admin/statistics" || pathname.startsWith("/admin/statistics/")) {
    return "statistics";
  }
  if (pathname === "/admin/crm" || pathname.startsWith("/admin/crm/")) {
    return "crm";
  }
  return null;
}

/** Workflow board is shared by workflow + booking modules. */
export function canAccessPathname(params: {
  isAdmin: boolean;
  accessibleModules: readonly AppModule[] | null | undefined;
  pathname: string;
  search?: string;
}): boolean {
  if (params.isAdmin) {
    return true;
  }
  const module = moduleForPathname(params.pathname, params.search ?? "");
  if (!module) {
    return true;
  }
  if (module === "workflow" || module === "booking") {
    return (
      canAccessModule({ ...params, module: "workflow" }) ||
      canAccessModule({ ...params, module: "booking" })
    );
  }
  return canAccessModule({ ...params, module });
}
