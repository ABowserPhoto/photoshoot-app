"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";

type Recurring = "none" | "daily" | "weekly" | "monthly";
type KanbanColumnId = "task" | "in-progress" | "completed";

type SubTask = {
  id: string;
  title: string;
  done: boolean;
};

type PlannerTask = {
  id: string;
  title: string;
  description: string;
  recurring: Recurring;
  subTasks: SubTask[];
  elapsedSec: number;
  startedAtSec: number | null;
  totalTimeLabel: string | null;
  filePath: string;
  isPaused: boolean;
};

const COLUMN_META: Record<KanbanColumnId, { title: string }> = {
  task: { title: "Task" },
  "in-progress": { title: "In Progress" },
  completed: { title: "Completed" },
};

const INITIAL_TASKS: PlannerTask[] = [
  {
    id: "planner-1",
    title: "Update Studio Pricing Sheet",
    description: "Review package prices and sync changes with internal docs.",
    recurring: "monthly",
    subTasks: [
      { id: "planner-1-sub-1", title: "Compare with last month", done: false },
      { id: "planner-1-sub-2", title: "Draft changes", done: false },
      { id: "planner-1-sub-3", title: "Team review", done: false },
    ],
    elapsedSec: 0,
    startedAtSec: null,
    totalTimeLabel: null,
    filePath: "",
    isPaused: false,
  },
  {
    id: "planner-2",
    title: "Plan Weekly Social Posts",
    description: "Prepare before/after post schedule and assign owners.",
    recurring: "weekly",
    subTasks: [
      { id: "planner-2-sub-1", title: "Select 6 images", done: false },
      { id: "planner-2-sub-2", title: "Write captions", done: false },
      { id: "planner-2-sub-3", title: "Schedule in tool", done: false },
    ],
    elapsedSec: 0,
    startedAtSec: null,
    totalTimeLabel: null,
    filePath: "",
    isPaused: false,
  },
  {
    id: "planner-3",
    title: "Client Follow-Up Calls",
    description: "Call open client projects and confirm delivery expectations.",
    recurring: "none",
    subTasks: [
      { id: "planner-3-sub-1", title: "Call Todaro", done: false },
      { id: "planner-3-sub-2", title: "Call EV listing", done: false },
    ],
    elapsedSec: 0,
    startedAtSec: null,
    totalTimeLabel: null,
    filePath: "",
    isPaused: false,
  },
];

