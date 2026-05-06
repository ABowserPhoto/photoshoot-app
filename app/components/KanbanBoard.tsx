"use client";

import { useEffect, useMemo, useState } from "react";
import { Camera, Gem, Home, User } from "lucide-react";
import { triggerPreviewEmail } from "@/app/actions/zapierActions";
import { supabase } from "@/lib/supabaseClient";
import MergePromptModal from "./MergePromptModal";
import ReviewMergedModal from "./ReviewMergedModal";

type ColumnKey =
  | "booking"
  | "preview-sent"
  | "selection-available"
  | "editing"
  | "edited"
  | "send-email"
  | "completed";

export type BoardTask = {
  id: string;
  /** Mirrors Google Calendar event title when synced (stored as `tasks.title`). */
  taskTitle: string;
  localFolderName: string;
  bracketSize: 3 | 5;
  companyName: string;
  lexofficeContactId: string;
  contactFirstName: string;
  contactLastName: string;
  email: string;
  phone: string;
  street: string;
  zipCode: string;
  city: string;
  country: string;
  services: Array<{ name: string; quantity: number; price: number; lexoffice_id: string | null }>;
  products: Array<{ name: string; quantity: number; price: number; lexoffice_id: string | null }>;
  taxPercentage: number;
  amountType: "Net" | "Gross";
  discount: number;
  photoshootType: "Real Estate" | "Business Portraits";
  shootLocation: string;
  photoshootDate: string;
  dueDate: string;
  formattedPhotoshootDate: string;
  editingStartedAt: string | null;
  totalEditingSeconds: number;
  status: ColumnKey;
  isArchived: boolean;
};

type BoardState = Record<ColumnKey, BoardTask[]>;
type RawThumbnailMap = Record<string, string | null>;

const COLUMN_CONFIG: { id: ColumnKey; title: string }[] = [
  { id: "booking", title: "Booking" },
  { id: "preview-sent", title: "Preview Sent" },
  { id: "selection-available", title: "Selection Available" },
  { id: "editing", title: "Editing" },
  { id: "edited", title: "Edited" },
  { id: "send-email", title: "Send Email" },
  { id: "completed", title: "Completed" },
];

const INITIAL_BOARD: BoardState = {
  booking: [],
  "preview-sent": [],
  "selection-available": [],
  editing: [],
  edited: [],
  "send-email": [],
  completed: [],
};

const FALLBACK_TASKS: BoardTask[] = [
  {
    id: "fallback-1",
    taskTitle: "",
    localFolderName: "",
    bracketSize: 3,
    companyName: "Nike",
    lexofficeContactId: "",
    contactFirstName: "Alex",
    contactLastName: "Jordan",
    email: "",
    phone: "",
    street: "",
    zipCode: "",
    city: "",
    country: "",
    services: [],
    products: [],
    taxPercentage: 19,
    amountType: "Net",
    discount: 0,
    photoshootType: "Business Portraits",
    shootLocation: "Berlin",
    photoshootDate: "2026-10-25",
    dueDate: "",
    formattedPhotoshootDate: "Oct 25, 2026",
    editingStartedAt: null,
    totalEditingSeconds: 0,
    status: "booking",
    isArchived: false,
  },
  {
    id: "fallback-2",
    taskTitle: "",
    localFolderName: "",
    bracketSize: 5,
    companyName: "Immo Group",
    lexofficeContactId: "",
    contactFirstName: "Maria",
    contactLastName: "Klein",
    email: "",
    phone: "",
    street: "",
    zipCode: "",
    city: "",
    country: "",
    services: [],
    products: [],
    taxPercentage: 19,
    amountType: "Net",
    discount: 0,
    photoshootType: "Real Estate",
    shootLocation: "Munich",
    photoshootDate: "2026-10-27",
    dueDate: "",
    formattedPhotoshootDate: "Oct 27, 2026",
    editingStartedAt: null,
    totalEditingSeconds: 0,
    status: "preview-sent",
    isArchived: false,
  },
];

