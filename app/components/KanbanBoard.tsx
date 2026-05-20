"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Gem, Home, User } from "lucide-react";
import {
  celebrateTaskCompletion,
  buildRandomDailyCompletionMessage,
} from "@/lib/taskCompletionCelebration";
import { countTodayCompletions } from "@/lib/kanbanDailyStreak";
import DailyStreakBadge from "@/app/components/DailyStreakBadge";
import { triggerPreviewEmail } from "@/app/actions/zapierActions";
import { syncKanbanPhotoshootStatus } from "@/app/actions/agency-sync";
import { updateTaskStatus } from "@/app/actions/tasks";
import { supabase } from "@/lib/supabaseClient";
import MergePromptModal from "./MergePromptModal";
import ReviewMergedModal from "./ReviewMergedModal";

type ColumnKey =
  | "awaiting-folders"
  | "booking"
  | "preview-sent"
  | "selection-available"
  | "editing"
  | "ready-for-review"
  | "edited"
  | "send-email"
  | "completed";

export type BoardTask = {
  id: string;
  /** Mirrors Google Calendar event title when synced (stored as `tasks.title`). */
  taskTitle: string;
  localFolderName: string;
  bracketSize: 3 | 5;
  previewPreference: "first" | "middle" | "last";
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
  photoshootType: "Real Estate" | "Business Portraits" | "Food";
  shootLocation: string;
  photoshootDate: string;
  dueDate: string;
  formattedPhotoshootDate: string;
  editingStartedAt: string | null;
  totalEditingSeconds: number;
  /** Public Supabase Storage URL for Kanban card cover (set by local worker). */
  coverImageUrl: string | null;
  status: ColumnKey;
  isArchived: boolean;
  completedAt: string | null;
  updatedAt: string | null;
};

type BoardState = Record<ColumnKey, BoardTask[]>;
const COLUMN_CONFIG: { id: ColumnKey; title: string }[] = [
  { id: "awaiting-folders", title: "Awaiting folders" },
  { id: "booking", title: "Booking" },
  { id: "preview-sent", title: "Preview Sent" },
  { id: "selection-available", title: "Selection Available" },
  { id: "ready-for-review", title: "Ready for Review" },
  { id: "editing", title: "Editing" },
  { id: "edited", title: "Edited" },
  { id: "send-email", title: "Send Email" },
  { id: "completed", title: "Completed" },
];

const INITIAL_BOARD: BoardState = {
  "awaiting-folders": [],
  booking: [],
  "preview-sent": [],
  "selection-available": [],
  "ready-for-review": [],
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
    previewPreference: "first",
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
    coverImageUrl: null,
    status: "booking",
    isArchived: false,
    completedAt: null,
    updatedAt: null,
  },
  {
    id: "fallback-2",
    taskTitle: "",
    localFolderName: "",
    bracketSize: 5,
    previewPreference: "first",
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
    coverImageUrl: null,
    status: "preview-sent",
    isArchived: false,
    completedAt: null,
    updatedAt: null,
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
  preview_preference: string | null;
  cover_image_url: string | null;
  completed_at: string | null;
  updated_at: string | null;
};

const COLUMN_LABEL_BY_KEY: Record<ColumnKey, string> = {
  "awaiting-folders": "awaiting_folder_creation",
  booking: "Booking",
  "preview-sent": "Preview Sent",
  "selection-available": "Selection Available",
  editing: "Editing",
  "ready-for-review": "Ready for Review",
  edited: "Edited",
  "send-email": "Send Email",
  completed: "Completed",
};

