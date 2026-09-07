"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Pencil, Trash2 } from "lucide-react";

import { adminDeleteShifts, adminUpdateShift } from "@/app/actions/shifts";
import type { ProductivityDailyLog, ProductivityShiftLog } from "@/app/actions/statistics";
import EditShiftModal from "@/app/components/statistics/EditShiftModal";

type SortKey =
  | "date"
  | "userName"
  | "clockInAt"
  | "clockOutAt"
  | "shiftDurationMinutes"
  | "tasksCompleted"
  | "studioTasksCompleted"
  | "taskMinutes";

function formatMinutesShort(totalMinutes: number): string {
  const safe = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  if (hours === 0) {
    return `${minutes}m`;
  }
  return `${hours}h ${minutes}m`;
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

type EditTarget = {
  mode: "day" | "shift";
  title: string;
  subtitle?: string;
  userName: string;
  date: string;
  clockInAt: string | null;
  clockOutAt: string | null;
  earliestShiftId: string;
  latestShiftId: string;
  earliestClockOutAt: string | null;
  latestClockInAt: string | null;
};

export default function DailyShiftLogs({
  dailyLogs,
  loading,
  isAdmin,
  reportingPeriodLabel,
  onChanged,
}: {
  dailyLogs: ProductivityDailyLog[];
  loading: boolean;
  isAdmin: boolean;
  reportingPeriodLabel: string;
  onChanged: () => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("clockInAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const sortedLogs = useMemo(() => {
    const rows = [...dailyLogs];
    rows.sort((a, b) => {
      const pick = (row: ProductivityDailyLog): string | number => {
        switch (sortKey) {
          case "date":
            return row.date;
          case "userName":
            return row.userName.toLowerCase();
          case "clockInAt":
            return row.clockInAt ? new Date(row.clockInAt).getTime() : 0;
          case "clockOutAt":
            return row.clockOutAt ? new Date(row.clockOutAt).getTime() : 0;
          case "shiftDurationMinutes":
            return row.shiftDurationMinutes;
          case "tasksCompleted":
            return row.tasksCompleted;
          case "studioTasksCompleted":
            return row.studioTasksCompleted;
          case "taskMinutes":
            return row.taskMinutes;
          default:
            return 0;
        }
      };
      const av = pick(a);
      const bv = pick(b);
      if (av === bv) {
        return 0;
      }
      if (av < bv) {
        return sortDir === "asc" ? -1 : 1;
      }
      return sortDir === "asc" ? 1 : -1;
    });
    return rows;
  }, [dailyLogs, sortDir, sortKey]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir("desc");
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const openDayEdit = (row: ProductivityDailyLog) => {
    const shifts = row.shifts.length > 0 ? row.shifts : [];
    if (shifts.length === 0) {
      return;
    }
    const earliest = shifts[0];
    const latest = shifts[shifts.length - 1];
    setEditError(null);
    setEditTarget({
      mode: "day",
      title: "Edit daily shift window",
      subtitle:
        shifts.length > 1
          ? `${shifts.length} sub-shifts — saving updates first clock-in and last clock-out`
          : undefined,
      userName: row.userName,
      date: row.date,
      clockInAt: row.clockInAt,
      clockOutAt: row.clockOutAt,
      earliestShiftId: earliest.id,
      latestShiftId: latest.id,
      earliestClockOutAt: earliest.clockOutAt,
      latestClockInAt: latest.clockInAt,
    });
  };

  const openShiftEdit = (row: ProductivityDailyLog, shift: ProductivityShiftLog) => {
    setEditError(null);
    setEditTarget({
      mode: "shift",
      title: "Edit sub-shift",
      userName: row.userName,
      date: row.date,
      clockInAt: shift.clockInAt,
      clockOutAt: shift.clockOutAt,
      earliestShiftId: shift.id,
      latestShiftId: shift.id,
      earliestClockOutAt: shift.clockOutAt,
      latestClockInAt: shift.clockInAt,
    });
  };

  const handleSave = async (clockInAt: string, clockOutAt: string | null) => {
    if (!editTarget) {
      return;
    }
    setSaving(true);
    setEditError(null);
    try {
      if (editTarget.earliestShiftId === editTarget.latestShiftId) {
        const result = await adminUpdateShift(editTarget.earliestShiftId, clockInAt, clockOutAt);
        if (!result.ok) {
          setEditError(result.error);
          return;
        }
      } else {
        const startResult = await adminUpdateShift(
          editTarget.earliestShiftId,
          clockInAt,
          editTarget.earliestClockOutAt
        );
        if (!startResult.ok) {
          setEditError(startResult.error);
          return;
        }
        const latestClockIn = editTarget.latestClockInAt ?? clockInAt;
        const endResult = await adminUpdateShift(editTarget.latestShiftId, latestClockIn, clockOutAt);
        if (!endResult.ok) {
          setEditError(endResult.error);
          return;
        }
      }
      setEditTarget(null);
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (ids: string[], label: string, busyKey: string) => {
    if (
      !window.confirm(
        ids.length > 1
          ? `Delete ${ids.length} shifts for ${label}? This cannot be undone.`
          : `Delete this shift for ${label}? This cannot be undone.`
      )
    ) {
      return;
    }
    setBusyId(busyKey);
    try {
      const result = await adminDeleteShifts(ids);
      if (!result.ok) {
        window.alert(result.error);
        return;
      }
      onChanged();
    } finally {
      setBusyId(null);
    }
  };

  const columns = [
    ["date", "Date"],
    ["userName", "User"],
    ["clockInAt", "First Clock-in"],
    ["clockOutAt", "Last Clock-out"],
    ["shiftDurationMinutes", "Total Shift Duration"],
    ["tasksCompleted", "Tasks"],
    ["studioTasksCompleted", "Studio"],
    ["taskMinutes", "Task time"],
  ] as const;

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
      <h2 className="text-sm font-semibold text-zinc-100">Daily shift logs</h2>
      <p className="mt-1 text-xs text-zinc-500">
        One row per person per day for {reportingPeriodLabel}. Expand a row to see individual
        sub-shifts.
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
              {columns.map(([key, label]) => (
                <th key={key} className="px-3 py-2 font-semibold">
                  <button
                    type="button"
                    onClick={() => toggleSort(key)}
                    className="inline-flex items-center gap-1 hover:text-zinc-200"
                  >
                    {label}
                    {sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : null}
                  </button>
                </th>
              ))}
              {isAdmin ? <th className="px-3 py-2 font-semibold">Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {sortedLogs.length === 0 ? (
              <tr>
                <td colSpan={isAdmin ? 9 : 8} className="px-3 py-8 text-center text-zinc-500">
                  {loading ? "Loading shift logs…" : "No shift logs in this timeframe."}
                </td>
              </tr>
            ) : (
              sortedLogs.map((row) => {
                const expandable = row.shiftCount > 1;
                const expanded = expandedIds.has(row.id);
                return (
                  <ShiftGroupRows
                    key={row.id}
                    row={row}
                    expandable={expandable}
                    expanded={expanded}
                    isAdmin={isAdmin}
                    busyId={busyId}
                    onToggle={() => toggleExpanded(row.id)}
                    onEditDay={() => openDayEdit(row)}
                    onEditShift={(shift) => openShiftEdit(row, shift)}
                    onDeleteDay={() =>
                      handleDelete(
                        row.shifts.map((shift) => shift.id),
                        `${row.userName} on ${row.date}`,
                        row.id
                      )
                    }
                    onDeleteShift={(shift) =>
                      handleDelete([shift.id], `${row.userName} on ${row.date}`, shift.id)
                    }
                  />
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <EditShiftModal
        isOpen={Boolean(editTarget)}
        title={editTarget?.title ?? "Edit shift"}
        subtitle={editTarget?.subtitle}
        userName={editTarget?.userName ?? ""}
        date={editTarget?.date ?? ""}
        clockInAt={editTarget?.clockInAt ?? null}
        clockOutAt={editTarget?.clockOutAt ?? null}
        isSaving={saving}
        error={editError}
        onCancel={() => {
          if (!saving) {
            setEditTarget(null);
            setEditError(null);
          }
        }}
        onSave={(clockInAt, clockOutAt) => void handleSave(clockInAt, clockOutAt)}
      />
    </section>
  );
}

function ShiftGroupRows({
  row,
  expandable,
  expanded,
  isAdmin,
  busyId,
  onToggle,
  onEditDay,
  onEditShift,
  onDeleteDay,
  onDeleteShift,
}: {
  row: ProductivityDailyLog;
  expandable: boolean;
  expanded: boolean;
  isAdmin: boolean;
  busyId: string | null;
  onToggle: () => void;
  onEditDay: () => void;
  onEditShift: (shift: ProductivityShiftLog) => void;
  onDeleteDay: () => void;
  onDeleteShift: (shift: ProductivityShiftLog) => void;
}) {
  return (
    <>
      <tr
        className={`border-b border-zinc-800/80 text-zinc-200 ${expandable ? "cursor-pointer hover:bg-zinc-900/80" : ""}`}
        onClick={expandable ? onToggle : undefined}
      >
        <td className="px-3 py-2">
          {expandable ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onToggle();
              }}
              className="inline-flex items-center gap-1.5 hover:text-white"
              aria-expanded={expanded}
            >
              {expanded ? (
                <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-zinc-400" />
              )}
              {row.date || "—"}
            </button>
          ) : (
            row.date || "—"
          )}
        </td>
        <td className="px-3 py-2">
          {expandable ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onToggle();
              }}
              className="hover:text-white"
            >
              {row.userName}
              <span className="ml-2 text-[11px] font-medium text-zinc-500">
                {row.shiftCount} shifts
              </span>
            </button>
          ) : (
            row.userName
          )}
        </td>
        <td className="px-3 py-2">{formatDateTime(row.clockInAt)}</td>
        <td className="px-3 py-2">{formatDateTime(row.clockOutAt)}</td>
        <td className="px-3 py-2">{formatMinutesShort(row.shiftDurationMinutes)}</td>
        <td className="px-3 py-2">{row.tasksCompleted}</td>
        <td className="px-3 py-2">{row.studioTasksCompleted}</td>
        <td className="px-3 py-2">{formatMinutesShort(row.taskMinutes)}</td>
        {isAdmin ? (
          <td className="px-3 py-2" onClick={(event) => event.stopPropagation()}>
            <RowActions
              disabled={busyId === row.id}
              onEdit={onEditDay}
              onDelete={onDeleteDay}
            />
          </td>
        ) : null}
      </tr>
      {expandable && expanded
        ? row.shifts.map((shift) => (
            <tr key={shift.id} className="border-b border-zinc-900 bg-zinc-950/60 text-zinc-300">
              <td className="px-3 py-2 pl-10 text-xs text-zinc-500">Sub-shift</td>
              <td className="px-3 py-2 text-xs">{shift.userName}</td>
              <td className="px-3 py-2">{formatDateTime(shift.clockInAt)}</td>
              <td className="px-3 py-2">{formatDateTime(shift.clockOutAt)}</td>
              <td className="px-3 py-2">{formatMinutesShort(shift.shiftDurationMinutes)}</td>
              <td className="px-3 py-2">{shift.tasksCompleted}</td>
              <td className="px-3 py-2">{shift.studioTasksCompleted}</td>
              <td className="px-3 py-2">{formatMinutesShort(shift.taskMinutes)}</td>
              {isAdmin ? (
                <td className="px-3 py-2">
                  <RowActions
                    disabled={busyId === shift.id}
                    onEdit={() => onEditShift(shift)}
                    onDelete={() => onDeleteShift(shift)}
                  />
                </td>
              ) : null}
            </tr>
          ))
        : null}
    </>
  );
}

function RowActions({
  disabled,
  onEdit,
  onDelete,
}: {
  disabled: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onEdit}
        disabled={disabled}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-white disabled:opacity-50"
        aria-label="Edit shift"
        title="Edit shift"
      >
        <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={disabled}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-700 text-zinc-300 hover:border-red-800 hover:bg-red-950/40 hover:text-red-300 disabled:opacity-50"
        aria-label="Delete shift"
        title="Delete shift"
      >
        <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
    </div>
  );
}