type DbTask = {
  id: string | number;
  title: string | null;
  company_name: string | null;
  lexoffice_contact_id: string | null;
  contact_first_name: string | null;
  contact_last_name: string | null;
  email: string | null;
  phone: string | null;
  street: string | null;
  zip_code: string | null;
  city: string | null;
  country: string | null;
  services: unknown;
  products: unknown;
  tax_percentage: number | null;
  amount_type: string | null;
  discount: number | null;
  photoshoot_type: string | null;
  shoot_location: string | null;
  photoshoot_date: string | null;
  due_date: string | null;
  editing_started_at: string | null;
  total_editing_seconds: number | null;
  status: string | null;
  is_archived: boolean | null;
  local_folder_name: string | null;
  bracket_size: number | null;
};

const COLUMN_LABEL_BY_KEY: Record<ColumnKey, string> = {
  booking: "Booking",
  "preview-sent": "Preview Sent",
  "selection-available": "Selection Available",
  editing: "Editing",
  edited: "Edited",
  "send-email": "Send Email",
  completed: "Completed",
};

function createEmptyBoard(): BoardState {
  return {
    booking: [],
    "preview-sent": [],
    "selection-available": [],
    editing: [],
    edited: [],
    "send-email": [],
    completed: [],
  };
}

function normalizeStatus(value: string | null): ColumnKey {
  if (!value) {
    return "booking";
  }

  const normalized = value.trim().toLowerCase().replace(/\s+/g, "-");
  if (normalized === "invoice" || normalized === "email-sent" || normalized === "send-email") {
    return "send-email";
  }
  if (normalized === "processing") {
    return "editing";
  }
  return COLUMN_CONFIG.some((column) => column.id === normalized)
    ? (normalized as ColumnKey)
    : "booking";
}

function formatLongDate(dateString: string | null): string {
  if (!dateString) return "";
  const parsed = new Date(dateString);
  if (Number.isNaN(parsed.getTime())) {
    return dateString;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

function toTimestamp(value: string): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function sortTasksByShootDateAsc(tasks: BoardTask[]): BoardTask[] {
  return [...tasks].sort((a, b) => {
    const aPrimary = toTimestamp(a.photoshootDate);
    const bPrimary = toTimestamp(b.photoshootDate);
    const aFallback = toTimestamp(a.dueDate);
    const bFallback = toTimestamp(b.dueDate);
    const aEffective = aPrimary ?? aFallback;
    const bEffective = bPrimary ?? bFallback;

    if (aEffective === null && bEffective === null) return 0;
    if (aEffective === null) return 1;
    if (bEffective === null) return -1;
    return aEffective - bEffective;
  });
}

function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function toErrorString(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object") {
    const maybe = (value as Record<string, unknown>).message;
    if (typeof maybe === "string" && maybe.trim()) return maybe;
    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function taskDisplayTitle(task: BoardTask): string {
  return task.taskTitle || [task.photoshootType, task.shootLocation].filter(Boolean).join(" - ") || "Untitled";
}

function taskClientLabel(task: BoardTask): string {
  const contact = [task.contactFirstName, task.contactLastName].filter(Boolean).join(" ").trim();
  return contact || task.companyName || "No contact";
}

function TaskCategoryFallbackIcon({
  task,
  className,
}: {
  task: BoardTask;
  className?: string;
}) {
  const category = [task.photoshootType, task.taskTitle].join(" ").toLowerCase();
  const iconClass = className ?? "h-9 w-9";
  if (category.includes("real estate") || category.includes("property") || category.includes("house")) {
    return <Home className={iconClass} strokeWidth={1.5} aria-hidden />;
  }
  if (category.includes("portrait") || category.includes("business")) {
    return <User className={iconClass} strokeWidth={1.5} aria-hidden />;
  }
  if (category.includes("wedding")) {
    return <Gem className={iconClass} strokeWidth={1.5} aria-hidden />;
  }
  return <Camera className={iconClass} strokeWidth={1.5} aria-hidden />;
}

type KanbanBoardProps = {
  refreshSignal?: number;
  onTaskClick?: (task: BoardTask) => void;
  onTaskMoved?: (task: BoardTask, from: ColumnKey, to: ColumnKey) => void;
  showArchived?: boolean;
};

function safeLineItems(value: unknown): Array<{ name: string; quantity: number; price: number; lexoffice_id: string | null }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      return {
        name: typeof row.name === "string" ? row.name : "",
        quantity: typeof row.quantity === "number" ? row.quantity : Number(row.quantity ?? 1) || 1,
        price: typeof row.price === "number" ? row.price : Number(row.price ?? 0) || 0,
        lexoffice_id: typeof row.lexoffice_id === "string" ? row.lexoffice_id : null,
      };
    })
    .filter(
      (item): item is { name: string; quantity: number; price: number; lexoffice_id: string | null } =>
        Boolean(item && item.name)
    );
}