function createEmptyBoard(): BoardState {
  return {
    "awaiting-folders": [],
    booking: [],
    "preview-sent": [],
    "selection-available": [],
    "ready-for-review": [],
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
  if (normalized === "awaiting-folder-creation" || normalized === "awaiting_folder_creation") {
    return "awaiting-folders";
  }
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

function KanbanTaskCover({
  task,
  onReviewClick,
}: {
  task: BoardTask;
  onReviewClick?: () => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const rawUrl = task.coverImageUrl?.trim();
  const showImg = Boolean(rawUrl && !imgFailed);

  return (
    <div
      className={`relative h-[5.5rem] w-20 shrink-0 overflow-hidden rounded-md border border-zinc-300 bg-zinc-200 dark:border-zinc-600 dark:bg-zinc-800 ${
        onReviewClick ? "cursor-pointer" : ""
      }`}
    >
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={rawUrl}
          alt=""
          className="pointer-events-none h-full w-full object-cover"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-zinc-100 dark:bg-zinc-950">
          <TaskCategoryFallbackIcon task={task} className="h-9 w-9 text-zinc-500 dark:text-zinc-400" />
        </div>
      )}
      {onReviewClick ? (
        <button
          type="button"
          className="absolute inset-0 z-10 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
          onClick={(event) => {
            event.stopPropagation();
            onReviewClick();
          }}
          aria-label="Review merged photos"
        />
      ) : null}
    </div>
  );
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

function normalizePreviewPreference(value: unknown): "first" | "middle" | "last" {
  if (value === "middle" || value === "last") {
    return value;
  }
  return "first";
}

function mapDbTaskToBoardTask(row: Partial<DbTask>, existing?: BoardTask): BoardTask {
  const bracketRaw = Number(row.bracket_size ?? existing?.bracketSize ?? 3);
  const bracketSize: 3 | 5 = bracketRaw === 5 ? 5 : 3;
  const photoshootDate = typeof row.photoshoot_date === "string" ? row.photoshoot_date : (existing?.photoshootDate ?? "");
  const dueDate = typeof row.due_date === "string" ? row.due_date : (existing?.dueDate ?? "");
  const statusValue = typeof row.status === "string" ? row.status : (existing?.status ?? "booking");
  const hasCoverImageValue = Object.prototype.hasOwnProperty.call(row, "cover_image_url");
  const coverImageUrl = hasCoverImageValue
    ? (typeof row.cover_image_url === "string" && row.cover_image_url.trim() ? row.cover_image_url.trim() : null)
    : (existing?.coverImageUrl ?? null);
  return {
    id: row.id != null ? String(row.id) : (existing?.id ?? ""),
    taskTitle: typeof row.title === "string" ? row.title : (existing?.taskTitle ?? ""),
    localFolderName:
      typeof row.local_folder_name === "string" ? row.local_folder_name : (existing?.localFolderName ?? ""),
    bracketSize,
    previewPreference: normalizePreviewPreference(row.preview_preference ?? existing?.previewPreference),
    companyName: typeof row.company_name === "string" ? row.company_name : (existing?.companyName ?? ""),
    lexofficeContactId:
      typeof row.lexoffice_contact_id === "string"
        ? row.lexoffice_contact_id
        : (existing?.lexofficeContactId ?? ""),
    contactFirstName:
      typeof row.contact_first_name === "string" ? row.contact_first_name : (existing?.contactFirstName ?? ""),
    contactLastName:
      typeof row.contact_last_name === "string" ? row.contact_last_name : (existing?.contactLastName ?? ""),
    email: typeof row.email === "string" ? row.email : (existing?.email ?? ""),
    phone: typeof row.phone === "string" ? row.phone : (existing?.phone ?? ""),
    street: typeof row.street === "string" ? row.street : (existing?.street ?? ""),
    zipCode: typeof row.zip_code === "string" ? row.zip_code : (existing?.zipCode ?? ""),
    city: typeof row.city === "string" ? row.city : (existing?.city ?? ""),
    country: typeof row.country === "string" ? row.country : (existing?.country ?? ""),
    services: safeLineItems(row.services ?? existing?.services),
    products: safeLineItems(row.products ?? existing?.products),
    taxPercentage: Number(row.tax_percentage ?? existing?.taxPercentage ?? 19),
    amountType:
      row.amount_type === "Gross" ? "Gross" : row.amount_type === "Net" ? "Net" : (existing?.amountType ?? "Net"),
    discount: Number(row.discount ?? existing?.discount ?? 0),
    photoshootType:
      row.photoshoot_type === "Business Portraits"
        ? "Business Portraits"
        : row.photoshoot_type === "Real Estate"
          ? "Real Estate"
          : row.photoshoot_type === "Food"
            ? "Food"
          : (existing?.photoshootType ?? "Real Estate"),
    shootLocation: typeof row.shoot_location === "string" ? row.shoot_location : (existing?.shootLocation ?? ""),
    photoshootDate,
    dueDate,
    formattedPhotoshootDate: formatLongDate(photoshootDate),
    editingStartedAt:
      typeof row.editing_started_at === "string"
        ? row.editing_started_at
        : row.editing_started_at === null
          ? null
          : (existing?.editingStartedAt ?? null),
    totalEditingSeconds: Number(row.total_editing_seconds ?? existing?.totalEditingSeconds ?? 0),
    coverImageUrl,
    status: normalizeStatus(statusValue),
    isArchived: typeof row.is_archived === "boolean" ? row.is_archived : (existing?.isArchived ?? false),
    completedAt:
      typeof row.completed_at === "string"
        ? row.completed_at
        : row.completed_at === null
          ? null
          : (existing?.completedAt ?? null),
    updatedAt:
      typeof row.updated_at === "string"
        ? row.updated_at
        : row.updated_at === null
          ? null
          : (existing?.updatedAt ?? null),
  };
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
  const [celebrationToast, setCelebrationToast] = useState<string | null>(null);
  const [staleDataBanner, setStaleDataBanner] = useState<string | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [sourceColumn, setSourceColumn] = useState<ColumnKey | null>(null);
  const [activeDropColumn, setActiveDropColumn] = useState<ColumnKey | null>(null);
  const [mergePrompt, setMergePrompt] = useState<{ task: BoardTask; from: ColumnKey } | null>(null);
  const [mergePromptProcessing, setMergePromptProcessing] = useState(false);
  const [mergePromptError, setMergePromptError] = useState<string | null>(null);
  const [reviewMergedTask, setReviewMergedTask] = useState<BoardTask | null>(null);
  const boardRef = useRef(board);
  const archivedTasksRef = useRef(archivedTasks);
  useEffect(() => {
    boardRef.current = board;
  }, [board]);
  useEffect(() => {
    archivedTasksRef.current = archivedTasks;
  }, [archivedTasks]);

  useEffect(() => {
    if (!celebrationToast) {
      return;
    }
    const timer = window.setTimeout(() => {
      setCelebrationToast(null);
    }, 4000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [celebrationToast]);

  const dailyCompletionCount = useMemo(
    () => countTodayCompletions(board, archivedTasks),
    [board, archivedTasks]
  );

  useEffect(() => {
    let isMounted = true;

    async function loadTasks() {
      setIsLoading(true);
      setStatusMessage(null);
      setStaleDataBanner(null);

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
            setStaleDataBanner(null);
          }
          return;
        }

        const json = (await response.json()) as {
          data?: DbTask[];
          warning?: string;
          meta?: { stale?: boolean };
        };
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
          setStaleDataBanner(json.meta?.stale ? (json.warning ?? "Showing cached task data.") : null);
          return;
        }

        const grouped = createEmptyBoard();
        const archived: BoardTask[] = [];
        for (const row of data as DbTask[]) {
          const normalizedStatus = normalizeStatus(row.status);
          const mappedTask = mapDbTaskToBoardTask(row);

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
        setStaleDataBanner(json.meta?.stale ? (json.warning ?? "Showing cached task data.") : null);
      } catch {
        if (isMounted) {
          setStatusMessage(
            "Failed to load tasks: network error. Ensure the dev server listens on all interfaces (see package.json \"dev\" script) and retry."
          );
          setStaleDataBanner(null);
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
    if (!supabase) {
      return;
    }

    const applyRealtimeTask = (row: Partial<DbTask>) => {
      const taskId = row.id != null ? String(row.id) : "";
      if (!taskId) {
        return;
      }

      const currentBoard = boardRef.current;
      const currentArchived = archivedTasksRef.current;
      let existingTask: BoardTask | undefined;

      for (const column of COLUMN_CONFIG) {
        const found = currentBoard[column.id].find((task) => task.id === taskId);
        if (found) {
          existingTask = found;
          break;
        }
      }
      if (!existingTask) {
        existingTask = currentArchived.find((task) => task.id === taskId);
      }

      const mappedTask = mapDbTaskToBoardTask(row, existingTask);

      const nextBoard = createEmptyBoard();
      for (const column of COLUMN_CONFIG) {
        nextBoard[column.id] = currentBoard[column.id].filter((task) => task.id !== taskId);
      }
      let nextArchived = currentArchived.filter((task) => task.id !== taskId);

      if (mappedTask.isArchived) {
        nextArchived = [mappedTask, ...nextArchived];
      } else {
        nextBoard[mappedTask.status] = sortTasksByShootDateAsc([...nextBoard[mappedTask.status], mappedTask]);
      }

      boardRef.current = nextBoard;
      archivedTasksRef.current = nextArchived;
      setBoard(nextBoard);
      setArchivedTasks(nextArchived);
    };

    const channel = supabase
      .channel("kanban-tasks-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "tasks" },
        (payload) => {
          applyRealtimeTask(payload.new as Partial<DbTask>);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "tasks" },
        (payload) => {
          applyRealtimeTask(payload.new as Partial<DbTask>);
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

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
          "No local photo folder is set for this task. Ensure the PC worker has created folders (task should leave “Awaiting folders”), or set local_folder_name."
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
    const nowIso = now.toISOString();
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
      ...(targetColumn === "completed"
        ? { completedAt: nowIso, updatedAt: nowIso }
        : targetColumn === "send-email"
          ? { updatedAt: nowIso }
          : {}),
    };
    const previousBoard = board;
    const nextBoard: BoardState = {
      ...board,
      [sourceColumn]: board[sourceColumn].filter((task) => task.id !== draggingTaskId),
      [targetColumn]: sortTasksByShootDateAsc([...board[targetColumn], movedTask]),
    };
    setBoard(nextBoard);
    clearDragState();

    if (!supabase) {
      setStatusMessage(
        "Task moved locally, but Supabase client is not configured. Check environment variables."
      );
      setBoard(previousBoard);
      return;
    }

    const statusLabel = COLUMN_LABEL_BY_KEY[targetColumn];
    const updateRes = await updateTaskStatus(dragged.task.id, statusLabel, {
      editing_started_at: nextEditingStartedAt,
      total_editing_seconds: nextTotalEditingSeconds,
      ...(targetColumn === "completed" ? { completed_at: nowIso } : {}),
    });

    if (!updateRes.ok) {
      setBoard(previousBoard);
      setStatusMessage(`Could not update task status: ${updateRes.error}`);
      return;
    }

    void syncKanbanPhotoshootStatus({
      photoshootId: dragged.task.id,
      newStatusLabel: COLUMN_LABEL_BY_KEY[targetColumn],
      photoshootDisplayName:
        dragged.task.taskTitle?.trim() || dragged.task.companyName?.trim() || "Photoshoot",
    }).then((res) => {
      if (!res.ok) {
        console.warn("[KanbanBoard] agency sync:", res.error);
      }
    });

    if (targetColumn === "completed") {
      const todayCompletionCount = countTodayCompletions(nextBoard, archivedTasks, {
        justCompletedTaskId: movedTask.id,
      });
      celebrateTaskCompletion();
      setCelebrationToast(buildRandomDailyCompletionMessage(todayCompletionCount));
    } else if (targetColumn === "preview-sent") {
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
    try {
      const cleanupRes = await fetch("/api/tasks/purge-storage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: String(task.id) }),
      });
      if (cleanupRes.ok) {
        setStatusMessage("Task archived. Cloud-Speicher für dieses Projekt wurde bereinigt.");
      } else {
        setStatusMessage("Task archived. Cloud storage cleanup could not be confirmed.");
      }
    } catch {
      // Silent failure by design: archive must still succeed if storage is already empty/unreachable.
      setStatusMessage("Task archived. Cloud storage cleanup skipped.");
    }
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
    <div className="relative w-full">
      {!showArchived ? <DailyStreakBadge count={dailyCompletionCount} /> : null}
      {celebrationToast ? (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed left-1/2 top-1/2 z-[100] w-full max-w-md -translate-x-1/2 -translate-y-1/2 px-4"
        >
          <p className="rounded-xl border border-emerald-400/50 bg-emerald-100/95 px-5 py-4 text-center text-base font-semibold text-emerald-900 shadow-2xl dark:border-emerald-500/40 dark:bg-emerald-950/95 dark:text-emerald-100">
            {celebrationToast}
          </p>
        </div>
      ) : null}
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
                          {task.totalEditingSeconds > 0 ? (
                            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
                              Total Edit Time: {formatDuration(task.totalEditingSeconds)}
                            </p>
                          ) : null}
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
                        <KanbanTaskCover
                          task={task}
                          onReviewClick={
                            task.localFolderName?.trim()
                              ? () => setReviewMergedTask(task)
                              : undefined
                          }
                        />
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
        {staleDataBanner ? (
          <div className="mt-4 rounded-md border border-amber-400/40 bg-amber-100/60 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-200">
            {staleDataBanner}
          </div>
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
