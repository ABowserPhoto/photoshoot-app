"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Gem, Home, Pencil, User } from "lucide-react";
import {
  celebrateTaskCompletion,
  buildRandomDailyCompletionMessage,
} from "@/lib/taskCompletionCelebration";
import { countTodayCompletions } from "@/lib/kanbanDailyStreak";
import DailyStreakBadge from "@/app/components/DailyStreakBadge";
import EditDurationModal from "@/app/components/EditDurationModal";
import { syncKanbanPhotoshootStatus } from "@/app/actions/agency-sync";
import { adjustTaskEditingDuration, updateTaskStatus } from "@/app/actions/tasks";
import { useAuthRole } from "@/app/contexts/AuthRoleContext";
import { supabase } from "@/lib/supabaseClient";
import {
  buildFinalizeShootPayload,
  buildShootDisplayName,
} from "@/lib/finalizeShootPayload";
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
  /** Comma-separated CC emails for delivery drafts. */
  emailCc: string;
  phone: string;
  street: string;
  zipCode: string;
  city: string;
  country: string;
  addressSupplement: string;
  /** Client-facing photo gallery URL shown on the invoice. */
  galleryLink: string;
  /** Selected CRM contact UUID. */
  contactId: string | null;
  services: Array<{ name: string; quantity: number; price: number; lexoffice_id: string | null }>;
  products: Array<{ name: string; quantity: number; price: number; lexoffice_id: string | null }>;
  taxPercentage: number;
  amountType: "Net" | "Gross";
  discount: number;
  photoshootType:
    | "Immobilien"
    | "Business Portraits"
    | "Food"
    | "Product"
    | "Portrait Pro"
    | "Studio Portrait"
    | "Hochzeit"
    | "Mini Session"
    | "Event";
  shootLocation: string;
  photoshootDate: string;
  dueDate: string;
  formattedPhotoshootDate: string;
  editingStartedAt: string | null;
  totalEditingSeconds: number;
  /** Public Supabase Storage URL for Kanban card cover (set by local worker). */
  coverImageUrl: string | null;
  status: ColumnKey;
  /** Raw Supabase `tasks.status` (e.g. pending_processing, Processing). */
  workflowStatus: string;
  isArchived: boolean;
  completedAt: string | null;
  updatedAt: string | null;
  skipInvoice: boolean;
  /** When false, worker skips client gallery preview generation for this booking. */
  generateGallery: boolean;
  isCreditNote: boolean;
  expectedRevenue: number;
  isPaid: boolean;
  creditNotePaid: boolean;
  creditNoteFileUrl: string;
  hasSeparateInvoiceEmail: boolean;
  invoiceEmailAddress: string;
  /** UUID of a linked task/photoshoot booking (tasks.linked_item_id). */
  linkedItemId: string | null;
  /** Full local/network path for opening the shoot in external software (e.g. Z:\Shoots\Smith). */
  localOpenPath: string;
  /** Last merge/worker failure message (tasks.processing_error). */
  processingError: string | null;
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
    emailCc: "",
    phone: "",
    street: "",
    zipCode: "",
    city: "",
    country: "",
    addressSupplement: "",
    galleryLink: "",
    contactId: null,
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
    workflowStatus: "Booking",
    isArchived: false,
    completedAt: null,
    updatedAt: null,
    skipInvoice: false,
    generateGallery: true,
    isCreditNote: false,
    expectedRevenue: 0,
    isPaid: false,
    creditNotePaid: false,
    creditNoteFileUrl: "",
    hasSeparateInvoiceEmail: false,
    invoiceEmailAddress: "",
    linkedItemId: null,
    localOpenPath: "",
    processingError: null,
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
    emailCc: "",
    phone: "",
    street: "",
    zipCode: "",
    city: "",
    country: "",
    addressSupplement: "",
    galleryLink: "",
    contactId: null,
    services: [],
    products: [],
    taxPercentage: 19,
    amountType: "Net",
    discount: 0,
    photoshootType: "Immobilien",
    shootLocation: "Munich",
    photoshootDate: "2026-10-27",
    dueDate: "",
    formattedPhotoshootDate: "Oct 27, 2026",
    editingStartedAt: null,
    totalEditingSeconds: 0,
    coverImageUrl: null,
    status: "preview-sent",
    workflowStatus: "Preview Sent",
    isArchived: false,
    completedAt: null,
    updatedAt: null,
    skipInvoice: false,
    generateGallery: true,
    isCreditNote: false,
    expectedRevenue: 0,
    isPaid: false,
    creditNotePaid: false,
    creditNoteFileUrl: "",
    hasSeparateInvoiceEmail: false,
    invoiceEmailAddress: "",
    linkedItemId: null,
    localOpenPath: "",
    processingError: null,
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
  email_cc: string | null;
  phone: string | null;
  street: string | null;
  zip_code: string | null;
  city: string | null;
  country: string | null;
  address_supplement: string | null;
  gallery_link: string | null;
  contact_id: string | null;
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
  skip_invoice?: boolean | null;
  generate_gallery?: boolean | null;
  is_credit_note?: boolean | null;
  expected_revenue?: number | null;
  is_paid?: boolean | null;
  credit_note_paid?: boolean | null;
  credit_note_file_url?: string | null;
  has_separate_invoice_email?: boolean | null;
  invoice_email_address?: string | null;
  linked_item_id?: string | null;
  local_open_path?: string | null;
  processing_error?: string | null;
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

const MERGE_PIPELINE_STATUSES = new Set([
  "pending_processing",
  "processing",
  "syncing_selection",
]);