function formatClock(totalSec: number): string {
  const safe = Math.max(0, totalSec);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatHumanDuration(totalSec: number): string {
  const safe = Math.max(0, totalSec);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

function recurringLabel(value: Recurring): string {
  if (value === "none") return "One-time";
  return value[0].toUpperCase() + value.slice(1);
}

export default function PlannerPage() {
  const [tasksById, setTasksById] = useState<Record<string, PlannerTask>>(
    Object.fromEntries(INITIAL_TASKS.map((task) => [task.id, task]))
  );
  const [masterTaskIds, setMasterTaskIds] = useState<string[]>(INITIAL_TASKS.map((task) => task.id));
  const [kanbanColumns, setKanbanColumns] = useState<Record<KanbanColumnId, string[]>>({
    task: [],
    "in-progress": [],
    completed: [],
  });
  const [clockSec, setClockSec] = useState(0);
  const [taskCounter, setTaskCounter] = useState(INITIAL_TASKS.length + 1);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskRecurring, setNewTaskRecurring] = useState<Recurring>("none");
  const [isMounted, setIsMounted] = useState(false);
  const [confirmStartTaskId, setConfirmStartTaskId] = useState<string | null>(null);
  const [verifyPreparingTaskId, setVerifyPreparingTaskId] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [newSubTaskTitle, setNewSubTaskTitle] = useState("");
  const [linkPrompt, setLinkPrompt] = useState<{ taskId: string; mode: "pause" | "completed" } | null>(null);
  const [linkPathInput, setLinkPathInput] = useState("");
  const [manualColumnCollapsed, setManualColumnCollapsed] = useState<Record<KanbanColumnId, boolean>>({
    task: false,
    "in-progress": false,
    completed: false,
  });

  useEffect(() => {
    const timer = setTimeout(() => setIsMounted(true), 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setClockSec((prev) => prev + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const activeTask = useMemo(() => (activeTaskId ? tasksById[activeTaskId] ?? null : null), [activeTaskId, tasksById]);
  const confirmStartTask = useMemo(
    () => (confirmStartTaskId ? tasksById[confirmStartTaskId] ?? null : null),
    [confirmStartTaskId, tasksById]
  );
  const verifyPreparingTask = useMemo(
    () => (verifyPreparingTaskId ? tasksById[verifyPreparingTaskId] ?? null : null),
    [verifyPreparingTaskId, tasksById]
  );
  const linkPromptTask = useMemo(
    () => (linkPrompt ? tasksById[linkPrompt.taskId] ?? null : null),
    [linkPrompt, tasksById]
  );

  const isColumnCollapsed = (columnId: KanbanColumnId): boolean =>
    kanbanColumns[columnId].length === 0 || manualColumnCollapsed[columnId];

  const getLiveElapsedSec = (task: PlannerTask): number => {
    if (task.startedAtSec !== null && !task.isPaused) {
      return task.elapsedSec + (clockSec - task.startedAtSec);
    }
    return task.elapsedSec;
  };

  const removeTaskEverywhere = (taskId: string) => {
    setMasterTaskIds((prev) => prev.filter((id) => id !== taskId));
    setKanbanColumns((prev) => ({
      task: prev.task.filter((id) => id !== taskId),
      "in-progress": prev["in-progress"].filter((id) => id !== taskId),
      completed: prev.completed.filter((id) => id !== taskId),
    }));
    setTasksById((prev) => {
      const next = { ...prev };
      delete next[taskId];
      return next;
    });
    if (activeTaskId === taskId) setActiveTaskId(null);
    if (linkPrompt?.taskId === taskId) {
      setLinkPrompt(null);
      setLinkPathInput("");
    }
    if (confirmStartTaskId === taskId) setConfirmStartTaskId(null);
    if (verifyPreparingTaskId === taskId) setVerifyPreparingTaskId(null);
  };

  const handleCreateTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = newTaskTitle.trim();
    if (!title) return;
    const nextTaskId = `planner-${taskCounter}`;
    setTaskCounter((prev) => prev + 1);
    setTasksById((prev) => ({
      ...prev,
      [nextTaskId]: {
        id: nextTaskId,
        title,
        description: "",
        recurring: newTaskRecurring,
        subTasks: [],
        elapsedSec: 0,
        startedAtSec: null,
        totalTimeLabel: null,
        filePath: "",
        isPaused: false,
      },
    }));
    setMasterTaskIds((prev) => [nextTaskId, ...prev]);
    setNewTaskTitle("");
    setNewTaskRecurring("none");
  };

  const handleConfirmStartYes = () => {
    if (!confirmStartTaskId) return;
    const taskId = confirmStartTaskId;
    setMasterTaskIds((prev) => prev.filter((id) => id !== taskId));
    setKanbanColumns((prev) => ({ ...prev, task: [taskId, ...prev.task.filter((id) => id !== taskId)] }));
    setConfirmStartTaskId(null);
    setVerifyPreparingTaskId(taskId);
  };

  const handlePreparingVerifyYes = () => {
    if (!verifyPreparingTaskId) return;
    const taskId = verifyPreparingTaskId;
    setTasksById((prev) => ({
      ...prev,
      [taskId]: { ...prev[taskId], startedAtSec: prev[taskId].startedAtSec ?? clockSec, isPaused: false },
    }));
    setVerifyPreparingTaskId(null);
  };

  const handlePreparingVerifyCancel = () => {
    if (!verifyPreparingTaskId) return;
    const taskId = verifyPreparingTaskId;
    setKanbanColumns((prev) => ({
      ...prev,
      task: [taskId, ...prev.task.filter((id) => id !== taskId)],
      "in-progress": prev["in-progress"].filter((id) => id !== taskId),
      completed: prev.completed.filter((id) => id !== taskId),
    }));
    setTasksById((prev) => ({ ...prev, [taskId]: { ...prev[taskId], startedAtSec: null, isPaused: false } }));
    setVerifyPreparingTaskId(null);
  };

  const onDragEnd = (result: DropResult) => {
    const { source, destination, draggableId } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    const sourceColumn = source.droppableId as KanbanColumnId;
    const destinationColumn = destination.droppableId as KanbanColumnId;

    setKanbanColumns((prev) => {
      const sourceIds = Array.from(prev[sourceColumn]);
      const [movedId] = sourceIds.splice(source.index, 1);
      const destinationIds = sourceColumn === destinationColumn ? sourceIds : Array.from(prev[destinationColumn]);
      destinationIds.splice(destination.index, 0, movedId);
      return {
        ...prev,
        [sourceColumn]: sourceColumn === destinationColumn ? destinationIds : sourceIds,
        [destinationColumn]: destinationIds,
      };
    });

    setTasksById((prev) => {
      const target = prev[draggableId];
      if (!target) return prev;

      let nextElapsedSec = target.elapsedSec;
      let nextStartedAtSec = target.startedAtSec;
      let nextTotalLabel = target.totalTimeLabel;

      if (sourceColumn === "in-progress" && nextStartedAtSec !== null && destinationColumn !== "in-progress") {
        nextElapsedSec += clockSec - nextStartedAtSec;
        nextStartedAtSec = null;
      }
      if (destinationColumn === "in-progress" && sourceColumn !== "in-progress" && !target.isPaused) {
        nextStartedAtSec = clockSec;
      }
      if (destinationColumn === "completed") {
        nextTotalLabel = formatHumanDuration(nextElapsedSec);
      } else {
        nextTotalLabel = null;
      }

      return {
        ...prev,
        [draggableId]: {
          ...target,
          elapsedSec: nextElapsedSec,
          startedAtSec: nextStartedAtSec,
          totalTimeLabel: nextTotalLabel,
          isPaused: destinationColumn === "in-progress" ? target.isPaused : false,
        },
      };
    });

    if (destinationColumn === "completed") {
      const existingPath = tasksById[draggableId]?.filePath ?? "";
      setLinkPrompt({ taskId: draggableId, mode: "completed" });
      setLinkPathInput(existingPath);
    }
  };

  const updateTaskField = (taskId: string, updates: Partial<Pick<PlannerTask, "title" | "description">>) => {
    setTasksById((prev) => ({ ...prev, [taskId]: { ...prev[taskId], ...updates } }));
  };

  const addSubTask = () => {
    if (!activeTaskId) return;
    const title = newSubTaskTitle.trim();
    if (!title) return;
    setTasksById((prev) => {
      const task = prev[activeTaskId];
      const nextSubId = `${activeTaskId}-sub-${task.subTasks.length + 1}`;
      return {
        ...prev,
        [activeTaskId]: { ...task, subTasks: [...task.subTasks, { id: nextSubId, title, done: false }] },
      };
    });
    setNewSubTaskTitle("");
  };

  const toggleSubTask = (taskId: string, subTaskId: string) => {
    setTasksById((prev) => {
      const task = prev[taskId];
      return {
        ...prev,
        [taskId]: {
          ...task,
          subTasks: task.subTasks.map((subTask) =>
            subTask.id === subTaskId ? { ...subTask, done: !subTask.done } : subTask
          ),
        },
      };
    });
  };

  const deleteSubTask = (taskId: string, subTaskId: string) => {
    setTasksById((prev) => {
      const task = prev[taskId];
      return { ...prev, [taskId]: { ...task, subTasks: task.subTasks.filter((subTask) => subTask.id !== subTaskId) } };
    });
  };

  const handlePauseTask = (taskId: string) => {
    const existingPath = tasksById[taskId]?.filePath ?? "";
    setLinkPrompt({ taskId, mode: "pause" });
    setLinkPathInput(existingPath);
  };

  const handleResumeTask = (taskId: string) => {
    setTasksById((prev) => ({ ...prev, [taskId]: { ...prev[taskId], startedAtSec: clockSec, isPaused: false } }));
  };

  const saveLinkedPath = () => {
    if (!linkPrompt) return;
    const taskId = linkPrompt.taskId;
    const trimmed = linkPathInput.trim();
    setTasksById((prev) => ({
      ...prev,
      [taskId]: {
        ...prev[taskId],
        filePath: trimmed,
        ...(linkPrompt.mode === "pause"
          ? {
              elapsedSec:
                prev[taskId].startedAtSec !== null
                  ? prev[taskId].elapsedSec + (clockSec - prev[taskId].startedAtSec)
                  : prev[taskId].elapsedSec,
              startedAtSec: null,
              isPaused: true,
            }
          : {}),
      },
    }));
    setLinkPrompt(null);
    setLinkPathInput("");
  };

  const closeLinkPrompt = () => {
    if (linkPrompt?.mode === "pause" && linkPrompt.taskId) {
      const taskId = linkPrompt.taskId;
      setTasksById((prev) => ({
        ...prev,
        [taskId]: {
          ...prev[taskId],
          elapsedSec:
            prev[taskId].startedAtSec !== null
              ? prev[taskId].elapsedSec + (clockSec - prev[taskId].startedAtSec)
              : prev[taskId].elapsedSec,
          startedAtSec: null,
          isPaused: true,
        },
      }));
    }
    setLinkPrompt(null);
    setLinkPathInput("");
  };

  const renderKanbanCard = (taskId: string, index: number, columnId: KanbanColumnId) => {
    const task = tasksById[taskId];
    if (!task) return null;
    const doneCount = task.subTasks.filter((subTask) => subTask.done).length;
    const totalCount = task.subTasks.length;
    const completedDuration = task.totalTimeLabel || formatHumanDuration(getLiveElapsedSec(task));

    return (
      <Draggable key={task.id} draggableId={task.id} index={index}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.draggableProps}
            {...provided.dragHandleProps}
            onClick={() => setActiveTaskId(task.id)}
            className={`rounded-xl border border-zinc-700 bg-zinc-900 p-3 shadow-sm transition ${
              snapshot.isDragging ? "ring-2 ring-zinc-400 dark:ring-zinc-500" : ""
            }`}
          >
            <div className="w-full text-left">
              <p className="truncate text-sm font-semibold">{task.title}</p>
              {columnId === "completed" ? (
                <p className="mt-1 text-xs text-zinc-400">Time: {completedDuration}</p>
              ) : null}
              <p className="mt-1 text-xs text-zinc-400">
                {doneCount}/{totalCount} Sub-tasks
              </p>
              {task.isPaused ? (
                <p className="mt-1 inline-flex rounded-md border border-amber-400/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                  Paused
                </p>
              ) : null}
              {task.filePath ? (
                <p className="mt-1 truncate text-[11px] text-zinc-400">{task.filePath}</p>
              ) : null}
            </div>
            {columnId === "completed" ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  removeTaskEverywhere(task.id);
                }}
                className="mt-2 rounded-md border border-red-300 px-2 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50 dark:border-red-400/40 dark:text-red-300 dark:hover:bg-red-900/20"
              >
                Delete Task
              </button>
            ) : null}
          </div>
        )}
      </Draggable>
    );
  };

  return (
    <main className="min-h-screen bg-black text-zinc-100">
      <div className="mx-auto w-full max-w-[1900px] px-4 py-5 sm:px-6 lg:px-8">
        <header className="mb-4">
          <div className="flex min-w-0 items-start gap-3">
            <Image
              src="/logo.webp"
              alt="Workflow"
              width={220}
              height={60}
              className="h-14 w-auto shrink-0 object-contain"
              priority
            />
            <div className="min-w-0">
              <h1 className="truncate text-3xl font-bold tracking-tight">Studio Planner</h1>
              <p className="mt-1 text-sm text-zinc-500">
                Drag and drop tasks between stages to track studio operations from planning to completion.
              </p>
            </div>
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-[minmax(280px,1fr)_minmax(0,3fr)]">
          <aside className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-300">
              Master To-Do List
            </h2>
            <form onSubmit={handleCreateTask} className="mb-3 space-y-2 rounded-xl border border-zinc-700 bg-zinc-900/70 p-3">
              <input
                value={newTaskTitle}
                onChange={(event) => setNewTaskTitle(event.target.value)}
                placeholder="Create Task"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
              />
              <div className="flex items-center gap-2">
                <select
                  value={newTaskRecurring}
                  onChange={(event) => setNewTaskRecurring(event.target.value as Recurring)}
                  className="h-9 rounded-lg border border-zinc-700 bg-zinc-950 px-2 text-xs"
                >
                  <option value="none">One-time</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
                <button
                  type="submit"
                    className="h-9 rounded-lg bg-zinc-100 px-3 text-xs font-semibold text-zinc-900 transition hover:bg-zinc-300"
                >
                  Add
                </button>
              </div>
            </form>
            <div className="space-y-2 rounded-xl p-1">
              {masterTaskIds.map((taskId) => {
                const task = tasksById[taskId];
                if (!task) return null;
                return (
                  <button
                    key={taskId}
                    type="button"
                    onClick={() => setConfirmStartTaskId(taskId)}
                    className="w-full rounded-xl border border-zinc-800 bg-[#070a0f] p-3 text-left shadow-sm transition hover:border-zinc-600 hover:bg-zinc-900"
                  >
                    <p className="truncate text-sm font-semibold">{task.title}</p>
                    <p className="mt-1 text-xs text-zinc-400">Recurring: {recurringLabel(task.recurring)}</p>
                  </button>
                );
              })}
            </div>
          </aside>

          {isMounted ? (
            <DragDropContext onDragEnd={onDragEnd}>
              <div className="flex gap-3 overflow-x-auto">
                {(Object.keys(COLUMN_META) as KanbanColumnId[]).map((columnId) => (
                  <div
                    key={columnId}
                    className={`${isColumnCollapsed(columnId) ? "w-24 shrink-0" : "w-[350px] max-w-sm"} rounded-xl border border-zinc-800 bg-[#06080d] p-3 transition-all duration-300 ease-in-out`}
                  >
                    <div
                      className={`mb-2 ${isColumnCollapsed(columnId) ? "flex flex-col items-center gap-1" : "flex items-center justify-between gap-2"}`}
                    >
                      <div className={`flex items-center gap-2 ${isColumnCollapsed(columnId) ? "justify-center" : ""}`}>
                        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 text-center">
                          {COLUMN_META[columnId].title}
                        </p>
                        <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-zinc-700 px-1 text-[10px] font-semibold text-zinc-400 ${isColumnCollapsed(columnId) ? "hidden" : ""}`}>
                          {kanbanColumns[columnId].length}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setManualColumnCollapsed((prev) => ({
                            ...prev,
                            [columnId]: !prev[columnId],
                          }))
                        }
                        aria-label={isColumnCollapsed(columnId) ? "Expand column" : "Collapse column"}
                        className="rounded-md border border-zinc-700 px-2 py-0.5 text-[10px] font-semibold text-zinc-300 hover:bg-zinc-800"
                      >
                        {isColumnCollapsed(columnId) ? ">" : "<"}
                      </button>
                    </div>
                    <Droppable droppableId={columnId}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          className={`h-[70vh] space-y-2 rounded-lg p-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden transition-all ${
                            snapshot.isDraggingOver ? "bg-zinc-800/50" : ""
                          }`}
                        >
                          {!isColumnCollapsed(columnId)
                            ? kanbanColumns[columnId].map((taskId, index) => renderKanbanCard(taskId, index, columnId))
                            : null}
                          {provided.placeholder}
                        </div>
                      )}
                    </Droppable>
                  </div>
                ))}
              </div>
            </DragDropContext>
          ) : (
            <div className="flex gap-3 overflow-x-auto">
              {(Object.keys(COLUMN_META) as KanbanColumnId[]).map((columnId) => (
                <div
                  key={columnId}
                  className={`${isColumnCollapsed(columnId) ? "w-24 shrink-0" : "w-[350px] max-w-sm"} rounded-xl border border-zinc-800 bg-[#06080d] p-3 transition-all duration-300 ease-in-out`}
                >
                  <div className={`mb-2 ${isColumnCollapsed(columnId) ? "flex flex-col items-center gap-1" : "flex items-center justify-between gap-2"}`}>
                    <div className={`flex items-center gap-2 ${isColumnCollapsed(columnId) ? "justify-center" : ""}`}>
                      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 text-center">
                        {COLUMN_META[columnId].title}
                      </p>
                      <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-zinc-700 px-1 text-[10px] font-semibold text-zinc-400 ${isColumnCollapsed(columnId) ? "hidden" : ""}`}>
                        {kanbanColumns[columnId].length}
                      </span>
                    </div>
                    <button
                      type="button"
                      aria-label={isColumnCollapsed(columnId) ? "Expand column" : "Collapse column"}
                      className="rounded-md border border-zinc-700 px-2 py-0.5 text-[10px] font-semibold text-zinc-300"
                    >
                      {isColumnCollapsed(columnId) ? ">" : "<"}
                    </button>
                  </div>
                  <div className="h-[70vh] space-y-2 rounded-lg p-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" />
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {confirmStartTask ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
          <div className="w-full max-w-md rounded-2xl border border-zinc-300 bg-white p-5 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
            <h3 className="text-base font-semibold">Start Task</h3>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">Do you want to start this task?</p>
            <p className="mt-1 text-sm font-medium">{confirmStartTask.title}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmStartTaskId(null)}
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmStartYes}
                className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                Yes
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {verifyPreparingTask ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-zinc-300 bg-white p-5 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
            <h3 className="text-base font-semibold">Task Preparation Check</h3>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
              Please review task details and verify that you have everything needed to complete this task.
            </p>
            <p className="mt-1 text-sm font-medium">{verifyPreparingTask.title}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={handlePreparingVerifyCancel}
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handlePreparingVerifyYes}
                className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                Yes
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {linkPromptTask ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-zinc-300 bg-white p-5 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
            <h3 className="text-base font-semibold">Link working files to this task?</h3>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{linkPromptTask.title}</p>
            <input
              value={linkPathInput}
              onChange={(event) => setLinkPathInput(event.target.value)}
              placeholder="D:\\...\\project\\file.psd"
              className="mt-3 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeLinkPrompt}
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Skip
              </button>
              <button
                type="button"
                onClick={saveLinkedPath}
                className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                Save Link
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeTask ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-zinc-300 bg-white p-5 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-base font-semibold">Task Details</h3>
              <button
                type="button"
                onClick={() => setActiveTaskId(null)}
                className="rounded-md px-2 py-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                aria-label="Close task details"
              >
                ✕
              </button>
            </div>

            <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Title
              <input
                value={activeTask.title}
                onChange={(event) => updateTaskField(activeTask.id, { title: event.target.value })}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>

            <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Description
              <textarea
                value={activeTask.description}
                onChange={(event) => updateTaskField(activeTask.id, { description: event.target.value })}
                className="mt-1 h-24 w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>

            <div className="mt-3 rounded-lg border border-zinc-300 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-950/50">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Logged Time</p>
              <p className="mt-1 text-sm font-medium">
                {activeTask.totalTimeLabel || formatClock(getLiveElapsedSec(activeTask))}
              </p>
            </div>

            <div className="mt-3 rounded-lg border border-zinc-300 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-950/50">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Sub-tasks</p>
              <div className="mt-2 space-y-2">
                {activeTask.subTasks.map((subTask) => (
                  <div
                    key={subTask.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-zinc-300 bg-white px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    <label className="flex min-w-0 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={subTask.done}
                        onChange={() => toggleSubTask(activeTask.id, subTask.id)}
                        className="h-4 w-4 rounded border-zinc-400"
                      />
                      <span className={`truncate ${subTask.done ? "line-through opacity-60" : ""}`}>{subTask.title}</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => deleteSubTask(activeTask.id, subTask.id)}
                      className="rounded-md border border-red-300 px-2 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50 dark:border-red-400/40 dark:text-red-300 dark:hover:bg-red-900/20"
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  value={newSubTaskTitle}
                  onChange={(event) => setNewSubTaskTitle(event.target.value)}
                  placeholder="Add sub-task"
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                />
                <button
                  type="button"
                  onClick={addSubTask}
                  className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  Add
                </button>
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              {kanbanColumns["in-progress"].includes(activeTask.id) ? (
                <button
                  type="button"
                  onClick={() => (activeTask.isPaused ? handleResumeTask(activeTask.id) : handlePauseTask(activeTask.id))}
                  className="rounded-lg border border-amber-300 px-3 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-50 dark:border-amber-400/40 dark:text-amber-300 dark:hover:bg-amber-900/20"
                >
                  {activeTask.isPaused ? "Resume Task" : "Pause Task"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => removeTaskEverywhere(activeTask.id)}
                className="rounded-lg border border-red-300 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 dark:border-red-400/40 dark:text-red-300 dark:hover:bg-red-900/20"
              >
                Delete Task
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
