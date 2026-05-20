"use server";

import { createClient } from "@supabase/supabase-js";

import { getAuthRole } from "@/lib/server/getAuthRole";

export type ProductivityTimeframe = "day" | "week" | "month" | "year";

export type ProductivityBucket = {
  key: string;
  label: string;
  totalClockedInMinutes: number;
  totalTaskMinutes: number;
  utilizationRate: number;
  totalTasksCompleted: number;
  tasksCompleted: number;
  studioTasksCompleted: number;
  averageTaskDuration: number;
};

export type ProductivitySummary = {
  totalClockedInMinutes: number;
  totalTaskMinutes: number;
  utilizationRate: number;
  totalTasksCompleted: number;
  averageTaskDuration: number;
};

export type ProductivityDailyLog = {
  id: string;
  date: string;
  userId: string;
  userName: string;
  clockInAt: string | null;
  clockOutAt: string | null;
  shiftDurationMinutes: number;
  tasksCompleted: number;
  studioTasksCompleted: number;
  taskMinutes: number;
};

export type ProductivityTeamUser = {
  id: string;
  name: string;
  email: string | null;
};

type TimeSlot = {
  key: string;
  label: string;
  start: Date;
  end: Date;
};

type ShiftRow = {
  id: string;
  user_id: string;
  clock_in_at: string;
  clock_out_at: string | null;
  duration_minutes: number | null;
};

type TaskRow = Record<string, unknown>;
type StudioTaskRow = Record<string, unknown>;

function serviceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const key = serviceKey || anonKey;
  if (!url || !key) {
    return null;
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isKanbanTaskCompleted(status: unknown): boolean {
  const normalized = String(status ?? "")
    .trim()
    .toLowerCase();
  return normalized === "completed" || normalized === "send email" || normalized === "send-email";
}

function kanbanTaskEditMinutes(row: TaskRow): number {
  const fromAccumulator = toNumber(row.total_editing_seconds);
  if (fromAccumulator !== null && fromAccumulator > 0) {
    return fromAccumulator / 60;
  }

  const startedAt = parseDate(row.editing_started_at);
  const end =
    parseDate(row.ready_for_review_at) ?? parseDate(row.completed_at) ?? parseDate(row.updated_at);
  if (!startedAt || !end || end.getTime() < startedAt.getTime()) {
    return 0;
  }
  return (end.getTime() - startedAt.getTime()) / 60_000;
}

function studioTaskEditMinutes(row: StudioTaskRow): number {
  const seconds = toNumber(row.elapsed_seconds);
  return seconds && seconds > 0 ? seconds / 60 : 0;
}

function taskCompletedAt(row: TaskRow): Date | null {
  return parseDate(row.completed_at) ?? parseDate(row.updated_at);
}

function studioTaskCompletedAt(row: StudioTaskRow): Date | null {
  return parseDate(row.completed_at);
}

function taskEditorId(row: TaskRow): string | null {
  const id = row.editor_id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

function studioEditorId(row: StudioTaskRow): string | null {
  const id = row.editor_id;
  if (typeof id === "string" && id.trim()) {
    return id.trim();
  }
  const legacy = row.assigned_to;
  return typeof legacy === "string" && legacy.trim() ? legacy.trim() : null;
}

function shiftDurationMinutes(row: ShiftRow): number {
  if (row.duration_minutes !== null && row.duration_minutes !== undefined) {
    const n = Number(row.duration_minutes);
    if (Number.isFinite(n) && n >= 0) {
      return n;
    }
  }
  const start = parseDate(row.clock_in_at);
  const end = parseDate(row.clock_out_at) ?? new Date();
  if (!start) {
    return 0;
  }
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
}

function utilizationRate(taskMinutes: number, clockedMinutes: number): number {
  if (clockedMinutes <= 0) {
    return 0;
  }
  return Math.round((taskMinutes / clockedMinutes) * 1000) / 10;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function buildTimeSlots(timeframe: ProductivityTimeframe, now = new Date()): {
  rangeStart: Date;
  rangeEnd: Date;
  slots: TimeSlot[];
} {
  if (timeframe === "day") {
    const rangeStart = new Date(now);
    rangeStart.setHours(0, 0, 0, 0);
    const rangeEnd = new Date(now);
    rangeEnd.setHours(23, 59, 59, 999);
    const slots: TimeSlot[] = [];
    for (let hour = 0; hour < 24; hour += 1) {
      const start = new Date(rangeStart);
      start.setHours(hour, 0, 0, 0);
      const end = new Date(start);
      end.setHours(hour, 59, 59, 999);
      slots.push({
        key: `hour-${hour}`,
        label: `${String(hour).padStart(2, "0")}:00`,
        start,
        end,
      });
    }
    return { rangeStart, rangeEnd, slots };
  }

  if (timeframe === "week") {
    const rangeEnd = new Date(now);
    rangeEnd.setHours(23, 59, 59, 999);
    const rangeStart = new Date(now);
    rangeStart.setDate(rangeStart.getDate() - 6);
    rangeStart.setHours(0, 0, 0, 0);
    const slots: TimeSlot[] = [];
    for (let i = 0; i < 7; i += 1) {
      const start = new Date(rangeStart);
      start.setDate(rangeStart.getDate() + i);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);
      slots.push({
        key: dateKey(start),
        label: new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit", month: "short" }).format(
          start
        ),
        start,
        end,
      });
    }
    return { rangeStart, rangeEnd, slots };
  }

  if (timeframe === "month") {
    const rangeStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const rangeEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    const slots: TimeSlot[] = [];
    const cursor = new Date(rangeStart);
    while (cursor <= rangeEnd) {
      const start = new Date(cursor);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);
      slots.push({
        key: dateKey(start),
        label: new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" }).format(start),
        start,
        end,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    return { rangeStart, rangeEnd, slots };
  }

  const year = now.getFullYear();
  const rangeStart = new Date(year, 0, 1, 0, 0, 0, 0);
  const rangeEnd = new Date(year, 11, 31, 23, 59, 59, 999);
  const slots: TimeSlot[] = [];
  for (let month = 0; month < 12; month += 1) {
    const start = new Date(year, month, 1, 0, 0, 0, 0);
    const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
    slots.push({
      key: monthKey(start),
      label: new Intl.DateTimeFormat("en-GB", { month: "short" }).format(start),
      start,
      end,
    });
  }
  return { rangeStart, rangeEnd, slots };
}

function findSlotKey(timeframe: ProductivityTimeframe, slots: TimeSlot[], at: Date): string | null {
  if (timeframe === "year") {
    return monthKey(at);
  }
  if (timeframe === "day") {
    return `hour-${at.getHours()}`;
  }
  const match = slots.find((slot) => at >= slot.start && at <= slot.end);
  return match?.key ?? dateKey(at);
}

function isWithinRange(at: Date | null, start: Date, end: Date): at is Date {
  return Boolean(at && at >= start && at <= end);
}

function isWithinShift(at: Date | null, shift: ShiftRow): at is Date {
  const start = parseDate(shift.clock_in_at);
  if (!start || !at) {
    return false;
  }
  const end = parseDate(shift.clock_out_at) ?? new Date();
  return at >= start && at <= end;
}

async function assertAdmin(): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await getAuthRole();
  if (!auth.authenticated || !auth.isAdmin) {
    return { ok: false, error: "Forbidden" };
  }
  return { ok: true };
}

async function loadProfileMap(
  sb: ReturnType<typeof createClient>
): Promise<Map<string, { name: string; email: string | null }>> {
  const { data } = await sb.from("profiles").select("id, full_name, email");
  const map = new Map<string, { name: string; email: string | null }>();
  for (const row of data ?? []) {
    const r = row as { id: unknown; full_name: unknown; email: unknown };
    const id = String(r.id ?? "").trim();
    if (!id) {
      continue;
    }
    const name =
      (typeof r.full_name === "string" && r.full_name.trim()) ||
      (typeof r.email === "string" && r.email.trim()) ||
      id.slice(0, 8);
    map.set(id, {
      name,
      email: typeof r.email === "string" ? r.email : null,
    });
  }
  return map;
}

export async function getProductivityTeamUsers(): Promise<
  { ok: true; users: ProductivityTeamUser[] } | { ok: false; error: string }
> {
  const admin = await assertAdmin();
  if (!admin.ok) {
    return admin;
  }

  const sb = serviceSupabase();
  if (!sb) {
    return { ok: false, error: "Database is not configured." };
  }

  const profileMap = await loadProfileMap(sb);
  const users = [...profileMap.entries()]
    .map(([id, profile]) => ({
      id,
      name: profile.name,
      email: profile.email,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { ok: true, users };
}

export async function getProductivityStats(
  timeframe: ProductivityTimeframe,
  userId?: string
): Promise<
  | {
      ok: true;
      summary: ProductivitySummary;
      buckets: ProductivityBucket[];
      dailyLogs: ProductivityDailyLog[];
    }
  | { ok: false; error: string }
> {
  const admin = await assertAdmin();
  if (!admin.ok) {
    return admin;
  }

  const sb = serviceSupabase();
  if (!sb) {
    return { ok: false, error: "Database is not configured." };
  }

  const now = new Date();
  const { rangeStart, rangeEnd, slots } = buildTimeSlots(timeframe, now);
  const filterUserId = userId?.trim() || null;

  let shiftsQuery = sb
    .from("user_shifts")
    .select("id, user_id, clock_in_at, clock_out_at, duration_minutes")
    .gte("clock_in_at", rangeStart.toISOString())
    .lte("clock_in_at", rangeEnd.toISOString());

  let tasksQuery = sb
    .from("tasks")
    .select(
      "id, title, status, editor_id, total_editing_seconds, editing_started_at, completed_at, ready_for_review_at, updated_at"
    )
    .gte("completed_at", rangeStart.toISOString())
    .lte("completed_at", rangeEnd.toISOString());

  let studioQuery = sb
    .from("studio_tasks")
    .select("id, title, status, editor_id, assigned_to, elapsed_seconds, completed_at")
    .eq("status", "completed")
    .gte("completed_at", rangeStart.toISOString())
    .lte("completed_at", rangeEnd.toISOString());

  if (filterUserId) {
    shiftsQuery = shiftsQuery.eq("user_id", filterUserId);
    tasksQuery = tasksQuery.eq("editor_id", filterUserId);
    studioQuery = studioQuery.or(`editor_id.eq.${filterUserId},assigned_to.eq.${filterUserId}`);
  }

  const [shiftsRes, tasksRes, studioRes, profileMap] = await Promise.all([
    shiftsQuery,
    tasksQuery,
    studioQuery,
    loadProfileMap(sb),
  ]);

  if (shiftsRes.error) {
    return { ok: false, error: shiftsRes.error.message };
  }
  if (tasksRes.error) {
    return { ok: false, error: tasksRes.error.message };
  }
  if (studioRes.error) {
    return { ok: false, error: studioRes.error.message };
  }

  const shifts = (shiftsRes.data ?? []) as ShiftRow[];
  const kanbanTasks = ((tasksRes.data ?? []) as TaskRow[]).filter((row) => isKanbanTaskCompleted(row.status));
  const studioTasks = (studioRes.data ?? []) as StudioTaskRow[];

  const bucketState = new Map<string, ProductivityBucket>();
  for (const slot of slots) {
    bucketState.set(slot.key, {
      key: slot.key,
      label: slot.label,
      totalClockedInMinutes: 0,
      totalTaskMinutes: 0,
      utilizationRate: 0,
      totalTasksCompleted: 0,
      tasksCompleted: 0,
      studioTasksCompleted: 0,
      averageTaskDuration: 0,
    });
  }

  const bucketTaskDurations = new Map<string, number[]>();

  for (const shift of shifts) {
    const clockIn = parseDate(shift.clock_in_at);
    if (!clockIn) {
      continue;
    }
    const slotKey = findSlotKey(timeframe, slots, clockIn);
    if (!slotKey) {
      continue;
    }
    const bucket = bucketState.get(slotKey);
    if (!bucket) {
      continue;
    }
    bucket.totalClockedInMinutes += shiftDurationMinutes(shift);
  }

  for (const row of kanbanTasks) {
    const completedAt = taskCompletedAt(row);
    if (!isWithinRange(completedAt, rangeStart, rangeEnd)) {
      continue;
    }
    if (filterUserId && taskEditorId(row) !== filterUserId) {
      continue;
    }
    const slotKey = findSlotKey(timeframe, slots, completedAt);
    if (!slotKey) {
      continue;
    }
    const bucket = bucketState.get(slotKey);
    if (!bucket) {
      continue;
    }
    const minutes = kanbanTaskEditMinutes(row);
    bucket.totalTaskMinutes += minutes;
    bucket.totalTasksCompleted += 1;
    bucket.tasksCompleted += 1;
    const durations = bucketTaskDurations.get(slotKey) ?? [];
    if (minutes > 0) {
      durations.push(minutes);
    }
    bucketTaskDurations.set(slotKey, durations);
  }

  for (const row of studioTasks) {
    const completedAt = studioTaskCompletedAt(row);
    if (!isWithinRange(completedAt, rangeStart, rangeEnd)) {
      continue;
    }
    if (filterUserId && studioEditorId(row) !== filterUserId) {
      continue;
    }
    const slotKey = findSlotKey(timeframe, slots, completedAt);
    if (!slotKey) {
      continue;
    }
    const bucket = bucketState.get(slotKey);
    if (!bucket) {
      continue;
    }
    const minutes = studioTaskEditMinutes(row);
    bucket.totalTaskMinutes += minutes;
    bucket.totalTasksCompleted += 1;
    bucket.studioTasksCompleted += 1;
    const durations = bucketTaskDurations.get(slotKey) ?? [];
    if (minutes > 0) {
      durations.push(minutes);
    }
    bucketTaskDurations.set(slotKey, durations);
  }

  const buckets = slots.map((slot) => {
    const bucket = bucketState.get(slot.key)!;
    bucket.utilizationRate = utilizationRate(bucket.totalTaskMinutes, bucket.totalClockedInMinutes);
    bucket.averageTaskDuration = average(bucketTaskDurations.get(slot.key) ?? []);
    return bucket;
  });

  const summary: ProductivitySummary = {
    totalClockedInMinutes: buckets.reduce((sum, bucket) => sum + bucket.totalClockedInMinutes, 0),
    totalTaskMinutes: buckets.reduce((sum, bucket) => sum + bucket.totalTaskMinutes, 0),
    totalTasksCompleted: buckets.reduce((sum, bucket) => sum + bucket.totalTasksCompleted, 0),
    utilizationRate: 0,
    averageTaskDuration: 0,
  };
  summary.utilizationRate = utilizationRate(summary.totalTaskMinutes, summary.totalClockedInMinutes);
  const allTaskDurations = [...bucketTaskDurations.values()].flat();
  summary.averageTaskDuration = average(allTaskDurations);

  const dailyLogs: ProductivityDailyLog[] = shifts
    .map((shift) => {
      const userIdValue = String(shift.user_id ?? "").trim();
      const profile = profileMap.get(userIdValue);
      const shiftStart = parseDate(shift.clock_in_at);
      const shiftEnd = parseDate(shift.clock_out_at);

      let tasksCompleted = 0;
      let studioTasksCompleted = 0;
      let taskMinutes = 0;

      for (const row of kanbanTasks) {
        const completedAt = taskCompletedAt(row);
        const editor = taskEditorId(row);
        if (!isWithinShift(completedAt, shift)) {
          continue;
        }
        if (editor && editor !== userIdValue) {
          continue;
        }
        if (!editor && filterUserId && filterUserId !== userIdValue) {
          continue;
        }
        tasksCompleted += 1;
        taskMinutes += kanbanTaskEditMinutes(row);
      }

      for (const row of studioTasks) {
        const completedAt = studioTaskCompletedAt(row);
        const editor = studioEditorId(row);
        if (!isWithinShift(completedAt, shift)) {
          continue;
        }
        if (editor && editor !== userIdValue) {
          continue;
        }
        if (!editor && filterUserId && filterUserId !== userIdValue) {
          continue;
        }
        studioTasksCompleted += 1;
        taskMinutes += studioTaskEditMinutes(row);
      }

      return {
        id: shift.id,
        date: shiftStart ? dateKey(shiftStart) : "",
        userId: userIdValue,
        userName: profile?.name ?? (userIdValue.slice(0, 8) || "Unknown"),
        clockInAt: shift.clock_in_at ?? null,
        clockOutAt: shift.clock_out_at ?? null,
        shiftDurationMinutes: shiftDurationMinutes(shift),
        tasksCompleted,
        studioTasksCompleted,
        taskMinutes: Math.round(taskMinutes * 10) / 10,
      };
    })
    .sort((a, b) => {
      const aTime = parseDate(a.clockInAt)?.getTime() ?? 0;
      const bTime = parseDate(b.clockInAt)?.getTime() ?? 0;
      return bTime - aTime;
    });

  return { ok: true, summary, buckets, dailyLogs };
}
