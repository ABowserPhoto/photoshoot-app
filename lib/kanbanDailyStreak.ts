export type KanbanStreakTask = {
  id: string;
  status: string;
  completedAt?: string | null;
  updatedAt?: string | null;
};

export type KanbanBoardState = Record<string, KanbanStreakTask[]>;

export const KANBAN_STREAK_COLUMNS = new Set(["send-email", "completed"]);

export function isSameLocalDay(isoTimestamp: string, reference: Date = new Date()): boolean {
  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }
  return (
    parsed.getFullYear() === reference.getFullYear() &&
    parsed.getMonth() === reference.getMonth() &&
    parsed.getDate() === reference.getDate()
  );
}

export function countTodayCompletions(
  board: KanbanBoardState,
  archivedTasks: KanbanStreakTask[],
  options?: { justCompletedTaskId?: string }
): number {
  const seen = new Set<string>();
  let count = 0;

  const consider = (task: KanbanStreakTask) => {
    if (seen.has(task.id)) {
      return;
    }
    seen.add(task.id);

    if (!KANBAN_STREAK_COLUMNS.has(task.status)) {
      return;
    }

    if (task.id === options?.justCompletedTaskId) {
      count += 1;
      return;
    }

    const timestamp = task.completedAt ?? task.updatedAt;
    if (timestamp && isSameLocalDay(timestamp)) {
      count += 1;
    }
  };

  for (const column of KANBAN_STREAK_COLUMNS) {
    for (const task of board[column] ?? []) {
      consider(task);
    }
  }

  for (const task of archivedTasks) {
    consider(task);
  }

  if (options?.justCompletedTaskId && !seen.has(options.justCompletedTaskId)) {
    count += 1;
  }

  return count;
}