export default function KanbanBoard({
  refreshSignal = 0,
  onTaskClick,
  onTaskMoved,
  showArchived = false,
}: KanbanBoardProps) {
  const [board, setBoard] = useState<BoardState>(INITIAL_BOARD);
  const [archivedTasks, setArchivedTasks] = useState<BoardTask[]>([]);
  const [collapsedColumns, setCollapsedColumns] = useState<Partial<Record<ColumnKey, boolean>>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [sourceColumn, setSourceColumn] = useState<ColumnKey | null>(null);
  const [activeDropColumn, setActiveDropColumn] = useState<ColumnKey | null>(null);
  const [mergePrompt, setMergePrompt] = useState<{ task: BoardTask; from: ColumnKey } | null>(null);
  const [mergePromptProcessing, setMergePromptProcessing] = useState(false);
  const [mergePromptError, setMergePromptError] = useState<string | null>(null);
  const [reviewMergedTask, setReviewMergedTask] = useState<BoardTask | null>(null);
  const [rawThumbnailByTask, setRawThumbnailByTask] = useState<RawThumbnailMap>({});

  useEffect(() => {
    let isMounted = true;

    async function loadTasks() {
      setIsLoading(true);
      setStatusMessage(null);

      try {
        const response = await fetch("/api/tasks", { cache: "no-store" });

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          const message =
            payload?.error ??
            (response.status === 503
              ? "Supabase client is not configured. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
              : `Failed to load tasks (${response.status}).`);
          if (isMounted) {
            setStatusMessage(message);
          }
          return;
        }

        const json = (await response.json()) as { data?: DbTask[] };
        const data = json.data ?? [];

        if (!isMounted) {
          return;
        }

        if (data.length === 0) {
          const fallbackBoard = createEmptyBoard();
          for (const task of FALLBACK_TASKS) {
            fallbackBoard[task.status].push(task);
          }
          setBoard(fallbackBoard);
          setArchivedTasks([]);
          setStatusMessage("No tasks found in Supabase. Showing local dummy tasks.");
          return;
        }

        const grouped = createEmptyBoard();
        const archived: BoardTask[] = [];
        for (const row of data as DbTask[]) {
          const normalizedStatus = normalizeStatus(row.status);
          const bracketRaw = Number(row.bracket_size ?? 3);
          const bracketSize: 3 | 5 = bracketRaw === 5 ? 5 : 3;
          const mappedTask: BoardTask = {
            id: String(row.id),
            taskTitle: row.title ?? "",
            localFolderName: row.local_folder_name ?? "",
            bracketSize,
            companyName: row.company_name ?? "",
            lexofficeContactId: row.lexoffice_contact_id ?? "",
            contactFirstName: row.contact_first_name ?? "",
            contactLastName: row.contact_last_name ?? "",
            email: row.email ?? "",
            phone: row.phone ?? "",
            street: row.street ?? "",
            zipCode: row.zip_code ?? "",
            city: row.city ?? "",
            country: row.country ?? "",
            services: safeLineItems(row.services),
            products: safeLineItems(row.products),
            taxPercentage: Number(row.tax_percentage ?? 19),
            amountType: row.amount_type === "Gross" ? "Gross" : "Net",
            discount: Number(row.discount ?? 0),
            photoshootType: row.photoshoot_type === "Business Portraits" ? "Business Portraits" : "Real Estate",
            shootLocation: row.shoot_location ?? "",
            photoshootDate: row.photoshoot_date ?? "",
            dueDate: row.due_date ?? "",
            formattedPhotoshootDate: formatLongDate(row.photoshoot_date),
            editingStartedAt: row.editing_started_at ?? null,
            totalEditingSeconds: Number(row.total_editing_seconds ?? 0),
            status: normalizedStatus,
            isArchived: Boolean(row.is_archived),
          };

          if (mappedTask.isArchived) {
            archived.push(mappedTask);
          } else {
            grouped[normalizedStatus].push(mappedTask);
          }
        }

      for (const column of COLUMN_CONFIG) {
        grouped[column.id] = sortTasksByShootDateAsc(grouped[column.id]);
      }

        setBoard(grouped);
        setArchivedTasks(archived);
      } catch {
        if (isMounted) {
          setStatusMessage(
            "Failed to load tasks: network error. Ensure the dev server listens on all interfaces (see package.json \"dev\" script) and retry."
          );
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadTasks();

    return () => {
      isMounted = false;
    };
  }, [refreshSignal]);

  useEffect(() => {
    const tasksWithFolders = COLUMN_CONFIG.flatMap((column) => board[column.id]).filter((t) =>
      Boolean(t.localFolderName?.trim())
    );
    if (tasksWithFolders.length === 0) {
      setRawThumbnailByTask({});
      return;
    }

    let active = true;
    const loadThumbnails = async () => {
      const entries = await Promise.all(
        tasksWithFolders.map(async (task) => {
          try {
            const res = await fetch(
              `/api/list-raw-first?local_folder_name=${encodeURIComponent(task.localFolderName.trim())}`,
              { cache: "no-store" }
            );
            const data = (await res.json().catch(() => null)) as { thumbnailUrl?: string | null } | null;
            return [task.id, res.ok ? (data?.thumbnailUrl ?? null) : null] as const;
          } catch {
            return [task.id, null] as const;
          }
        })
      );
      if (!active) {
        return;
      }
      setRawThumbnailByTask(Object.fromEntries(entries));
    };

    void loadThumbnails();
    return () => {
      active = false;
    };
  }, [board]);

  const taskLookup = useMemo(() => {
    const map = new Map<string, { task: BoardTask; columnId: ColumnKey }>();
    for (const column of COLUMN_CONFIG) {
      for (const task of board[column.id]) {
        map.set(task.id, { task, columnId: column.id });
      }
    }
    return map;
  }, [board]);

  const handleDragStart = (taskId: string, columnId: ColumnKey) => {
    setDraggingTaskId(taskId);
    setSourceColumn(columnId);
  };

  const clearDragState = () => {
    setDraggingTaskId(null);
    setSourceColumn(null);
    setActiveDropColumn(null);
  };

  const dismissMergePrompt = () => {
    if (mergePromptProcessing) {
      return;
    }
    setMergePrompt(null);
    setMergePromptError(null);
  };

  const handleMergePromptSkip = async () => {
    if (!mergePrompt) {
      return;
    }
    if (!supabase) {
      setStatusMessage("Task cannot be updated: Supabase client is not configured.");
      return;
    }

    const { task, from } = mergePrompt;
    setMergePromptProcessing(true);
    setMergePromptError(null);

    try {
      const movedTask: BoardTask = {
        ...task,
        status: "selection-available",
        editingStartedAt: task.editingStartedAt,
        totalEditingSeconds: task.totalEditingSeconds,
      };

      const { error } = await supabase
        .from("tasks")
        .update({
          status: "Selection Available",
          editing_started_at: task.editingStartedAt,
          total_editing_seconds: task.totalEditingSeconds,
        })
        .eq("id", task.id);

      if (error) {
        throw new Error(error.message);
      }

      setBoard((prev) => {
        const updatedSource = prev[from].filter((row) => row.id !== task.id);
        const updatedTarget = sortTasksByShootDateAsc([...prev["selection-available"], movedTask]);
        return {
          ...prev,
          [from]: updatedSource,
          "selection-available": updatedTarget,
        };
      });
      setMergePrompt(null);
      setStatusMessage(null);
      onTaskMoved?.(movedTask, from, "selection-available");
    } catch (err) {
      setMergePromptError(err instanceof Error ? err.message : "Could not update task.");
    } finally {
      setMergePromptProcessing(false);
    }
  };

  const handleMergePromptMerge = async (bracketSize: 3 | 5) => {
    if (!mergePrompt) {
      return;
    }
    if (!supabase) {
      setStatusMessage("Task cannot be updated: Supabase client is not configured.");
      return;
    }

    const { task, from } = mergePrompt;
    setMergePromptProcessing(true);
    setMergePromptError(null);

    try {
      const { error: bracketError } = await supabase
        .from("tasks")
        .update({ bracket_size: bracketSize })
        .eq("id", task.id);

      if (bracketError) {
        throw new Error(bracketError.message);
      }

      if (!task.localFolderName.trim()) {
        throw new Error(
          "No local photo folder is set for this task. Save the booking so folders can be created."
        );
      }

      const mergeResponse = await fetch("/api/auto-merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          local_folder_name: task.localFolderName.trim(),
          bracket_size: bracketSize,
        }),
      });
      const mergePayload = (await mergeResponse.json().catch(() => ({}))) as { error?: unknown };
      if (!mergeResponse.ok) {
        throw new Error(toErrorString(mergePayload.error, `Merge failed (${mergeResponse.status}).`));
      }

      const movedTask: BoardTask = {
        ...task,
        status: "selection-available",
        bracketSize,
        editingStartedAt: task.editingStartedAt,
        totalEditingSeconds: task.totalEditingSeconds,
      };

      const { error: statusError } = await supabase
        .from("tasks")
        .update({
          status: "Selection Available",
          editing_started_at: task.editingStartedAt,
          total_editing_seconds: task.totalEditingSeconds,
        })
        .eq("id", task.id);

      if (statusError) {
        throw new Error(statusError.message);
      }

      setBoard((prev) => {
        const updatedSource = prev[from].filter((row) => row.id !== task.id);
        const updatedTarget = sortTasksByShootDateAsc([...prev["selection-available"], movedTask]);
        return {
          ...prev,
          [from]: updatedSource,
          "selection-available": updatedTarget,
        };
      });
      setMergePrompt(null);
      setStatusMessage(null);
      onTaskMoved?.(movedTask, from, "selection-available");
    } catch (err) {
      setMergePromptError(err instanceof Error ? err.message : "Merge or update failed.");
    } finally {
      setMergePromptProcessing(false);
    }
  };

  const handleDrop = async (targetColumn: ColumnKey) => {
    if (!draggingTaskId || !sourceColumn) {
      return;
    }

    if (sourceColumn === targetColumn) {
      clearDragState();
      return;
    }

    const dragged = taskLookup.get(draggingTaskId);
    if (!dragged) {
      clearDragState();
      return;
    }

    if (targetColumn === "selection-available") {
      setMergePrompt({ task: dragged.task, from: sourceColumn });
      setMergePromptError(null);
      clearDragState();
      return;
    }

    const now = new Date();
    const nextEditingStartedAt =
      targetColumn === "editing"
        ? now.toISOString()
        : targetColumn === "edited"
          ? null
          : dragged.task.editingStartedAt;
    let nextTotalEditingSeconds = dragged.task.totalEditingSeconds;

    if (targetColumn === "editing" && sourceColumn !== "editing") {
      const confirmed = window.confirm("Ready to start the editing timer for this shoot?");
      if (!confirmed) {
        clearDragState();
        return;
      }
    }

    if (sourceColumn === "editing" && targetColumn === "edited") {
      const startedAtTs = dragged.task.editingStartedAt ? new Date(dragged.task.editingStartedAt).getTime() : null;
      if (startedAtTs && !Number.isNaN(startedAtTs)) {
        const elapsed = Math.max(0, Math.floor((now.getTime() - startedAtTs) / 1000));
        nextTotalEditingSeconds += elapsed;
      }
    }

    const movedTask: BoardTask = {
      ...dragged.task,
      status: targetColumn,
      editingStartedAt: nextEditingStartedAt,
      totalEditingSeconds: nextTotalEditingSeconds,
    };
    const previousBoard = board;
    setBoard((prev) => {
      const updatedSource = prev[sourceColumn].filter((task) => task.id !== draggingTaskId);
      const updatedTarget = sortTasksByShootDateAsc([...prev[targetColumn], movedTask]);

      return {
        ...prev,
        [sourceColumn]: updatedSource,
        [targetColumn]: updatedTarget,
      };
    });
    clearDragState();

    if (!supabase) {
      setStatusMessage(
        "Task moved locally, but Supabase client is not configured. Check environment variables."
      );
      setBoard(previousBoard);
      return;
    }

    const { error } = await supabase
      .from("tasks")
      .update({
        status: COLUMN_LABEL_BY_KEY[targetColumn],
        editing_started_at: nextEditingStartedAt,
        total_editing_seconds: nextTotalEditingSeconds,
      })
      .eq("id", dragged.task.id);

    if (error) {
      setBoard(previousBoard);
      setStatusMessage(`Could not update task status: ${error.message}`);
      return;
    }

    if (targetColumn === "preview-sent") {
      const zapResult = await triggerPreviewEmail(String(dragged.task.id));
      if (!zapResult.ok) {
        setStatusMessage(zapResult.error ?? "Preview-E-Mail konnte nicht an Zapier gesendet werden.");
      } else {
        setStatusMessage(null);
      }
    } else {
      setStatusMessage(null);
    }

    onTaskMoved?.(movedTask, sourceColumn, targetColumn);
  };

  const isColumnCollapsed = (columnId: ColumnKey) => {
    const manuallySet = collapsedColumns[columnId];
    if (typeof manuallySet === "boolean") {
      return manuallySet;
    }
    return board[columnId].length === 0;
  };

  const toggleColumn = (columnId: ColumnKey) => {
    const current = isColumnCollapsed(columnId);
    setCollapsedColumns((prev) => ({ ...prev, [columnId]: !current }));
  };

  const handleArchiveTask = async (task: BoardTask) => {
    const previousBoard = board;
    const previousArchived = archivedTasks;

    setBoard((prev) => {
      const next = { ...prev };
      next.completed = next.completed.filter((row) => row.id !== task.id);
      return next;
    });
    setArchivedTasks((prev) => [{ ...task, isArchived: true }, ...prev]);

    if (!supabase) {
      setStatusMessage("Could not archive task: Supabase is not configured.");
      setBoard(previousBoard);
      setArchivedTasks(previousArchived);
      return;
    }

    const { error } = await supabase.from("tasks").update({ is_archived: true }).eq("id", task.id);
    if (error) {
      setStatusMessage(`Could not archive task: ${error.message}`);
      setBoard(previousBoard);
      setArchivedTasks(previousArchived);
      return;
    }
    setStatusMessage(null);
  };

  const handleRestoreTask = async (task: BoardTask) => {
    const previousBoard = board;
    const previousArchived = archivedTasks;

    setArchivedTasks((prev) => prev.filter((row) => row.id !== task.id));
    setBoard((prev) => ({
      ...prev,
      "selection-available": [...prev["selection-available"], { ...task, status: "selection-available", isArchived: false }],
    }));

    if (!supabase) {
      setStatusMessage("Could not restore task: Supabase is not configured.");
      setBoard(previousBoard);
      setArchivedTasks(previousArchived);
      return;
    }

    const { error } = await supabase
      .from("tasks")
      .update({ is_archived: false, status: "Selection Available" })
      .eq("id", task.id);

    if (error) {
      setStatusMessage(`Could not restore task: ${error.message}`);
      setBoard(previousBoard);
      setArchivedTasks(previousArchived);
      return;
    }

    setStatusMessage(null);
  };

  return (
    <div className="w-full">
      <div className="overflow-x-auto pb-3 [scrollbar-color:#4a4a4a_#000000] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-track]:bg-black [&::-webkit-scrollbar-thumb]:bg-zinc-600 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:border [&::-webkit-scrollbar-thumb]:border-black">
        {showArchived ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {archivedTasks.map((task) => (
              <article
                key={task.id}
                onClick={() => onTaskClick?.(task)}
                className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 shadow-sm dark:border-zinc-700 dark:bg-zinc-800 cursor-pointer"
              >
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {[task.photoshootType, task.companyName, task.shootLocation].filter(Boolean).join(" - ") || "Untitled"}
                </h3>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {[task.contactFirstName, task.contactLastName].filter(Boolean).join(" ") || "No contact"}
                </p>
                {task.formattedPhotoshootDate ? (
                  <p className="mt-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">{task.formattedPhotoshootDate}</p>
                ) : null}
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleRestoreTask(task);
                  }}
                  className="mt-3 rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-700"
                >
                  Restore
                </button>
              </article>
            ))}
            {!isLoading && archivedTasks.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">No archived tasks yet.</p>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-nowrap gap-4 min-w-max">
          {COLUMN_CONFIG.map((column) => {
            const isActive = activeDropColumn === column.id;
            const isCollapsed = isColumnCollapsed(column.id);

            return (
              <section
                key={column.id}
                onDragOver={(event) => {
                  event.preventDefault();
                  setActiveDropColumn(column.id);
                }}
                onDragLeave={() => setActiveDropColumn((prev) => (prev === column.id ? null : prev))}
                onDrop={(event) => {
                  event.preventDefault();
                  void handleDrop(column.id);
                }}
                className={`rounded-xl border bg-white p-3 shadow-sm transition-all dark:bg-zinc-900 ${
                  isCollapsed ? "w-12 min-w-[3rem]" : "min-w-[300px] w-[300px]"
                } ${
                  isActive
                    ? "border-zinc-500 bg-zinc-100/80 dark:border-zinc-500 dark:bg-zinc-800/80"
                    : "border-zinc-200 dark:border-zinc-800"
                }`}
              >
                <div className={`mb-3 flex items-center ${isCollapsed ? "justify-center" : "justify-between"}`}>
                  {isCollapsed ? (
                    <h2 className="text-xs font-semibold text-zinc-800 dark:text-zinc-100 [writing-mode:vertical-rl] rotate-180">
                      {column.title}
                    </h2>
                  ) : (
                    <>
                      <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{column.title}</h2>
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                        {board[column.id].length}
                      </span>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => toggleColumn(column.id)}
                    className="ml-1 rounded px-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    aria-label={isCollapsed ? "Expand column" : "Collapse column"}
                  >
                    {isCollapsed ? ">" : "<"}
                  </button>
                </div>

                {!isCollapsed ? <div className="flex min-h-[65vh] flex-col gap-2">
                  {board[column.id].map((task) => (
                    <article
                      key={task.id}
                      draggable
                      onDragStart={() => handleDragStart(task.id, column.id)}
                      onClick={() => onTaskClick?.(task)}
                      onDragEnd={() => {
                        clearDragState();
                      }}
                      className="cursor-grab rounded-lg border border-zinc-300 bg-white p-3 shadow-sm active:cursor-grabbing dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      <div className="flex gap-3">
                        <div className="min-w-0 flex-[2]">
                          <h3 className="text-sm font-semibold leading-snug text-zinc-900 dark:text-zinc-100">
                            {taskDisplayTitle(task)}
                          </h3>
                          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{taskClientLabel(task)}</p>
                          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                            {task.formattedPhotoshootDate || "No date"}
                          </p>
                          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
                            Total Edit Time: {formatDuration(task.totalEditingSeconds)}
                          </p>
                          {column.id === "completed" ? (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleArchiveTask(task);
                              }}
                              className="mt-3 rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                            >
                              Archive Task
                            </button>
                          ) : null}
                        </div>
                        {task.localFolderName ? (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setReviewMergedTask(task);
                            }}
                            className="relative h-[5.5rem] w-20 shrink-0 overflow-hidden rounded-md border border-zinc-300 bg-zinc-200 dark:border-zinc-600 dark:bg-zinc-800"
                            aria-label="Review merged photos"
                          >
                            {rawThumbnailByTask[task.id] ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={rawThumbnailByTask[task.id]!}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center bg-zinc-100 dark:bg-zinc-950">
                                <TaskCategoryFallbackIcon
                                  task={task}
                                  className="h-9 w-9 text-zinc-500 dark:text-zinc-400"
                                />
                              </div>
                            )}
                          </button>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div> : null}
              </section>
            );
          })}
        </div>
        )}
        {isLoading ? (
          <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">Loading tasks from Supabase...</p>
        ) : null}
        {statusMessage ? (
          <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">{statusMessage}</p>
        ) : null}
      </div>
      <MergePromptModal
        task={mergePrompt?.task ?? null}
        isOpen={mergePrompt !== null}
        onDismiss={dismissMergePrompt}
        onSkip={() => void handleMergePromptSkip()}
        onMerge={(size) => void handleMergePromptMerge(size)}
        isProcessing={mergePromptProcessing}
        errorMessage={mergePromptError}
      />
      <ReviewMergedModal
        task={reviewMergedTask}
        isOpen={reviewMergedTask !== null}
        onClose={() => setReviewMergedTask(null)}
      />
    </div>
  );
}