function isMergePipelineStatus(value: string | null | undefined): boolean {
  const normalized = (value ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  return MERGE_PIPELINE_STATUSES.has(normalized);
}

// buildShootDisplayName, buildFinalizeShootPayload and their helpers are
// imported from @/lib/finalizeShootPayload (shared with the upload modal flow).

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
  if (
    normalized === "invoice" ||
    normalized === "email-sent" ||
    normalized === "send-email" ||
    normalized === "invoice-sent"
  ) {
    return "send-email";
  }
  if (normalized === "processing") {
    return "editing";
  }
  if (
    normalized === "pending-processing" ||
    normalized === "pending_processing" ||
    normalized === "syncing-selection" ||
    normalized === "syncing_selection" ||
    normalized === "selection-failed"
  ) {
    return "selection-available";
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

function dedupeTasksById(tasks: BoardTask[]): BoardTask[] {
  const seen = new Set<string>();
  const deduped: BoardTask[] = [];
  for (const task of tasks) {
    const id = String(task.id);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    deduped.push(task);
  }
  return deduped;
}

function sanitizeBoardState(board: BoardState): BoardState {
  const seen = new Set<string>();
  const next = createEmptyBoard();
  for (const column of COLUMN_CONFIG) {
    const filtered: BoardTask[] = [];
    for (const task of board[column.id]) {
      const id = String(task.id);
      if (!id || seen.has(id)) {
        continue;
      }
      seen.add(id);
      filtered.push(task);
    }
    next[column.id] = sortTasksByShootDateAsc(filtered);
  }
  return next;
}

function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function liveEditingSeconds(task: BoardTask, nowMs: number): number {
  let total = Math.max(0, task.totalEditingSeconds);
  if (!task.editingStartedAt) {
    return total;
  }
  const startedAtMs = new Date(task.editingStartedAt).getTime();
  if (Number.isNaN(startedAtMs)) {
    return total;
  }
  return total + Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
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
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
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
  /**
   * When set, dropping into "Edited" does not persist status or trigger Drive/email.
   * The board moves the card visually; the parent opens UploadDeliverablesModal and
   * must call onCancelEditedIntercept / refresh after success.
   */
  onEditedIntercept?: (task: BoardTask, from: ColumnKey) => void;
  showArchived?: boolean;
  /** Called whenever the flat board task list changes (e.g. after load or status update). */
  onBoardChange?: (tasks: BoardTask[]) => void;
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
    emailCc: typeof row.email_cc === "string" ? row.email_cc : (existing?.emailCc ?? ""),
    phone: typeof row.phone === "string" ? row.phone : (existing?.phone ?? ""),
    street: typeof row.street === "string" ? row.street : (existing?.street ?? ""),
    zipCode: typeof row.zip_code === "string" ? row.zip_code : (existing?.zipCode ?? ""),
    city: typeof row.city === "string" ? row.city : (existing?.city ?? ""),
    country: typeof row.country === "string" ? row.country : (existing?.country ?? ""),
    addressSupplement:
      typeof row.address_supplement === "string"
        ? row.address_supplement
        : (existing?.addressSupplement ?? ""),
    galleryLink: typeof row.gallery_link === "string" ? row.gallery_link : (existing?.galleryLink ?? ""),
    contactId:
      typeof row.contact_id === "string"
        ? row.contact_id
        : row.contact_id === null
          ? null
          : (existing?.contactId ?? null),
    services: safeLineItems(row.services ?? existing?.services),
    products: safeLineItems(row.products ?? existing?.products),
    taxPercentage: Number(row.tax_percentage ?? existing?.taxPercentage ?? 19),
    amountType:
      row.amount_type === "Gross" ? "Gross" : row.amount_type === "Net" ? "Net" : (existing?.amountType ?? "Net"),
    discount: Number(row.discount ?? existing?.discount ?? 0),
    photoshootType:
      row.photoshoot_type === "Business Portraits"
        ? "Business Portraits"
        : row.photoshoot_type === "Real Estate" || row.photoshoot_type === "Immobilien"
          ? "Immobilien"
          : row.photoshoot_type === "Food"
            ? "Food"
            : row.photoshoot_type === "Product"
              ? "Product"
              : row.photoshoot_type === "Portrait Pro"
                ? "Portrait Pro"
                : row.photoshoot_type === "Studio Portrait"
                  ? "Studio Portrait"
                  : row.photoshoot_type === "Wedding" || row.photoshoot_type === "Hochzeit"
                    ? "Hochzeit"
                    : row.photoshoot_type === "Mini Session"
                      ? "Mini Session"
                      : row.photoshoot_type === "Event"
                        ? "Event"
                        : (existing?.photoshootType ?? "Immobilien"),
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
    workflowStatus: statusValue.trim() || (existing?.workflowStatus ?? ""),
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
    skipInvoice:
      typeof row.skip_invoice === "boolean"
        ? row.skip_invoice
        : row.skip_invoice == null
          ? (existing?.skipInvoice ?? false)
          : Boolean(row.skip_invoice),
    generateGallery:
      typeof row.generate_gallery === "boolean"
        ? row.generate_gallery
        : row.generate_gallery == null
          ? (existing?.generateGallery ?? true)
          : Boolean(row.generate_gallery),
    isCreditNote:
      typeof row.is_credit_note === "boolean"
        ? row.is_credit_note
        : row.is_credit_note == null
          ? (existing?.isCreditNote ?? false)
          : Boolean(row.is_credit_note),
    expectedRevenue:
      typeof row.expected_revenue === "number" && Number.isFinite(row.expected_revenue)
        ? row.expected_revenue
        : row.expected_revenue == null
          ? (existing?.expectedRevenue ?? 0)
          : Number(row.expected_revenue) || 0,
    isPaid:
      typeof row.is_paid === "boolean"
        ? row.is_paid
        : row.is_paid == null
          ? (existing?.isPaid ?? false)
          : Boolean(row.is_paid),
    creditNotePaid:
      typeof row.credit_note_paid === "boolean"
        ? row.credit_note_paid
        : row.credit_note_paid == null
          ? (existing?.creditNotePaid ?? false)
          : Boolean(row.credit_note_paid),
    creditNoteFileUrl:
      typeof row.credit_note_file_url === "string"
        ? row.credit_note_file_url
        : (existing?.creditNoteFileUrl ?? ""),
    hasSeparateInvoiceEmail:
      typeof row.has_separate_invoice_email === "boolean"
        ? row.has_separate_invoice_email
        : row.has_separate_invoice_email == null
          ? (existing?.hasSeparateInvoiceEmail ?? false)
          : Boolean(row.has_separate_invoice_email),
    invoiceEmailAddress:
      typeof row.invoice_email_address === "string"
        ? row.invoice_email_address
        : (existing?.invoiceEmailAddress ?? ""),
    linkedItemId:
      typeof row.linked_item_id === "string"
        ? row.linked_item_id
        : row.linked_item_id === null
          ? null
          : (existing?.linkedItemId ?? null),
    localOpenPath:
      typeof row.local_open_path === "string" ? row.local_open_path : (existing?.localOpenPath ?? ""),
    processingError:
      typeof row.processing_error === "string"
        ? row.processing_error
        : row.processing_error === null
          ? null
          : (existing?.processingError ?? null),
  };
}

export default function KanbanBoard({
  refreshSignal = 0,
  onTaskClick,
  onTaskMoved,
  onEditedIntercept,
  showArchived = false,
  onBoardChange,
}: KanbanBoardProps) {
  const [board, setBoard] = useState<BoardState>(INITIAL_BOARD);
  const [ipcRefreshSignal, setIpcRefreshSignal] = useState(0);
  const [archivedTasks, setArchivedTasks] = useState<BoardTask[]>([]);
  const [collapsedColumns, setCollapsedColumns] = useState<Partial<Record<ColumnKey, boolean>>>({
    completed: true,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [celebrationToast, setCelebrationToast] = useState<string | null>(null);
  const [staleDataBanner, setStaleDataBanner] = useState<string | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [sourceColumn, setSourceColumn] = useState<ColumnKey | null>(null);
  const [activeDropColumn, setActiveDropColumn] = useState<ColumnKey | null>(null);
  const [clockMs, setClockMs] = useState(() => Date.now());
  const [mergePrompt, setMergePrompt] = useState<{ task: BoardTask; from: ColumnKey } | null>(null);
  const [mergePromptProcessing, setMergePromptProcessing] = useState(false);
  const [mergePromptError, setMergePromptError] = useState<string | null>(null);
  const [reviewMergedTask, setReviewMergedTask] = useState<BoardTask | null>(null);
  const [regeneratingPreviewTaskId, setRegeneratingPreviewTaskId] = useState<string | null>(null);
  const [mergingTaskIds, setMergingTaskIds] = useState<Set<string>>(() => new Set());
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [previewRegenToast, setPreviewRegenToast] = useState<string | null>(null);
  const [mergeNowToast, setMergeNowToast] = useState<string | null>(null);
  const [workflowToast, setWorkflowToast] = useState<{
    message: string;
    variant: "loading" | "success" | "error";
  } | null>(null);
  const { isAdmin, isLoading: authRoleLoading } = useAuthRole();
  const [durationEditTaskId, setDurationEditTaskId] = useState<string | null>(null);
  const [durationEditInitialSeconds, setDurationEditInitialSeconds] = useState(0);
  const [isSavingDuration, setIsSavingDuration] = useState(false);
  const [durationEditError, setDurationEditError] = useState<string | null>(null);
  const boardRef = useRef(board);
  const archivedTasksRef = useRef(archivedTasks);
  const mergePrevColumnRef = useRef<Map<string, ColumnKey>>(new Map());
  useEffect(() => {
    boardRef.current = board;
  }, [board]);
  useEffect(() => {
    archivedTasksRef.current = archivedTasks;
  }, [archivedTasks]);

  useEffect(() => {
    const hasRunningTimer = COLUMN_CONFIG.some((column) =>
      board[column.id].some((task) => Boolean(task.editingStartedAt))
    );
    if (!hasRunningTimer) {
      return;
    }
    const timer = window.setInterval(() => {
      setClockMs(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [board]);

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

  useEffect(() => {
    if (!previewRegenToast) {
      return;
    }
    const timer = window.setTimeout(() => {
      setPreviewRegenToast(null);
    }, 4000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [previewRegenToast]);

  useEffect(() => {
    if (!mergeNowToast) {
      return;
    }
    const timer = window.setTimeout(() => {
      setMergeNowToast(null);
    }, 5000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [mergeNowToast]);

  useEffect(() => {
    if (!workflowToast || workflowToast.variant === "loading") {
      return;
    }
    const timer = window.setTimeout(() => {
      setWorkflowToast(null);
    }, 5000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [workflowToast]);

  useEffect(() => {
    if (mergingTaskIds.size === 0) {
      return;
    }
    const timer = window.setInterval(() => {
      setIpcRefreshSignal((prev) => prev + 1);
    }, 10_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [mergingTaskIds]);

  useEffect(() => {
    if (mergingTaskIds.size === 0) {
      return;
    }
    setMergingTaskIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const taskId of prev) {
        let column: ColumnKey | null = null;
        let task: BoardTask | null = null;
        for (const config of COLUMN_CONFIG) {
          const match = board[config.id].find((row) => row.id === taskId);
          if (match) {
            column = config.id;
            task = match;
            break;
          }
        }
        const previousColumn = mergePrevColumnRef.current.get(taskId) ?? null;
        if (column) {
          mergePrevColumnRef.current.set(taskId, column);
        }
        if (!column || column === "ready-for-review" || column === "completed") {
          next.delete(taskId);
          mergePrevColumnRef.current.delete(taskId);
          changed = true;
          continue;
        }
        if (task && !isMergePipelineStatus(task.workflowStatus)) {
          next.delete(taskId);
          mergePrevColumnRef.current.delete(taskId);
          changed = true;
          continue;
        }
        if (column === "selection-available" && previousColumn === "editing") {
          next.delete(taskId);
          mergePrevColumnRef.current.delete(taskId);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [board, mergingTaskIds.size]);

  useEffect(() => {
    const onWidgetRefresh = () => {
      setIpcRefreshSignal((prev) => prev + 1);
    };
    window.addEventListener("desktop-widget:refresh", onWidgetRefresh);
    return () => {
      window.removeEventListener("desktop-widget:refresh", onWidgetRefresh);
    };
  }, []);

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
        const response = await fetch("/api/tasks", { cache: "no-store", credentials: "include" });

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as {
            error?: string;
            warning?: string;
            meta?: { stale?: boolean };
          } | null;
          const message =
            payload?.error ??
            payload?.warning ??
            (response.status === 503
              ? "Supabase client is not configured. Check NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY on Vercel."
              : `Failed to load tasks (${response.status}).`);
          console.error("[KanbanBoard] /api/tasks failed:", {
            status: response.status,
            error: payload?.error,
            warning: payload?.warning,
            meta: payload?.meta,
          });
          if (isMounted) {
            setStatusMessage(message);
            setStaleDataBanner(payload?.warning ?? null);
            setBoard(sanitizeBoardState(createEmptyBoard()));
            setArchivedTasks([]);
          }
          return;
        }

        const json = (await response.json()) as {
          data?: DbTask[];
          warning?: string;
          meta?: { stale?: boolean };
        };
        const data = json.data ?? [];
        const isStale = Boolean(json.meta?.stale);
        const warning = typeof json.warning === "string" ? json.warning.trim() : "";

        if (!isMounted) {
          return;
        }

        // Production trap: /api/tasks returns HTTP 200 + empty data when Supabase
        // fails on a cold serverless instance (no in-memory cache). Do not treat
        // that as "no tasks" or swap in dummy cards.
        if (data.length === 0 && (isStale || warning)) {
          console.error("[KanbanBoard] Supabase tasks unavailable:", warning || "stale empty response", {
            status: response.status,
            meta: json.meta,
          });
          setBoard(sanitizeBoardState(createEmptyBoard()));
          setArchivedTasks([]);
          setStatusMessage(
            warning ||
              "Supabase temporarily unavailable. Check NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY on Vercel."
          );
          setStaleDataBanner(warning || "Supabase temporarily unavailable.");
          return;
        }

        if (data.length === 0) {
          console.warn("[KanbanBoard] /api/tasks returned an empty task list (no stale warning).");
          const fallbackBoard = createEmptyBoard();
          // Dummy seed only in local development — never mask prod empties as sample data.
          if (process.env.NODE_ENV === "development") {
            for (const task of FALLBACK_TASKS) {
              fallbackBoard[task.status].push(task);
            }
            setBoard(sanitizeBoardState(fallbackBoard));
            setArchivedTasks([]);
            setStatusMessage("No tasks found in Supabase. Showing local dummy tasks.");
          } else {
            setBoard(sanitizeBoardState(fallbackBoard));
            setArchivedTasks([]);
            setStatusMessage("No tasks found in Supabase.");
          }
          setStaleDataBanner(null);
          return;
        }

        const grouped = createEmptyBoard();
        const archived: BoardTask[] = [];
        const seenBoardTaskIds = new Set<string>();
        const seenArchivedTaskIds = new Set<string>();
        for (const row of data as DbTask[]) {
          const normalizedStatus = normalizeStatus(row.status);
          const mappedTask = mapDbTaskToBoardTask(row);
          const mappedTaskId = String(mappedTask.id);
          if (!mappedTaskId) {
            continue;
          }

          if (mappedTask.isArchived) {
            if (seenArchivedTaskIds.has(mappedTaskId)) {
              continue;
            }
            seenArchivedTaskIds.add(mappedTaskId);
            archived.push(mappedTask);
          } else {
            if (seenBoardTaskIds.has(mappedTaskId)) {
              continue;
            }
            seenBoardTaskIds.add(mappedTaskId);
            grouped[normalizedStatus].push(mappedTask);
          }
        }

      for (const column of COLUMN_CONFIG) {
        grouped[column.id] = sortTasksByShootDateAsc(grouped[column.id]);
      }

        setBoard(sanitizeBoardState(grouped));
        setArchivedTasks(dedupeTasksById(archived));
        setStaleDataBanner(json.meta?.stale ? (json.warning ?? "Showing cached task data.") : null);
        if (onBoardChange) {
          const flat = COLUMN_CONFIG.flatMap((col) => sanitizeBoardState(grouped)[col.id] ?? []);
          onBoardChange(flat);
        }
      } catch (error) {
        console.error("[KanbanBoard] Failed to load tasks:", error);
        if (isMounted) {
          setStatusMessage(
            "Failed to load tasks: network error. Check browser console for details, then verify Supabase env vars on Vercel."
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
  }, [refreshSignal, ipcRefreshSignal]);

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
        nextArchived = dedupeTasksById([mappedTask, ...nextArchived]);
      } else {
        nextBoard[mappedTask.status] = sortTasksByShootDateAsc(
          dedupeTasksById([...nextBoard[mappedTask.status], mappedTask])
        );
      }

      const sanitizedBoard = sanitizeBoardState(nextBoard);
      boardRef.current = sanitizedBoard;
      archivedTasksRef.current = nextArchived;
      setBoard(sanitizedBoard);
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
      void supabase?.removeChannel(channel);
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
        const updatedTarget = sortTasksByShootDateAsc(
          dedupeTasksById([...prev["selection-available"], movedTask])
        );
        return sanitizeBoardState({
          ...prev,
          [from]: updatedSource,
          "selection-available": updatedTarget,
        });
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
      const mergePayload = (await mergeResponse.json().catch(() => ({}))) as {
        error?: unknown;
        keepCurrentStatus?: boolean;
        stage?: string;
      };
      if (!mergeResponse.ok) {
        const backendError = toErrorString(mergePayload.error, `Merge failed (${mergeResponse.status}).`);
        if (mergePayload.keepCurrentStatus === true) {
          console.error("[KanbanBoard] auto-merge failed, keeping current status", {
            taskId: task.id,
            fromColumn: from,
            stage: mergePayload.stage,
            status: mergeResponse.status,
            error: backendError,
          });
          setMergePromptError(backendError);
          setStatusMessage(backendError);
          return;
        }
        throw new Error(backendError);
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
        const updatedTarget = sortTasksByShootDateAsc(
          dedupeTasksById([...prev["selection-available"], movedTask])
        );
        return sanitizeBoardState({
          ...prev,
          [from]: updatedSource,
          "selection-available": updatedTarget,
        });
      });
      setMergePrompt(null);
      setStatusMessage(null);
      onTaskMoved?.(movedTask, from, "selection-available");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Merge or update failed.";
      setMergePromptError(message);
      setStatusMessage(message);
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

    // Edited column: open deliverables modal instead of persisting status / Drive workflows.
    if (targetColumn === "edited" && onEditedIntercept) {
      const now = new Date();
      const nowIso = now.toISOString();
      const leavingEditing = sourceColumn === "editing";

      let nextEditingStartedAt = dragged.task.editingStartedAt;
      let nextTotalEditingSeconds = dragged.task.totalEditingSeconds;

      if (leavingEditing) {
        const startedAtTs = dragged.task.editingStartedAt
          ? new Date(dragged.task.editingStartedAt).getTime()
          : Number.NaN;
        if (!Number.isNaN(startedAtTs)) {
          nextTotalEditingSeconds += Math.max(0, Math.floor((now.getTime() - startedAtTs) / 1000));
        }
        nextEditingStartedAt = null;
      }

      const pendingTask: BoardTask = {
        ...dragged.task,
        status: "edited",
        editingStartedAt: nextEditingStartedAt,
        totalEditingSeconds: nextTotalEditingSeconds,
      };

      const previousBoard = board;
      const nextBoard: BoardState = {
        ...board,
        [sourceColumn]: board[sourceColumn].filter((task) => task.id !== draggingTaskId),
        edited: sortTasksByShootDateAsc(
          dedupeTasksById([...board.edited.filter((task) => task.id !== pendingTask.id), pendingTask])
        ),
      };
      setBoard(sanitizeBoardState(nextBoard));
      clearDragState();

      // Persist editing timer only — do not write status "Edited" until modal completes.
      if (leavingEditing && supabase) {
        void updateTaskStatus(dragged.task.id, COLUMN_LABEL_BY_KEY[sourceColumn], {
          editing_started_at: nextEditingStartedAt,
          total_editing_seconds: nextTotalEditingSeconds,
        }).then((res) => {
          if (!res.ok) {
            console.warn("[KanbanBoard] timer save on Edited intercept:", res.error);
          }
        });
      }

      try {
        onEditedIntercept(pendingTask, sourceColumn);
      } catch (error) {
        setBoard(previousBoard);
        console.warn("[KanbanBoard] onEditedIntercept threw:", error);
      }
      return;
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const enteringEditing = targetColumn === "editing" && sourceColumn !== "editing";
    const leavingEditing = sourceColumn === "editing" && targetColumn !== "editing";

    // Timer is independent of folders / merge / Drive. Always start on enter
    // and always accumulate on leave, even when local_folder_name is empty.
    let nextEditingStartedAt = dragged.task.editingStartedAt;
    let nextTotalEditingSeconds = dragged.task.totalEditingSeconds;

    if (enteringEditing) {
      if (!nextEditingStartedAt) {
        nextEditingStartedAt = nowIso;
      }
    }

    if (leavingEditing) {
      const startedAtTs = dragged.task.editingStartedAt
        ? new Date(dragged.task.editingStartedAt).getTime()
        : Number.NaN;
      if (!Number.isNaN(startedAtTs)) {
        nextTotalEditingSeconds += Math.max(0, Math.floor((now.getTime() - startedAtTs) / 1000));
      }
      nextEditingStartedAt = null;
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
      [targetColumn]: sortTasksByShootDateAsc(
        dedupeTasksById([...board[targetColumn].filter((task) => task.id !== movedTask.id), movedTask])
      ),
    };
    setBoard(sanitizeBoardState(nextBoard));
    clearDragState();

    if (!supabase) {
      setStatusMessage(
        "Task moved locally, but Supabase client is not configured. Check environment variables."
      );
      setBoard(previousBoard);
      return;
    }

    if (targetColumn === "send-email") {
      if (!dragged.task.email.trim()) {
        setBoard(previousBoard);
        setWorkflowToast({
          message: "Cannot create email draft: client email is missing on this task.",
          variant: "error",
        });
        return;
      }

      if (!dragged.task.localFolderName.trim()) {
        setBoard(previousBoard);
        setWorkflowToast({
          message:
            "Cannot upload photos: no local folder is set for this task. Ensure the PC worker has created shoot folders.",
          variant: "error",
        });
        return;
      }

      setWorkflowToast({
        message: dragged.task.skipInvoice
          ? "Uploading photos, creating Drive folder & email draft..."
          : "Uploading photos, generating invoice & folders...",
        variant: "loading",
      });

      try {
        const response = await fetch("/api/workflows/finalize-shoot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildFinalizeShootPayload(dragged.task)),
        });
        const payload = (await response.json().catch(() => null)) as
          | {
              error?: unknown;
              step?: string;
              success?: boolean;
              skippedInvoice?: boolean;
              status?: string;
              galleryLink?: string;
              googleDriveLink?: string;
              separateInvoiceEmail?: boolean;
              invoiceGmailDraftId?: string | null;
            }
          | null;

        if (!response.ok || !payload?.success) {
          const detail = toErrorString(payload?.error, `Finalize shoot failed (${response.status}).`);
          const step = typeof payload?.step === "string" ? payload.step : "";
          throw new Error(step ? `${detail} (step: ${step})` : detail);
        }

        const workflowStatus =
          typeof payload.status === "string" && payload.status.trim()
            ? payload.status.trim()
            : payload.skippedInvoice
              ? "Send Email"
              : "Invoice Sent";

        const resolvedGalleryLink =
          (typeof payload.galleryLink === "string" && payload.galleryLink.trim()) ||
          (typeof payload.googleDriveLink === "string" && payload.googleDriveLink.trim()) ||
          movedTask.galleryLink;

        const finalizedTask: BoardTask = {
          ...movedTask,
          workflowStatus,
          galleryLink: resolvedGalleryLink,
          updatedAt: new Date().toISOString(),
        };

        setBoard((prev) =>
          sanitizeBoardState({
            ...prev,
            "send-email": sortTasksByShootDateAsc(
              dedupeTasksById([
                ...prev["send-email"].filter((task) => task.id !== finalizedTask.id),
                finalizedTask,
              ])
            ),
          })
        );

        setWorkflowToast({
          message: payload.skippedInvoice
            ? "Drive folder created & draft saved (no invoice)."
            : payload.separateInvoiceEmail
              ? "Invoice created — 2 Gmail drafts ready (gallery + invoice)."
              : "Invoice created & draft saved!",
          variant: "success",
        });
        setStatusMessage(null);

        const editorUpdate = await updateTaskStatus(dragged.task.id, workflowStatus, {
          editing_started_at: nextEditingStartedAt,
          total_editing_seconds: nextTotalEditingSeconds,
        });
        if (!editorUpdate.ok) {
          console.warn("[KanbanBoard] editor_id update after finalize-shoot:", editorUpdate.error);
        }

        void syncKanbanPhotoshootStatus({
          photoshootId: dragged.task.id,
          newStatusLabel: workflowStatus,
          photoshootDisplayName: buildShootDisplayName(dragged.task),
        }).then((res) => {
          if (!res.ok) {
            console.warn("[KanbanBoard] agency sync:", res.error);
          }
        });

        onTaskMoved?.(finalizedTask, sourceColumn, targetColumn);
        return;
      } catch (error) {
        setBoard(previousBoard);
        setWorkflowToast({
          message: toErrorString(error, "Invoice workflow failed."),
          variant: "error",
        });
        setStatusMessage(null);
        return;
      }
    }

    const statusLabel = COLUMN_LABEL_BY_KEY[targetColumn];
    let updateRes: { ok: true } | { ok: false; error: string };
    try {
      updateRes = await updateTaskStatus(dragged.task.id, statusLabel, {
        editing_started_at: nextEditingStartedAt,
        total_editing_seconds: nextTotalEditingSeconds,
        ...(targetColumn === "completed" ? { completed_at: nowIso } : {}),
      });
    } catch (error) {
      setBoard(previousBoard);
      setStatusMessage(
        `Could not update task status: ${toErrorString(error, "Status update failed.")}`
      );
      return;
    }

    if (!updateRes.ok) {
      setBoard(previousBoard);
      setStatusMessage(`Could not update task status: ${updateRes.error}`);
      return;
    }

    try {
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
    } catch (error) {
      console.warn("[KanbanBoard] agency sync threw:", error);
    }

    if (targetColumn === "completed") {
      const todayCompletionCount = countTodayCompletions(nextBoard, archivedTasks, {
        justCompletedTaskId: movedTask.id,
      });
      celebrateTaskCompletion();
      setCelebrationToast(buildRandomDailyCompletionMessage(todayCompletionCount));
    } else if (targetColumn === "preview-sent") {
      if (!dragged.task.email.trim()) {
        setWorkflowToast({
          message: "Preview draft skipped: client email is missing on this task.",
          variant: "error",
        });
        setStatusMessage("Preview draft skipped: client email is missing on this task.");
      } else {
        setWorkflowToast({
          message: "Creating preview Gmail draft...",
          variant: "loading",
        });
        try {
          const response = await fetch("/api/workflows/preview-email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ taskId: String(dragged.task.id) }),
          });
          const payload = (await response.json().catch(() => null)) as {
            success?: boolean;
            error?: string;
            gmailDraftId?: string;
          } | null;

          if (!response.ok || !payload?.success) {
            throw new Error(
              payload?.error ?? `Preview email draft failed (${response.status}).`
            );
          }

          setWorkflowToast({
            message: "Preview Gmail draft created.",
            variant: "success",
          });
          setStatusMessage(null);
        } catch (error) {
          const message = toErrorString(
            error,
            "Preview-E-Mail-Entwurf konnte nicht in Gmail erstellt werden."
          );
          setWorkflowToast({ message, variant: "error" });
          setStatusMessage(message);
        }
      }
    } else {
      setStatusMessage(null);
    }

    try {
      onTaskMoved?.(movedTask, sourceColumn, targetColumn);
    } catch (error) {
      console.warn("[KanbanBoard] onTaskMoved threw (timer already saved):", error);
    }
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
    setBoard((prev) => {
      const sanitizedPrev = sanitizeBoardState(prev);
      return sanitizeBoardState({
        ...sanitizedPrev,
        "selection-available": [
          ...sanitizedPrev["selection-available"],
          { ...task, status: "selection-available", isArchived: false },
        ],
      });
    });

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

  const handleMergeNow = async (task: BoardTask) => {
    if (!task.id.trim()) {
      return;
    }
    setMergingTaskIds((prev) => new Set(prev).add(task.id));
    setMergeNowToast(null);
    try {
      const response = await fetch("/api/tasks/queue-merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: unknown; success?: boolean; message?: string }
        | null;
      if (!response.ok || !payload?.success) {
        setMergingTaskIds((prev) => {
          const next = new Set(prev);
          next.delete(task.id);
          return next;
        });
        setStatusMessage(toErrorString(payload?.error, `Failed to queue merge (${response.status}).`));
        return;
      }
      setMergeNowToast(
        typeof payload.message === "string" && payload.message.trim()
          ? payload.message
          : "Merge queued with priority."
      );
      setStatusMessage(null);
      setIpcRefreshSignal((prev) => prev + 1);
    } catch {
      setMergingTaskIds((prev) => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
      setStatusMessage("Network error while queueing merge.");
    }
  };

  const handleRegeneratePreviews = async (task: BoardTask) => {
    if (!task.id.trim()) {
      return;
    }
    setRegeneratingPreviewTaskId(task.id);
    setPreviewRegenToast(null);
    try {
      const res = await fetch("/api/gallery/regenerate-previews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id }),
      });
      const data = (await res.json().catch(() => null)) as { error?: unknown; success?: boolean } | null;
      if (!res.ok) {
        setStatusMessage(toErrorString(data?.error, "Failed to queue preview regeneration."));
        return;
      }
      setPreviewRegenToast("Previews queued for regeneration");
      setStatusMessage(null);
    } catch {
      setStatusMessage("Network error while queueing preview regeneration.");
    } finally {
      setRegeneratingPreviewTaskId(null);
    }
  };

  const handleDeleteTask = async (task: BoardTask) => {
    if (!task.id.trim()) {
      return;
    }
    const confirmed = window.confirm(
      "Delete this task permanently? This will also permanently remove all task files from Supabase Storage."
    );
    if (!confirmed) {
      return;
    }

    const previousArchived = archivedTasksRef.current;
    setDeletingTaskId(task.id);
    setArchivedTasks((prev) => prev.filter((row) => row.id !== task.id));
    try {
      const response = await fetch("/api/tasks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ taskId: task.id }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: unknown; removedCount?: unknown }
        | null;
      if (!response.ok) {
        throw new Error(toErrorString(payload?.error, `Failed to delete task (${response.status}).`));
      }
      const removedCount =
        typeof payload?.removedCount === "number" && Number.isFinite(payload.removedCount)
          ? payload.removedCount
          : 0;
      setStatusMessage(`Task deleted permanently. Purged ${removedCount} storage object(s).`);
    } catch (error) {
      setArchivedTasks(previousArchived);
      setStatusMessage(toErrorString(error, "Task deletion failed."));
    } finally {
      setDeletingTaskId(null);
    }
  };

  return (
    <div className="relative min-w-0 w-full max-w-full">
      {!showArchived ? <DailyStreakBadge count={dailyCompletionCount} /> : null}
      {previewRegenToast ? (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed left-1/2 top-6 z-[100] w-full max-w-md -translate-x-1/2 px-4"
        >
          <p className="rounded-xl border border-blue-400/50 bg-blue-100/95 px-5 py-3 text-center text-sm font-semibold text-blue-900 shadow-2xl dark:border-blue-500/40 dark:bg-blue-950/95 dark:text-blue-100">
            {previewRegenToast}
          </p>
        </div>
      ) : null}
      {mergeNowToast ? (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed left-1/2 top-6 z-[100] w-full max-w-md -translate-x-1/2 px-4"
        >
          <p className="rounded-xl border border-amber-400/50 bg-amber-100/95 px-5 py-3 text-center text-sm font-semibold text-amber-900 shadow-2xl dark:border-amber-500/40 dark:bg-amber-950/95 dark:text-amber-100">
            {mergeNowToast}
          </p>
        </div>
      ) : null}
      {workflowToast ? (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed left-1/2 top-6 z-[100] w-full max-w-md -translate-x-1/2 px-4"
        >
          <p
            className={`rounded-xl px-5 py-3 text-center text-sm font-semibold shadow-2xl ${
              workflowToast.variant === "loading"
                ? "border border-violet-400/50 bg-violet-100/95 text-violet-900 dark:border-violet-500/40 dark:bg-violet-950/95 dark:text-violet-100"
                : workflowToast.variant === "success"
                  ? "border border-emerald-400/50 bg-emerald-100/95 text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-950/95 dark:text-emerald-100"
                  : "border border-red-400/50 bg-red-100/95 text-red-900 dark:border-red-500/40 dark:bg-red-950/95 dark:text-red-100"
            }`}
          >
            {workflowToast.message}
          </p>
        </div>
      ) : null}
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
      <div className="w-full max-w-full overflow-x-auto pb-3 [scrollbar-color:#4a4a4a_#000000] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-track]:bg-black [&::-webkit-scrollbar-thumb]:bg-zinc-600 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:border [&::-webkit-scrollbar-thumb]:border-black">
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
                {!authRoleLoading && isAdmin ? (
                  <button
                    type="button"
                    disabled={deletingTaskId === task.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleDeleteTask(task);
                    }}
                    className="ml-2 mt-3 rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-950/40"
                  >
                    {deletingTaskId === task.id ? "Deleting..." : "Delete Permanently"}
                  </button>
                ) : null}
              </article>
            ))}
            {!isLoading && archivedTasks.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">No archived tasks yet.</p>
            ) : null}
          </div>
        ) : (
          <div className="inline-flex min-w-max flex-nowrap gap-4">
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
                  {board[column.id].map((task, index) => (
                    <article
                      key={`${task.id}-${index}`}
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
                          {column.id === "selection-available" &&
                          (task.workflowStatus.trim().toLowerCase() === "selection failed" ||
                            Boolean(task.processingError?.trim())) ? (
                            <p
                              className="mt-2 rounded-md border border-red-300/80 bg-red-50 px-2 py-1.5 text-xs font-medium text-red-800 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-200"
                              title={task.processingError ?? "Merge failed"}
                            >
                              {task.workflowStatus.trim().toLowerCase() === "selection failed"
                                ? "Merge failed"
                                : "Processing error"}
                              {task.processingError?.trim()
                                ? `: ${
                                    task.processingError.length > 160
                                      ? `${task.processingError.slice(0, 159)}…`
                                      : task.processingError
                                  }`
                                : " — retry with Merge Now after fixing the issue."}
                            </p>
                          ) : null}
                          {task.linkedItemId ? (() => {
                            const linkedTask = COLUMN_CONFIG.flatMap((col) => board[col.id]).find((t) => t.id === task.linkedItemId);
                            return (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (linkedTask) onTaskClick?.(linkedTask);
                                }}
                                title={linkedTask ? `Linked: ${taskDisplayTitle(linkedTask)}` : "Linked task"}
                                className="mt-1 inline-flex items-center gap-1 rounded-md border border-violet-400/50 bg-violet-50 px-1.5 py-0.5 text-xs font-medium text-violet-700 hover:bg-violet-100 dark:border-violet-600/40 dark:bg-violet-950/30 dark:text-violet-300 dark:hover:bg-violet-950/60"
                              >
                                🔗 {linkedTask ? taskDisplayTitle(linkedTask) : "Linked"}
                              </button>
                            );
                          })() : null}
                          {liveEditingSeconds(task, clockMs) > 0 || task.editingStartedAt ? (
                            <div className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-500">
                              <p>
                                {task.editingStartedAt ? "Editing: " : "Total Edit Time: "}
                                {formatDuration(liveEditingSeconds(task, clockMs))}
                              </p>
                              {!authRoleLoading && isAdmin ? (
                                <button
                                  type="button"
                                  title="Edit duration"
                                  aria-label="Edit duration"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setDurationEditTaskId(task.id);
                                    setDurationEditInitialSeconds(liveEditingSeconds(task, clockMs));
                                    setDurationEditError(null);
                                  }}
                                  className="rounded p-0.5 text-zinc-400 opacity-0 transition hover:bg-zinc-200 hover:text-zinc-700 group-hover:opacity-100 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
                                >
                                  <Pencil className="h-3 w-3" strokeWidth={2} />
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                          {task.localFolderName?.trim() ? (
                            <button
                              type="button"
                              disabled={regeneratingPreviewTaskId === task.id}
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleRegeneratePreviews(task);
                              }}
                              className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-xs font-medium text-zinc-600 hover:border-zinc-300 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
                            >
                              {regeneratingPreviewTaskId === task.id ? (
                                <>
                                  <span
                                    className="inline-block size-3 animate-spin rounded-full border-2 border-zinc-500 border-t-transparent dark:border-zinc-300 dark:border-t-transparent"
                                    aria-hidden
                                  />
                                  Regenerating…
                                </>
                              ) : (
                                "Regenerate Previews"
                              )}
                            </button>
                          ) : null}
                          {column.id === "selection-available" && task.localFolderName?.trim() ? (
                            <button
                              type="button"
                              disabled={mergingTaskIds.has(task.id)}
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleMergeNow(task);
                              }}
                              className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-amber-300/80 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-70 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-950/70"
                            >
                              {mergingTaskIds.has(task.id) ? (
                                <>
                                  <span
                                    className="inline-block size-3 animate-spin rounded-full border-2 border-amber-600 border-t-transparent dark:border-amber-300 dark:border-t-transparent"
                                    aria-hidden
                                  />
                                  Merging…
                                </>
                              ) : (
                                "Merge Now"
                              )}
                            </button>
                          ) : null}
                          {mergingTaskIds.has(task.id) && column.id !== "selection-available" ? (
                            <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                              <span
                                className="inline-block size-3 animate-spin rounded-full border-2 border-amber-600 border-t-transparent dark:border-amber-300 dark:border-t-transparent"
                                aria-hidden
                              />
                              Merging…
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
      <EditDurationModal
        isOpen={durationEditTaskId !== null}
        title="Edit Duration"
        initialSeconds={durationEditInitialSeconds}
        isSaving={isSavingDuration}
        error={durationEditError}
        onCancel={() => {
          if (!isSavingDuration) {
            setDurationEditTaskId(null);
            setDurationEditError(null);
          }
        }}
        onSave={(seconds) => {
          void (async () => {
            if (!durationEditTaskId || isSavingDuration) return;
            setIsSavingDuration(true);
            setDurationEditError(null);
            try {
              const res = await adjustTaskEditingDuration(durationEditTaskId, seconds);
              if (!res.ok) {
                throw new Error(res.error);
              }
              setBoard((prev) => {
                const next = { ...prev };
                for (const column of COLUMN_CONFIG) {
                  next[column.id] = next[column.id].map((t) =>
                    t.id === durationEditTaskId
                      ? {
                          ...t,
                          totalEditingSeconds: res.totalEditingSeconds,
                          editingStartedAt: res.editingStartedAt,
                        }
                      : t
                  );
                }
                return next;
              });
              setArchivedTasks((prev) =>
                prev.map((t) =>
                  t.id === durationEditTaskId
                    ? {
                        ...t,
                        totalEditingSeconds: res.totalEditingSeconds,
                        editingStartedAt: res.editingStartedAt,
                      }
                    : t
                )
              );
              setDurationEditTaskId(null);
            } catch (err) {
              setDurationEditError(
                err instanceof Error ? err.message : "Could not save duration."
              );
            } finally {
              setIsSavingDuration(false);
            }
          })();
        }}
      />
    </div>
  );
}
