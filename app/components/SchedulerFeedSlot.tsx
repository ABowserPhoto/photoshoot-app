"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import { AlertCircle, Trash2 } from "lucide-react";
import type { DragEvent, ReactNode } from "react";

type FeedSlot = {
  id: string;
  fileUrl: string;
  scheduledAt: Date | null;
  isCustomSchedule?: boolean;
  caption?: string;
  postType?: string;
  status?: string | null;
  publishError?: string | null;
  metaCreationId?: string | null;
} | null;

type SchedulerFeedSlotProps = {
  slot: FeedSlot;
  absoluteIndex: number;
  localIndex: number;
  isHovered: boolean;
  isDragging: boolean;
  draggingSlot: number | null;
  scheduledLabel: string;
  onDelete: (index: number) => void;
  onEdit: (index: number) => void;
  onNativeDrop: (localIndex: number, event: DragEvent<HTMLDivElement>) => void;
  platformIcon: (platform: string, className?: string) => ReactNode;
};

export default function SchedulerFeedSlot({
  slot,
  absoluteIndex,
  localIndex,
  isHovered,
  isDragging,
  draggingSlot,
  scheduledLabel,
  onDelete,
  onEdit,
  onNativeDrop,
  platformIcon,
}: SchedulerFeedSlotProps) {
  const isEmpty = slot === null;

  const { attributes, listeners, setNodeRef: setDragRef, isDragging: isDndDragging } = useDraggable({
    id: `slot-drag-${absoluteIndex}`,
    disabled: isEmpty,
    data: { absoluteIndex },
  });

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `slot-drop-${absoluteIndex}`,
    data: { absoluteIndex, localIndex },
  });

  const setNodeRef = (node: HTMLDivElement | null) => {
    setDragRef(node);
    setDropRef(node);
  };

  const showHovered = isHovered || isOver;
  const showDragging = isDragging || isDndDragging;

  return (
    <div
      ref={setNodeRef}
      {...(!isEmpty ? { ...attributes, ...listeners } : {})}
      onDrop={(event) => onNativeDrop(localIndex, event)}
      onDragOver={(event) => event.preventDefault()}
      onClick={
        !isEmpty
          ? () => {
              if (draggingSlot !== null) {
                return;
              }
              onEdit(absoluteIndex);
            }
          : undefined
      }
      className={`group relative aspect-square overflow-hidden rounded-md transition touch-manipulation md:aspect-[4/5] ${
        isEmpty
          ? `border border-dashed ${
              showHovered
                ? "border-zinc-300 bg-zinc-800/80 shadow-[0_0_0_1px_rgba(244,244,245,0.5)]"
                : "border-zinc-700 bg-zinc-900/70"
            }`
          : "cursor-pointer border border-zinc-800 bg-zinc-900 ring-white/20 group-hover:ring-2"
      } ${showDragging ? "opacity-50" : ""}`}
      style={{ touchAction: isEmpty ? "auto" : "none" }}
    >
      {slot ? (
        <>
          <img
            src={slot.fileUrl}
            alt={`Scheduled slot ${absoluteIndex + 1}`}
            className="pointer-events-none h-full w-full object-cover"
            draggable={false}
          />
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDelete(absoluteIndex);
            }}
            onPointerDown={(event) => event.stopPropagation()}
            className="absolute left-2 top-2 z-10 rounded-md bg-black/70 p-1 text-zinc-200 opacity-100 transition hover:bg-red-600/90 hover:text-white md:opacity-0 md:group-hover:opacity-100"
            title="Delete post"
            aria-label={`Delete post in slot ${absoluteIndex + 1}`}
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
          {slot.status === "published" ? (
            <span
              className="absolute right-2 top-2 z-10 rounded-full bg-black/70 p-1 text-pink-300"
              title="Published to Instagram"
            >
              {platformIcon("instagram", "h-3.5 w-3.5")}
            </span>
          ) : slot.status === "scheduled_with_meta" ? (
            <span
              className="absolute right-2 top-2 z-10 rounded-full bg-emerald-900/80 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-200"
              title={
                slot.metaCreationId
                  ? `Scheduled with Meta (creation_id ${slot.metaCreationId})`
                  : "Scheduled with Instagram / Meta"
              }
            >
              Meta
            </span>
          ) : slot.status === "failed" ? (
            <span
              className="absolute right-2 top-2 z-10 rounded-full bg-black/70 p-1"
              title={slot.publishError?.trim() || "Publish failed"}
            >
              <AlertCircle className="h-3.5 w-3.5 text-red-500" aria-hidden />
            </span>
          ) : null}
          <span className="absolute bottom-2 left-2 right-2 rounded bg-black/70 px-2 py-0.5 text-[10px] font-medium leading-snug text-zinc-100">
            {scheduledLabel}
          </span>
        </>
      ) : (
        <div className="flex h-full items-center justify-center text-center text-[11px] text-zinc-500">
          Drop image
        </div>
      )}
    </div>
  );
}
