"use client";

import dynamic from "next/dynamic";
import {
  ArrowUpRight,
  Circle,
  FileText,
  GripHorizontal,
  Square,
  Trash2,
  Triangle,
  User,
  X,
} from "lucide-react";
import Link from "next/link";
import type { ChangeEvent, CSSProperties, Dispatch, SetStateAction } from "react";
import { Suspense, useCallback, useEffect, useRef, useState, startTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Rnd } from "react-rnd";
import type { CanvasPath } from "react-sketch-canvas";
import { ReactSketchCanvas, type ReactSketchCanvasRef } from "react-sketch-canvas";

import { generateMoodboardImage } from "@/app/actions/ai-generation";
import {
  createElement,
  createMoodboard,
  deleteElement,
  deleteMoodboard,
  getAllMoodboards,
  getMoodboardById,
  getOrCreateActiveMoodboard,
  updateElementContent,
  updateElementPosition,
  updateElementZIndex,
  updateMoodboardTitle,
  updateUserProfileMetadata,
  uploadMoodboardImage,
  type MoodboardElementRecord,
  type MoodboardRecord,
  type MoodboardSummary,
} from "@/app/actions/moodboard";
import { useAuthRole } from "@/app/contexts/AuthRoleContext";
import { getSafePosition } from "@/lib/moodboardPlacement";

const ReactPlayer = dynamic(() => import("react-player").then((m) => m.default), {
  ssr: false,
  loading: () => (
    <div className="flex flex-1 items-center justify-center p-4 text-xs text-zinc-500">
      Loading player…
    </div>
  ),
});

function dotGridStyle(): CSSProperties {
  return {
    backgroundColor: "rgb(24 24 27)",
    backgroundImage:
      "radial-gradient(circle at 1px 1px, rgba(161, 161, 170, 0.22) 1px, transparent 0)",
    backgroundSize: "22px 22px",
  };
}

function contentText(content: Record<string, unknown>): string {
  const t = content.text;
  return typeof t === "string" ? t : "";
}

function contentHex(content: Record<string, unknown>): string {
  const h = content.hex;
  if (typeof h === "string" && /^#[0-9A-Fa-f]{6}$/.test(h)) {
    return h;
  }
  return "#eab308";
}

function contentUrl(content: Record<string, unknown>): string {
  const u = content.url;
  return typeof u === "string" ? u : "";
}

function contentFileName(content: Record<string, unknown>): string {
  const n = content.fileName;
  return typeof n === "string" ? n : "";
}

function commentAuthorName(content: Record<string, unknown>): string {
  const legacy = content.name;
  const u = content.userName ?? legacy;
  return typeof u === "string" && u.trim() ? u.trim() : "User";
}

function commentAvatarUrl(content: Record<string, unknown>): string {
  const legacy = content.avatar_url;
  const u = content.avatarUrl ?? legacy;
  return typeof u === "string" ? u : "";
}

type ShapeTypeKey = "rectangle" | "circle" | "triangle";

function shapeTypeFromContent(content: Record<string, unknown>): ShapeTypeKey {
  const t = content.shapeType;
  if (t === "circle" || t === "triangle") {
    return t;
  }
  return "rectangle";
}

function shapeFillHex(content: Record<string, unknown>): string {
  const h = content.fillHex;
  if (typeof h === "string" && /^#[0-9A-Fa-f]{6}$/i.test(h)) {
    return h;
  }
  return "#d4d4d8";
}

function drawingStrokeHex(content: Record<string, unknown>): string {
  const h = content.strokeHex;
  if (typeof h === "string" && /^#[0-9A-Fa-f]{6}$/i.test(h)) {
    return h;
  }
  return "#fafafa";
}

function contentLabel(content: Record<string, unknown>): string {
  const l = content.label;
  return typeof l === "string" ? l : "";
}

function safeHref(url: string): string {
  const t = url.trim();
  if (!t) {
    return "#";
  }
  if (/^https?:\/\//i.test(t)) {
    return t;
  }
  return `https://${t}`;
}

/** Normalize video URLs for playback / persistence (YouTube often pasted without scheme). */
function videoUrlWithScheme(raw: string): string {
  const t = raw.trim();
  if (!t) {
    return "";
  }
  if (/^https?:\/\//i.test(t)) {
    return t;
  }
  return `https://${t}`;
}

function hostnameHint(url: string): string {
  try {
    const u = new URL(safeHref(url));
    return u.hostname || url.trim();
  } catch {
    return url.trim();
  }
}

function lineStrokeColor(content: Record<string, unknown>): string {
  const c = content.strokeColor;
  if (typeof c === "string" && /^#[0-9A-Fa-f]{6}$/i.test(c)) {
    return c;
  }
  return "#52525b";
}

function lineStrokeWidthPx(content: Record<string, unknown>): number {
  const w = content.strokeWidth;
  const n = typeof w === "number" ? w : Number(w);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 48) : 4;
}

function drawingPathsFromContent(content: Record<string, unknown>): CanvasPath[] {
  const dd = content.drawingData;
  if (!dd || typeof dd !== "object" || Array.isArray(dd)) {
    return [];
  }
  const paths = (dd as { paths?: unknown }).paths;
  return Array.isArray(paths) ? (paths as CanvasPath[]) : [];
}

function clampPct(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(100, Math.max(0, n));
}

function arrowGeometry(content: Record<string, unknown>) {
  const strokeColor = lineStrokeColor(content);
  const strokeWidth = lineStrokeWidthPx(content);
  const curved = Boolean(content.curved);
  const x1 = clampPct(content.x1, 12);
  const y1 = clampPct(content.y1, 88);
  const x2 = clampPct(content.x2, 88);
  const y2 = clampPct(content.y2, 12);
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const defaultQx = midX;
  const defaultQy = Math.max(2, midY - 28);
  const qx = curved ? clampPct(content.qx, defaultQx) : defaultQx;
  const qy = curved ? clampPct(content.qy, defaultQy) : defaultQy;
  return { strokeColor, strokeWidth, curved, x1, y1, x2, y2, qx, qy };
}

/** Sticky note background (stored as #rrggbb). */
function noteBgHex(content: Record<string, unknown>): string {
  const h = content.bgHex;
  if (typeof h === "string" && /^#[0-9A-Fa-f]{6}$/i.test(h)) {
    return h;
  }
  return "#fef9c3";
}

function noteTextToneClass(bgHex: string): string {
  const hex = bgHex.replace(/^#/, "");
  if (hex.length !== 6) {
    return "text-gray-900 placeholder:text-gray-600";
  }
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62
    ? "text-gray-900 placeholder:text-gray-600"
    : "text-zinc-50 placeholder:text-zinc-400";
}

function MoodboardArrowEditor({
  element,
  setElements,
  showControls,
  showArrowHead = true,
}: {
  element: MoodboardElementRecord;
  setElements: Dispatch<SetStateAction<MoodboardElementRecord[]>>;
  showControls: boolean;
  showArrowHead?: boolean;
}) {
  const g = arrowGeometry(element.content);
  const markerId = `mood-arrow-geom-${element.id}`;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestContentRef = useRef(element.content);

  useEffect(() => {
    latestContentRef.current = element.content;
  }, [element.content]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
    };
  }, []);

  const persistContent = useCallback(
    (content: Record<string, unknown>) => {
      void updateElementContent({ elementId: element.id, content }).then((res) => {
        if (!res.ok) {
          console.warn("[moodboard stroke content]", res.error);
        }
      });
    },
    [element.id]
  );

  const flushSave = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    persistContent(latestContentRef.current);
  }, [persistContent]);

  const scheduleSave = useCallback(
    (content: Record<string, unknown>) => {
      latestContentRef.current = content;
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
      saveTimer.current = setTimeout(() => {
        persistContent(latestContentRef.current);
      }, 450);
    },
    [persistContent]
  );

  const patch = (partial: Record<string, unknown>) => {
    const elementId = element.id;
    setElements((prev) => {
      const row = prev.find((x) => x.id === elementId);
      if (!row) {
        return prev;
      }
      const nextContent = { ...row.content, ...partial };
      scheduleSave(nextContent);
      return prev.map((item) => (item.id === elementId ? { ...item, content: nextContent } : item));
    });
  };

  const rangePointerHandlers = {
    onPointerUp: flushSave,
    onBlur: flushSave,
  };

  const pathD = g.curved
    ? `M ${g.x1} ${g.y1} Q ${g.qx} ${g.qy} ${g.x2} ${g.y2}`
    : `M ${g.x1} ${g.y1} L ${g.x2} ${g.y2}`;

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col bg-transparent pt-6 shadow-none ring-0">
      {showControls ? (
        <div className="flex max-h-[46%] shrink-0 flex-col gap-2 overflow-y-auto bg-transparent px-1 pb-1 shadow-none ring-0 print:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="color"
            value={g.strokeColor}
            onChange={(e) => patch({ strokeColor: e.target.value })}
            onBlur={flushSave}
            className="h-7 w-11 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0 shadow-none ring-0"
            aria-label={showArrowHead ? "Arrow color" : "Line color"}
          />
          <div className="flex gap-1">
            <button
              type="button"
              className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                !g.curved ? "bg-zinc-600 text-white" : "bg-zinc-800 text-zinc-500 hover:text-zinc-300"
              }`}
              onClick={() => patch({ curved: false })}
            >
              Straight
            </button>
            <button
              type="button"
              className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                g.curved ? "bg-zinc-600 text-white" : "bg-zinc-800 text-zinc-500 hover:text-zinc-300"
              }`}
              onClick={() => {
                const nextGeo = arrowGeometry({ ...element.content, curved: true });
                patch({ curved: true, qx: nextGeo.qx, qy: nextGeo.qy });
              }}
            >
              Curved
            </button>
          </div>
          <label className="flex min-w-[88px] flex-1 flex-col gap-0.5">
            <span className="text-[9px] uppercase tracking-wide text-zinc-500">Width</span>
            <input
              type="range"
              min={1}
              max={24}
              value={g.strokeWidth}
              onChange={(e) => patch({ strokeWidth: Number(e.target.value) })}
              {...rangePointerHandlers}
              className="w-full accent-zinc-400"
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-x-2 gap-y-1 sm:grid-cols-4">
          <label className="flex flex-col gap-0.5">
            <span className="text-[9px] uppercase tracking-wide text-zinc-500">Start X</span>
            <input
              type="range"
              min={0}
              max={100}
              value={g.x1}
              onChange={(e) => patch({ x1: Number(e.target.value) })}
              {...rangePointerHandlers}
              className="w-full accent-zinc-400"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[9px] uppercase tracking-wide text-zinc-500">Start Y</span>
            <input
              type="range"
              min={0}
              max={100}
              value={g.y1}
              onChange={(e) => patch({ y1: Number(e.target.value) })}
              {...rangePointerHandlers}
              className="w-full accent-zinc-400"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[9px] uppercase tracking-wide text-zinc-500">End X</span>
            <input
              type="range"
              min={0}
              max={100}
              value={g.x2}
              onChange={(e) => patch({ x2: Number(e.target.value) })}
              {...rangePointerHandlers}
              className="w-full accent-zinc-400"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[9px] uppercase tracking-wide text-zinc-500">End Y</span>
            <input
              type="range"
              min={0}
              max={100}
              value={g.y2}
              onChange={(e) => patch({ y2: Number(e.target.value) })}
              {...rangePointerHandlers}
              className="w-full accent-zinc-400"
            />
          </label>
        </div>
        {g.curved ? (
          <div className="grid grid-cols-2 gap-x-2 gap-y-1">
            <label className="flex flex-col gap-0.5">
              <span className="text-[9px] uppercase tracking-wide text-zinc-500">Bend X</span>
              <input
                type="range"
                min={0}
                max={100}
                value={g.qx}
                onChange={(e) => patch({ qx: Number(e.target.value) })}
                {...rangePointerHandlers}
                className="w-full accent-zinc-400"
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[9px] uppercase tracking-wide text-zinc-500">Bend Y</span>
              <input
                type="range"
                min={0}
                max={100}
                value={g.qy}
                onChange={(e) => patch({ qy: Number(e.target.value) })}
                {...rangePointerHandlers}
                className="w-full accent-zinc-400"
              />
            </label>
          </div>
        ) : null}
      </div>
      ) : null}
      <svg
        className="pointer-events-none min-h-0 flex-1"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        {showArrowHead ? (
          <defs>
            <marker
              id={markerId}
              markerWidth="10"
              markerHeight="10"
              refX="9"
              refY="3"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M0,0 L0,6 L9,3 z" fill={g.strokeColor} />
            </marker>
          </defs>
        ) : null}
        <path
          d={pathD}
          fill="none"
          stroke={g.strokeColor}
          strokeWidth={g.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          {...(showArrowHead ? { markerEnd: `url(#${markerId})` } : {})}
        />
      </svg>
    </div>
  );
}

function MoodboardDragHandle({ fadeUntilHover }: { fadeUntilHover?: boolean }) {
  if (fadeUntilHover) {
    return (
      <div className="drag-handle absolute left-0 top-0 z-10 flex h-6 w-full cursor-grab items-center justify-center rounded-t-md bg-transparent opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:bg-gray-200/50 active:cursor-grabbing dark:hover:bg-gray-700/50 print:hidden">
        <GripHorizontal size={14} className="text-gray-400 dark:text-gray-500" />
      </div>
    );
  }
  return (
    <div className="drag-handle group absolute left-0 top-0 z-10 flex h-6 w-full cursor-grab items-center justify-center rounded-t-md bg-transparent hover:bg-gray-200/50 active:cursor-grabbing dark:hover:bg-gray-700/50 print:hidden">
      <GripHorizontal
        size={14}
        className="text-gray-400 opacity-0 transition-opacity group-hover:opacity-100 dark:text-gray-500"
      />
    </div>
  );
}

function MoodboardDrawingEditor({
  element,
  setElements,
  showControls,
}: {
  element: MoodboardElementRecord;
  setElements: Dispatch<SetStateAction<MoodboardElementRecord[]>>;
  showControls: boolean;
}) {
  const sketchRef = useRef<ReactSketchCanvasRef>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const strokeHex = drawingStrokeHex(element.content);

  useEffect(() => {
    const paths = drawingPathsFromContent(element.content);
    let frame = 0;
    let attempts = 0;
    let cancelled = false;
    const tryHydrate = () => {
      if (cancelled) {
        return;
      }
      const c = sketchRef.current;
      if (c) {
        if (paths.length > 0) {
          c.loadPaths(paths);
        } else {
          c.clearCanvas();
        }
        return;
      }
      if (attempts < 20) {
        attempts += 1;
        frame = requestAnimationFrame(tryHydrate);
      }
    };
    frame = requestAnimationFrame(tryHydrate);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [element.id]);

  /** Merge paths into local state, then persist — never call server actions inside setState updaters. */
  const persistDrawingPaths = useCallback(
    (paths: CanvasPath[]) => {
      const elementId = element.id;
      let nextContent: Record<string, unknown> | undefined;
      setElements((prev) => {
        const row = prev.find((x) => x.id === elementId);
        if (!row) {
          return prev;
        }
        nextContent = { ...row.content, drawingData: { paths } };
        const safeContent = nextContent;
        return prev.map((item) => (item.id === elementId ? { ...item, content: safeContent } : item));
      });
      if (nextContent !== undefined) {
        const payload = nextContent;
        queueMicrotask(() => {
          void updateElementContent({ elementId, content: payload });
        });
      }
    },
    [element.id, setElements]
  );

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
    }
    saveTimer.current = setTimeout(async () => {
      const c = sketchRef.current;
      if (!c) {
        return;
      }
      const paths = await c.exportPaths();
      persistDrawingPaths(paths);
    }, 650);
  }, [persistDrawingPaths]);

  const handleClear = () => {
    sketchRef.current?.clearCanvas();
    persistDrawingPaths([]);
  };

  const handleStrokeColorChange = (nextHex: string) => {
    const elementId = element.id;
    let nextContent: Record<string, unknown> | undefined;
    setElements((prev) => {
      const row = prev.find((x) => x.id === elementId);
      if (!row) {
        return prev;
      }
      nextContent = { ...row.content, strokeHex: nextHex };
      const safeContent = nextContent;
      return prev.map((item) => (item.id === elementId ? { ...item, content: safeContent } : item));
    });
    if (nextContent !== undefined) {
      const payload = nextContent;
      queueMicrotask(() => {
        void updateElementContent({ elementId, content: payload });
      });
    }
  };

  return (
    <div className="relative h-full w-full overflow-hidden bg-transparent shadow-none ring-0">
      {showControls ? (
        <div className="absolute left-1/2 top-0 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-lg border border-zinc-600 bg-zinc-900/95 px-2 py-1 shadow-lg print:hidden">
          <input
            type="color"
            value={strokeHex}
            onChange={(e) => handleStrokeColorChange(e.target.value)}
            className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0"
            aria-label="Drawing stroke color"
          />
        </div>
      ) : null}
      <button
        type="button"
        className="absolute left-2 top-2 z-10 rounded border border-zinc-600 bg-zinc-800 px-2 py-0.5 text-[10px] font-semibold text-zinc-200 hover:bg-zinc-700 print:hidden"
        onClick={handleClear}
      >
        Clear
      </button>
      <ReactSketchCanvas
        ref={sketchRef}
        className="touch-none"
        width="100%"
        height="100%"
        strokeColor={strokeHex}
        strokeWidth={2}
        canvasColor="transparent"
        style={{ width: "100%", height: "100%" }}
        onStroke={() => {
          scheduleSave();
        }}
        onChange={() => {
          scheduleSave();
        }}
      />
    </div>
  );
}

function MoodboardShapeEditor({
  element,
  setElements,
  showControls,
}: {
  element: MoodboardElementRecord;
  setElements: Dispatch<SetStateAction<MoodboardElementRecord[]>>;
  showControls: boolean;
}) {
  const shapeType = shapeTypeFromContent(element.content);
  const fillHex = shapeFillHex(element.content);

  const applyChange = useCallback(
    (partial: Partial<{ shapeType: ShapeTypeKey; fillHex: string }>) => {
      const nextContent = { ...element.content, ...partial };
      setElements((prev) =>
        prev.map((item) => (item.id === element.id ? { ...item, content: nextContent } : item))
      );
      void updateElementContent({ elementId: element.id, content: nextContent }).then((res) => {
        if (!res.ok) {
          console.warn("[moodboard shape content]", res.error);
        }
      });
    },
    [element.content, element.id, setElements]
  );

  return (
    <div className="relative h-full min-h-0 w-full bg-transparent pt-6 shadow-none ring-0">
      {showControls ? (
        <div className="absolute left-1/2 top-0 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-lg border border-zinc-600 bg-zinc-900/95 px-2 py-1 shadow-lg print:hidden">
          <input
            type="color"
            value={fillHex}
            onChange={(e) => applyChange({ fillHex: e.target.value })}
            className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0"
            aria-label="Shape fill color"
          />
          <div className="flex gap-0.5">
            <button
              type="button"
              title="Rectangle"
              className={`rounded p-1 ${
                shapeType === "rectangle"
                  ? "bg-zinc-600 text-white"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              }`}
              onClick={() => applyChange({ shapeType: "rectangle" })}
            >
              <Square size={14} />
            </button>
            <button
              type="button"
              title="Circle"
              className={`rounded p-1 ${
                shapeType === "circle"
                  ? "bg-zinc-600 text-white"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              }`}
              onClick={() => applyChange({ shapeType: "circle" })}
            >
              <Circle size={14} />
            </button>
            <button
              type="button"
              title="Triangle"
              className={`rounded p-1 ${
                shapeType === "triangle"
                  ? "bg-zinc-600 text-white"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              }`}
              onClick={() => applyChange({ shapeType: "triangle" })}
            >
              <Triangle size={14} />
            </button>
          </div>
        </div>
      ) : null}
      <svg className="h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        {shapeType === "rectangle" ? (
          <rect width="100%" height="100%" fill={fillHex} />
        ) : shapeType === "circle" ? (
          <ellipse cx="50%" cy="50%" rx="50%" ry="50%" fill={fillHex} />
        ) : (
          <polygon points="50,0 100,100 0,100" fill={fillHex} />
        )}
      </svg>
    </div>
  );
}

function MoodboardCommentBlock({
  element,
  setElements,
  scheduleNoteSave,
  moodboardId,
  onError,
}: {
  element: MoodboardElementRecord;
  setElements: Dispatch<SetStateAction<MoodboardElementRecord[]>>;
  scheduleNoteSave: (elementId: string, content: Record<string, unknown>) => void;
  moodboardId: string;
  onError: (message: string) => void;
}) {
  const avatarUrl = commentAvatarUrl(element.content);
  const [nameDraft, setNameDraft] = useState(() => commentAuthorName(element.content));

  useEffect(() => {
    setNameDraft(commentAuthorName(element.content));
  }, [element.id, element.content]);

  const handleNameBlur = () => {
    const userName = nameDraft.trim() || "User";
    setNameDraft(userName);
    const next = { ...element.content, userName };
    setElements((prev) =>
      prev.map((item) => (item.id === element.id ? { ...item, content: next } : item))
    );
    void updateElementContent({ elementId: element.id, content: next }).then((res) => {
      if (!res.ok) {
        onError(res.error);
        return;
      }
      void updateUserProfileMetadata({ firstName: userName }).then((metaRes) => {
        if (!metaRes.ok) {
          onError(metaRes.error);
        }
      });
    });
  };

  const handleAvatarUpload = async (file: File | null) => {
    if (!file) {
      return;
    }
    const fd = new FormData();
    fd.set("moodboardId", moodboardId);
    fd.set("file", file);
    const res = await uploadMoodboardImage(fd);
    if (!res.ok) {
      onError(res.error);
      return;
    }
    const next = { ...element.content, avatarUrl: res.publicUrl };
    setElements((prev) =>
      prev.map((item) => (item.id === element.id ? { ...item, content: next } : item))
    );
    const up = await updateElementContent({ elementId: element.id, content: next });
    if (!up.ok) {
      onError(up.error);
      return;
    }
    const metaRes = await updateUserProfileMetadata({ avatarUrl: res.publicUrl });
    if (!metaRes.ok) {
      onError(metaRes.error);
    }
  };

  return (
    <div className="group/comment flex h-full w-full flex-col items-center gap-3 pt-6">
      <label className="group/avatar relative h-16 w-16 shrink-0 cursor-pointer overflow-hidden rounded-full shadow-xl">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- user avatar from auth metadata
          <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <User className="h-full w-full p-3 text-zinc-500" strokeWidth={1.25} />
        )}
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-black/55 text-xs font-bold uppercase tracking-wide text-white opacity-0 transition-opacity group-hover/avatar:opacity-100">
          Edit
        </span>
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(e) => {
            void handleAvatarUpload(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
      </label>
      <div className="flex w-full flex-1 flex-col items-center gap-2 rounded-xl bg-white p-4 shadow-xl dark:bg-zinc-800">
        <input
          type="text"
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={handleNameBlur}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder="Your name"
          className="w-full border-0 bg-transparent text-center text-sm font-semibold text-zinc-900 outline-none placeholder:font-normal placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500"
        />
        <textarea
          value={contentText(element.content)}
          onChange={(e) => {
            const text = e.target.value;
            const next = { ...element.content, text };
            setElements((prev) =>
              prev.map((item) => (item.id === element.id ? { ...item, content: next } : item))
            );
            scheduleNoteSave(element.id, next);
          }}
          onBlur={() => {
            const next = { ...element.content, text: contentText(element.content) };
            void updateElementContent({ elementId: element.id, content: next });
          }}
          placeholder="Add a comment…"
          className="min-h-0 w-full flex-1 resize-none border-0 bg-transparent text-center text-sm leading-snug text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500"
        />
      </div>
    </div>
  );
}

function MoodboardFileBlock({
  element,
  isSelected,
  onUpload,
}: {
  element: MoodboardElementRecord;
  isSelected: boolean;
  onUpload: (file: File | null) => void;
}) {
  const fileUrl = contentUrl(element.content);
  const fileName = contentFileName(element.content);
  const hasFile = Boolean(fileUrl.trim());

  if (!hasFile) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col items-center justify-center gap-3 bg-zinc-900 px-4 pb-3 pt-8">
        <FileText className="h-8 w-8 text-zinc-500" strokeWidth={1.5} />
        <label className="cursor-pointer rounded-lg border border-dashed border-zinc-600 bg-zinc-800/60 px-4 py-2.5 text-xs font-semibold text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-800">
          Upload document
          <input
            type="file"
            className="sr-only"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.rar,.7z,.txt,.csv,.json,.xml,.md"
            onChange={(e) => {
              onUpload(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
        </label>
        <p className="text-center text-[10px] text-zinc-500">PDF, Word, ZIP, and more</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col justify-center gap-3 bg-zinc-900 px-4 pb-3 pt-8">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-800 ring-1 ring-zinc-700">
          <FileText className="h-5 w-5 text-cyan-400" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-100">{fileName || "Document"}</p>
          <a
            href={fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1.5 inline-flex rounded-md border border-zinc-600 bg-zinc-800 px-2.5 py-1 text-[11px] font-semibold text-zinc-200 transition hover:bg-zinc-700"
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            Open / Download
          </a>
        </div>
      </div>
      {isSelected ? (
        <label className="self-start cursor-pointer rounded border border-zinc-600 bg-zinc-800 px-2.5 py-1 text-[10px] font-semibold text-zinc-300 transition hover:bg-zinc-700 print:hidden">
          Replace file
          <input
            type="file"
            className="sr-only"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.rar,.7z,.txt,.csv,.json,.xml,.md"
            onChange={(e) => {
              onUpload(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
        </label>
      ) : null}
    </div>
  );
}

function MoodboardVideoBlock({
  element,
  setElements,
  onActivate,
  isSelected,
}: {
  element: MoodboardElementRecord;
  setElements: Dispatch<SetStateAction<MoodboardElementRecord[]>>;
  onActivate: (elementId: string) => void;
  isSelected: boolean;
}) {
  const persistedRaw =
    typeof element.content?.url === "string" ? element.content.url : "";
  const hasPersistedUrl = Boolean(persistedRaw.trim());

  const [localUrl, setLocalUrl] = useState(() => persistedRaw || "");
  const [editingLink, setEditingLink] = useState(false);

  useEffect(() => {
    setLocalUrl(typeof element.content?.url === "string" ? element.content.url : "");
  }, [element.id, persistedRaw]);

  const commitUrl = useCallback(() => {
    const trimmed = localUrl.trim();
    const toSave = trimmed === "" ? "" : videoUrlWithScheme(trimmed);
    const elementId = element.id;

    let nextContent: Record<string, unknown> | undefined;
    setElements((prev) => {
      const row = prev.find((x) => x.id === elementId);
      if (!row) {
        return prev;
      }
      nextContent = { ...row.content, url: toSave };
      const safeContent = nextContent;
      return prev.map((item) => (item.id === elementId ? { ...item, content: safeContent } : item));
    });

    if (nextContent !== undefined) {
      const payload = nextContent;
      queueMicrotask(() => {
        void updateElementContent({ elementId, content: payload });
      });
    }
    setEditingLink(false);
  }, [element.id, localUrl, setElements]);

  /** Resolved playback URL from saved content (scheme-safe for YouTube/embeds). */
  const resolvedPlayerUrl =
    typeof element.content?.url === "string" ? videoUrlWithScheme(element.content.url) : "";

  const showInputOnly = !hasPersistedUrl || editingLink;

  if (showInputOnly) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col justify-center gap-2 bg-zinc-900 px-3 pb-3 pt-6 print:hidden">
        <label htmlFor={`moodboard-video-url-${element.id}`} className="text-xs text-zinc-400">
          Paste YouTube or Video URL and press Enter
        </label>
        <input
          id={`moodboard-video-url-${element.id}`}
          type="url"
          value={localUrl}
          onChange={(e) => setLocalUrl(e.target.value)}
          onBlur={() => commitUrl()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitUrl();
            }
          }}
          placeholder="https://…"
          className="relative z-10 w-full shrink-0 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 outline-none focus:ring-1 focus:ring-cyan-500"
        />
        {hasPersistedUrl ? (
          <button
            type="button"
            className="self-start text-[11px] font-medium text-zinc-500 underline hover:text-zinc-300"
            onClick={() => {
              setEditingLink(false);
              setLocalUrl(persistedRaw);
            }}
          >
            Cancel
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col bg-zinc-900 px-2 pb-2 pt-6">
      <div
        className="relative z-20 min-h-0 flex-1 overflow-hidden rounded-lg bg-black ring-1 ring-zinc-700"
        style={{ pointerEvents: "auto" }}
        onMouseDown={(e) => {
          onActivate(element.id);
          e.stopPropagation();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <ReactPlayer
          key={resolvedPlayerUrl}
          src={resolvedPlayerUrl}
          width="100%"
          height="100%"
          controls={true}
          playsInline
          style={{ position: "absolute", inset: 0 }}
        />
        {isSelected ? (
        <button
          type="button"
          className="absolute right-2 top-2 z-30 rounded-md border border-zinc-600 bg-zinc-900/90 px-2 py-1 text-[10px] font-semibold text-zinc-200 shadow hover:bg-zinc-800 print:hidden"
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setEditingLink(true);
            setLocalUrl(persistedRaw);
          }}
        >
          Edit link
        </button>
        ) : null}
      </div>
    </div>
  );
}

type ElementTypeKey =
  | "note"
  | "color"
  | "image"
  | "link"
  | "video"
  | "line"
  | "drawing"
  | "arrow"
  | "comment"
  | "file"
  | "shape";

const ELEMENT_DEFAULT_SIZE: Record<ElementTypeKey, { w: number; h: number }> = {
  note: { w: 240, h: 180 },
  color: { w: 140, h: 140 },
  image: { w: 320, h: 220 },
  link: { w: 320, h: 168 },
  video: { w: 420, h: 280 },
  line: { w: 280, h: 200 },
  drawing: { w: 340, h: 260 },
  arrow: { w: 280, h: 200 },
  comment: { w: 280, h: 320 },
  file: { w: 280, h: 120 },
  shape: { w: 200, h: 160 },
};

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  return target.isContentEditable;
}

function MoodboardPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const boardIdParam = searchParams.get("boardId");
  const { authenticated, isLoading: authLoading } = useAuthRole();
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const elementsRef = useRef<MoodboardElementRecord[]>([]);
  const skipNextImageUrlBlurSaveRef = useRef<Record<string, boolean>>({});
  const titleSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteSaveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [moodboard, setMoodboard] = useState<MoodboardRecord | null>(null);
  const [elements, setElements] = useState<MoodboardElementRecord[]>([]);
  const [titleDraft, setTitleDraft] = useState("");
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [allBoards, setAllBoards] = useState<MoodboardSummary[]>([]);
  const [activeMoodboardId, setActiveMoodboardId] = useState<string | null>(null);
  const [isAiSidebarOpen, setIsAiSidebarOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiGeneratedUrl, setAiGeneratedUrl] = useState<string | null>(null);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [linkedNoteId, setLinkedNoteId] = useState<string | null>(null);

  useEffect(() => {
    elementsRef.current = elements;
  }, [elements]);

  useEffect(() => {
    const moodboardId = activeMoodboardId?.trim();
    if (!moodboardId || !authenticated) {
      setLinkedNoteId(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(
          `/api/notes?moodboardId=${encodeURIComponent(moodboardId)}`
        );
        const payload = (await response.json().catch(() => null)) as
          | { note?: { id?: string } | null }
          | null;
        if (cancelled) return;
        const id =
          response.ok && payload?.note && typeof payload.note.id === "string"
            ? payload.note.id
            : null;
        setLinkedNoteId(id);
      } catch {
        if (!cancelled) setLinkedNoteId(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeMoodboardId, authenticated]);

  const loadMoodboard = useCallback(async (preferredBoardId?: string | null) => {
    setLoading(true);
    setError(null);
    const targetId = preferredBoardId?.trim() || boardIdParam?.trim() || null;

    const [boardsRes, boardRes] = await Promise.all([
      getAllMoodboards(),
      targetId ? getMoodboardById(targetId) : getOrCreateActiveMoodboard(),
    ]);

    if (boardsRes.ok) {
      setAllBoards(boardsRes.moodboards);
    } else {
      console.warn("[moodboard list]", boardsRes.error);
      setAllBoards([]);
    }

    if (!boardRes.ok) {
      setError(boardRes.error);
      setMoodboard(null);
      setElements([]);
      setSelectedElementId(null);
      setActiveMoodboardId(null);
    } else {
      setMoodboard(boardRes.moodboard);
      setActiveMoodboardId(boardRes.moodboard.id);
      setTitleDraft(boardRes.moodboard.title);
      setElements(boardRes.elements);
      setSelectedElementId(null);
    }
    setLoading(false);
  }, [boardIdParam]);

  useEffect(() => {
    if (authLoading) {
      return;
    }
    if (!authenticated) {
      startTransition(() => setLoading(false));
      return;
    }
    startTransition(() => {
      void loadMoodboard();
    });
  }, [authLoading, authenticated, loadMoodboard]);

  useEffect(() => {
    if (!moodboard?.id) {
      return;
    }
    const id = moodboard.id;
    const t = titleDraft.trim();
    if (titleSaveTimer.current) {
      clearTimeout(titleSaveTimer.current);
    }
    titleSaveTimer.current = setTimeout(() => {
      void (async () => {
        const nextTitle = t || "Untitled Moodboard";
        const res = await updateMoodboardTitle(id, nextTitle);
        if (!res.ok) {
          console.warn("[moodboard title]", res.error);
          return;
        }
        setAllBoards((prev) => prev.map((b) => (b.id === id ? { ...b, title: nextTitle } : b)));
      })();
    }, 600);
    return () => {
      if (titleSaveTimer.current) {
        clearTimeout(titleSaveTimer.current);
      }
    };
  }, [titleDraft, moodboard?.id]);

  const persistPosition = useCallback((el: MoodboardElementRecord, x: number, y: number, w: number, h: number) => {
    void updateElementPosition({
      elementId: el.id,
      x,
      y,
      width: w,
      height: h,
    }).then((res) => {
      if (!res.ok) {
        console.warn("[moodboard position]", res.error);
      }
    });
  }, []);

  const handleBringToFront = useCallback((elementId: string) => {
    const currentElements = elementsRef.current;
    const row = currentElements.find((e) => e.id === elementId);
    if (!row) {
      return;
    }
    const maxZ = currentElements.reduce((acc, e) => Math.max(acc, e.z_index ?? 0), 0);
    const nextZ = maxZ + 1;
    setElements((prev) => prev.map((e) => (e.id === elementId ? { ...e, z_index: nextZ } : e)));
    void updateElementZIndex({ elementId, zIndex: nextZ }).then((res) => {
      if (!res.ok) {
        console.warn("[moodboard z-index]", res.error);
      }
    });
  }, []);

  const activateElement = useCallback(
    (elementId: string) => {
      setSelectedElementId(elementId);
      handleBringToFront(elementId);
    },
    [handleBringToFront]
  );

  const scheduleNoteSave = useCallback((elementId: string, content: Record<string, unknown>) => {
    if (noteSaveTimers.current[elementId]) {
      clearTimeout(noteSaveTimers.current[elementId]);
    }
    noteSaveTimers.current[elementId] = setTimeout(() => {
      void updateElementContent({ elementId, content }).then((res) => {
        if (!res.ok) {
          console.warn("[moodboard content]", res.error);
        }
      });
    }, 450);
  }, []);

  const commitImageUrlForElement = useCallback((elementId: string, rawUrl: string) => {
    const row = elementsRef.current.find((item) => item.id === elementId);
    if (!row) {
      return;
    }
    const url = rawUrl.trim();
    const nextContent = { ...row.content, url };
    setElements((prev) =>
      prev.map((item) => (item.id === elementId ? { ...item, content: nextContent } : item))
    );
    void updateElementContent({ elementId, content: nextContent }).then((res) => {
      if (!res.ok) {
        console.warn("[moodboard image url]", res.error);
      }
    });
  }, []);

  const calculateVisibleCenterCoord = useCallback(() => {
    const node = canvasContainerRef.current;
    if (!node) {
      return { x: 400, y: 300 };
    }
    return {
      x: node.scrollLeft + node.clientWidth / 2,
      y: node.scrollTop + node.clientHeight / 2,
    };
  }, []);

  const resolveSafeElementPosition = useCallback(
    (width: number, height: number) => {
      const center = calculateVisibleCenterCoord();
      const existingItems = elementsRef.current.map((el) => ({
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
      }));
      return getSafePosition({ width, height }, existingItems, center.x, center.y);
    },
    [calculateVisibleCenterCoord]
  );

  const handleAdd = async (type: ElementTypeKey) => {
    if (!moodboard?.id) {
      return;
    }
    const { w, h } = ELEMENT_DEFAULT_SIZE[type];
    const { x, y } = resolveSafeElementPosition(w, h);
    const res = await createElement({
      moodboardId: moodboard.id,
      type,
      x,
      y,
      width: w,
      height: h,
    });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setElements((prev) => [...prev, res.element]);
    setSelectedElementId(res.element.id);
  };

  const handleDelete = useCallback(async (elementId: string) => {
    const res = await deleteElement(elementId);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setElements((prev) => prev.filter((e) => e.id !== elementId));
    setSelectedElementId((prev) => (prev === elementId ? null : prev));
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") {
        return;
      }
      if (!selectedElementId) {
        return;
      }
      if (isEditableKeyboardTarget(document.activeElement)) {
        return;
      }
      e.preventDefault();
      void handleDelete(selectedElementId);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedElementId, handleDelete]);

  const handleBoardSwitch = (e: ChangeEvent<HTMLSelectElement>) => {
    const nextId = e.target.value.trim();
    if (!nextId || nextId === activeMoodboardId) {
      return;
    }
    router.replace(`/moodboard?boardId=${encodeURIComponent(nextId)}`, { scroll: false });
  };

  const handleNewBoard = async () => {
    const res = await createMoodboard("Untitled Moodboard");
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.replace(`/moodboard?boardId=${encodeURIComponent(res.id)}`, { scroll: false });
  };

  const handleDeleteBoard = async () => {
    if (!activeMoodboardId) {
      return;
    }
    if (!window.confirm("Are you sure you want to delete this moodboard?")) {
      return;
    }
    const res = await deleteMoodboard(activeMoodboardId);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const listRes = await getAllMoodboards();
    if (listRes.ok && listRes.moodboards.length > 0) {
      router.replace(`/moodboard?boardId=${encodeURIComponent(listRes.moodboards[0].id)}`, {
        scroll: false,
      });
      return;
    }
    const created = await createMoodboard("Untitled Moodboard");
    if (!created.ok) {
      setError(created.error);
      return;
    }
    router.replace(`/moodboard?boardId=${encodeURIComponent(created.id)}`, { scroll: false });
  };

  const handleAiGenerate = async () => {
    setAiGenerating(true);
    setAiGeneratedUrl(null);
    try {
      const res = await generateMoodboardImage(aiPrompt);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setAiGeneratedUrl(res.imageUrl);
    } finally {
      setAiGenerating(false);
    }
  };

  const handleAddAiImageToBoard = async () => {
    if (!moodboard?.id || !aiGeneratedUrl) {
      return;
    }
    const imgW = 320;
    const imgH = 220;
    const { x, y } = resolveSafeElementPosition(imgW, imgH);
    const res = await createElement({
      moodboardId: moodboard.id,
      type: "image",
      x,
      y,
      width: imgW,
      height: imgH,
      content: { url: aiGeneratedUrl },
    });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setElements((prev) => [...prev, res.element]);
    activateElement(res.element.id);
  };

  const handleImageUpload = async (element: MoodboardElementRecord, file: File | null) => {
    if (!file || !moodboard?.id) {
      return;
    }
    const fd = new FormData();
    fd.set("moodboardId", moodboard.id);
    fd.set("file", file);
    const res = await uploadMoodboardImage(fd);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const nextContent = { ...element.content, url: res.publicUrl };
    setElements((prev) => prev.map((e) => (e.id === element.id ? { ...e, content: nextContent } : e)));
    const up = await updateElementContent({ elementId: element.id, content: nextContent });
    if (!up.ok) {
      setError(up.error);
    }
  };

  const handleFileUpload = async (element: MoodboardElementRecord, file: File | null) => {
    if (!file || !moodboard?.id) {
      return;
    }
    const fd = new FormData();
    fd.set("moodboardId", moodboard.id);
    fd.set("file", file);
    const res = await uploadMoodboardImage(fd);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const nextContent = { ...element.content, url: res.publicUrl, fileName: file.name };
    setElements((prev) => prev.map((e) => (e.id === element.id ? { ...e, content: nextContent } : e)));
    const up = await updateElementContent({ elementId: element.id, content: nextContent });
    if (!up.ok) {
      setError(up.error);
    }
  };

  if (authLoading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-zinc-950 px-4 py-12 text-sm text-zinc-400">
        Checking session…
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 bg-zinc-950 px-4 py-12 text-center">
        <p className="text-sm text-zinc-300">Sign in to use the Moodboard.</p>
      </div>
    );
  }

  return (
    <div className="relative h-[calc(100dvh-64px)] w-full overflow-hidden bg-zinc-950 print:absolute print:inset-0 print:h-auto print:overflow-visible">
      <style>{`
  @media print {
    @page { size: landscape; margin: 0cm; }
    body, html, main, #__next {
      height: auto !important;
      overflow: visible !important;
      background-color: #171717 !important; /* Enforce dark mode background */
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    /* Hide the Aaron Bowser Photography global footer */
    footer, [class*="footer"] {
      display: none !important;
    }
    header, nav, [class*="nav"], [class*="header"] {
      display: none !important;
    }
  }
`}</style>
      {linkedNoteId ? (
        <Link
          href={`/notes?noteId=${encodeURIComponent(linkedNoteId)}`}
          aria-label="Open linked note"
          title="Open linked note"
          className="absolute right-3 top-3 z-50 rounded p-1.5 text-gray-400 opacity-60 transition-all hover:text-gray-900 hover:opacity-100 print:hidden"
        >
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      ) : null}
      <div className="pointer-events-none absolute left-0 top-0 z-40 flex w-full items-center justify-between p-6 print:hidden">
        <div className="pointer-events-auto flex min-w-0 flex-1 items-center gap-2">
          <select
            value={activeMoodboardId ?? ""}
            onChange={handleBoardSwitch}
            disabled={loading || allBoards.length === 0}
            className="max-w-[min(200px,28vw)] shrink-0 rounded-lg border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm text-zinc-200 shadow-lg backdrop-blur-sm outline-none ring-zinc-500 focus:ring-2 disabled:opacity-50"
            aria-label="Switch moodboard"
          >
            {allBoards.length === 0 ? (
              <option value="">No boards</option>
            ) : (
              allBoards.map((board) => (
                <option key={board.id} value={board.id}>
                  {board.title}
                </option>
              ))
            )}
          </select>
          <button
            type="button"
            onClick={() => void handleDeleteBoard()}
            disabled={loading || !activeMoodboardId}
            className="shrink-0 rounded-lg border border-zinc-700/80 bg-zinc-900/90 px-2.5 py-2 text-sm text-zinc-400 shadow-lg backdrop-blur-sm transition hover:border-red-800/60 hover:bg-red-950/40 hover:text-red-300 disabled:opacity-50"
            aria-label="Delete moodboard"
            title="Delete moodboard"
          >
            🗑️
          </button>
          <button
            type="button"
            onClick={() => void handleNewBoard()}
            disabled={loading}
            className="shrink-0 rounded-lg border border-zinc-600 bg-zinc-800/90 px-3 py-2 text-sm font-semibold text-zinc-100 shadow-lg backdrop-blur-sm transition hover:bg-zinc-700 disabled:opacity-50"
          >
            ➕ New Board
          </button>
          <label className="min-w-0 max-w-xs flex-1">
            <span className="sr-only">Moodboard title</span>
            <input
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              placeholder="Moodboard title"
              className="w-full rounded-lg border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm font-semibold text-white shadow-lg backdrop-blur-sm outline-none ring-zinc-500 focus:ring-2"
            />
          </label>
        </div>
        <div className="pointer-events-auto flex shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={() => setIsAiSidebarOpen((o) => !o)}
            disabled={loading}
            className={`rounded-lg border px-4 py-2 text-sm font-semibold shadow-lg backdrop-blur-sm transition disabled:opacity-50 ${
              isAiSidebarOpen
                ? "border-violet-500 bg-violet-950/90 text-violet-100 hover:bg-violet-900/90"
                : "border-zinc-600 bg-zinc-800/90 text-zinc-100 hover:bg-zinc-700"
            }`}
          >
            ✨ AI Generator
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            disabled={loading}
            className="rounded-lg border border-zinc-600 bg-zinc-800/90 px-4 py-2 text-sm font-semibold text-zinc-100 shadow-lg backdrop-blur-sm transition hover:bg-zinc-700 disabled:opacity-50"
          >
            Export
          </button>
        </div>
      </div>

      {error ? (
        <div className="absolute left-4 top-16 z-[96] max-w-md rounded-lg border border-red-800/60 bg-red-950/90 px-3 py-2 text-xs text-red-100 print:hidden">
          {error}
          <button type="button" className="ml-2 underline" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="flex h-full items-center justify-center text-sm text-zinc-500">
          Loading moodboard…
        </div>
      ) : (
        <>
          <div className="relative h-full w-full overflow-hidden print:h-auto print:overflow-visible">
            <div
              ref={canvasContainerRef}
              id="moodboard-canvas"
              className="absolute inset-0 overflow-auto print:relative print:h-auto print:overflow-visible"
              style={dotGridStyle()}
              onPointerDown={(e) => {
                const t = e.target as Element | null;
                if (t && typeof t.closest === "function" && t.closest("[data-moodboard-element]")) {
                  return;
                }
                setSelectedElementId(null);
              }}
            >
            {elements.map((el) => {
              const isGhost =
                el.type === "line" ||
                el.type === "drawing" ||
                el.type === "arrow" ||
                el.type === "shape" ||
                el.type === "comment";
              const isSelected = selectedElementId === el.id;
              const showSelected = isSelected;
              return (
              <Rnd
                key={el.id}
                size={{ width: el.width, height: el.height }}
                position={{ x: el.x, y: el.y }}
                minWidth={72}
                minHeight={56}
                dragHandleClassName="drag-handle"
                style={{ zIndex: el.z_index ?? 0 }}
                enableResizing={{
                  top: true,
                  right: true,
                  bottom: true,
                  left: true,
                  topRight: true,
                  bottomRight: true,
                  bottomLeft: true,
                  topLeft: true,
                }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  activateElement(el.id);
                }}
                onDragStop={(e, d) => {
                  const x = Math.round(d.x);
                  const y = Math.round(d.y);
                  setElements((prev) =>
                    prev.map((item) => (item.id === el.id ? { ...item, x, y } : item))
                  );
                  persistPosition(el, x, y, el.width, el.height);
                }}
                onResizeStop={(e, _dir, ref, _delta, position) => {
                  const w = Math.max(1, Math.round(ref.offsetWidth));
                  const h = Math.max(1, Math.round(ref.offsetHeight));
                  const x = Math.round(position.x);
                  const y = Math.round(position.y);
                  setElements((prev) =>
                    prev.map((item) =>
                      item.id === el.id ? { ...item, x, y, width: w, height: h } : item
                    )
                  );
                  persistPosition(el, x, y, w, h);
                }}
                className={`group border border-transparent print:border-transparent ${isGhost ? "hover:border-transparent" : "hover:border-zinc-600/50"}`}
              >
                <div
                  data-moodboard-element={el.id}
                  className={`relative h-full w-full ${isGhost ? "group overflow-visible rounded-none bg-transparent shadow-none ring-0" : "overflow-hidden rounded-lg shadow-lg ring-1 ring-black/20 print:border-transparent print:shadow-none print:ring-0"}`}
                >
                  <MoodboardDragHandle fadeUntilHover={isGhost} />
                  <button
                    type="button"
                    onClick={() => void handleDelete(el.id)}
                    className="absolute right-1 top-7 z-30 rounded-md bg-black/55 p-1 text-zinc-200 opacity-0 transition hover:bg-red-600/90 hover:text-white group-hover:opacity-100 print:hidden"
                    aria-label="Delete element"
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={2} />
                  </button>

                  {el.type === "note" ? (
                    <div
                      className="flex h-full min-h-0 w-full flex-col pt-6 shadow-none ring-0"
                      style={{ backgroundColor: noteBgHex(el.content) }}
                    >
                      {showSelected ? (
                        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-black/10 px-2 py-1.5 print:hidden">
                          <span className="text-[10px] font-medium uppercase tracking-wide text-black/40 dark:text-black/35">
                            Note color
                          </span>
                          <input
                            type="color"
                            value={noteBgHex(el.content)}
                            onChange={(e) => {
                              const bgHex = e.target.value;
                              const next = { ...el.content, bgHex };
                              setElements((prev) =>
                                prev.map((item) => (item.id === el.id ? { ...item, content: next } : item))
                              );
                              void updateElementContent({ elementId: el.id, content: next });
                            }}
                            className="h-7 w-12 cursor-pointer rounded border border-black/15 bg-transparent p-0"
                            aria-label="Note background color"
                          />
                          <span className="font-mono text-[10px] uppercase text-black/45">
                            {noteBgHex(el.content)}
                          </span>
                        </div>
                      ) : null}
                      <textarea
                        value={contentText(el.content)}
                        onChange={(e) => {
                          const text = e.target.value;
                          const next = { ...el.content, text };
                          setElements((prev) =>
                            prev.map((item) => (item.id === el.id ? { ...item, content: next } : item))
                          );
                          scheduleNoteSave(el.id, next);
                        }}
                        placeholder="Note…"
                        className={`min-h-0 flex-1 resize-none border-0 bg-transparent p-3 text-sm leading-snug outline-none ${noteTextToneClass(noteBgHex(el.content))}`}
                      />
                    </div>
                  ) : null}

                  {el.type === "color" ? (
                    <div className="relative h-full min-h-0 w-full pt-6">
                      <div
                        className="relative h-full w-full rounded-md shadow-inner ring-1 ring-black/30"
                        style={{ backgroundColor: contentHex(el.content) }}
                      >
                        <span className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 font-mono text-sm font-semibold tracking-wider text-white mix-blend-difference">
                          {contentHex(el.content).toUpperCase()}
                        </span>
                      </div>
                      {showSelected ? (
                        <div className="absolute bottom-2 left-2 z-10 print:hidden">
                          <input
                            type="color"
                            value={contentHex(el.content)}
                            onChange={(e) => {
                              const hex = e.target.value;
                              const next = { ...el.content, hex };
                              setElements((prev) =>
                                prev.map((item) => (item.id === el.id ? { ...item, content: next } : item))
                              );
                              void updateElementContent({ elementId: el.id, content: next });
                            }}
                            className="h-9 w-14 cursor-pointer rounded border border-zinc-600 bg-zinc-800"
                            aria-label="Pick color"
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {el.type === "image" ? (
                    <div
                      className={`flex h-full min-h-0 w-full flex-col bg-zinc-900 px-2 pb-2 pt-6 ${showSelected ? "gap-2" : ""}`}
                    >
                      <div className="relative min-h-0 flex-1 overflow-hidden rounded-md bg-zinc-800 ring-1 ring-zinc-700">
                        {contentUrl(el.content) ? (
                          // eslint-disable-next-line @next/next/no-img-element -- user-supplied / pasted URLs
                          <img
                            src={contentUrl(el.content)}
                            alt=""
                            className="absolute inset-0 h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center px-2 text-center text-xs text-zinc-500">
                            {isSelected
                              ? "Paste an image URL or upload a file"
                              : "Click tile to add image URL or upload"}
                          </div>
                        )}
                      </div>
                      {showSelected ? (
                        <div className="print:hidden">
                        <>
                          <input
                            type="url"
                            value={contentUrl(el.content)}
                            onChange={(e) => {
                              const url = e.target.value;
                              const next = { ...el.content, url };
                              setElements((prev) =>
                                prev.map((item) => (item.id === el.id ? { ...item, content: next } : item))
                              );
                            }}
                            onBlur={(e) => {
                              if (skipNextImageUrlBlurSaveRef.current[el.id]) {
                                skipNextImageUrlBlurSaveRef.current[el.id] = false;
                                return;
                              }
                              commitImageUrlForElement(el.id, e.currentTarget.value);
                            }}
                            onKeyDown={(e) => {
                              if (e.key !== "Enter") {
                                return;
                              }
                              e.preventDefault();
                              skipNextImageUrlBlurSaveRef.current[el.id] = true;
                              commitImageUrlForElement(el.id, e.currentTarget.value);
                              (e.currentTarget as HTMLInputElement).blur();
                            }}
                            placeholder="https://…"
                            className="w-full shrink-0 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 outline-none focus:ring-1 focus:ring-zinc-500"
                          />
                          <label className="block shrink-0">
                            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                              Upload to storage
                            </span>
                            <input
                              type="file"
                              accept="image/*"
                              className="block w-full text-xs text-zinc-400 file:mr-2 file:rounded file:border-0 file:bg-zinc-700 file:px-2 file:py-1 file:text-zinc-100"
                              onChange={(e) => void handleImageUpload(el, e.target.files?.[0] ?? null)}
                            />
                          </label>
                        </>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {el.type === "link" ? (
                    <div className="flex h-full min-h-0 w-full flex-col gap-2 bg-zinc-900 px-3 pb-3 pt-6">
                      {(showSelected || !contentUrl(el.content).trim()) ? (
                        <div className="print:hidden">
                        <>
                          <input
                            type="url"
                            value={contentUrl(el.content)}
                            onChange={(e) => {
                              const url = e.target.value;
                              const next = { ...el.content, url };
                              setElements((prev) =>
                                prev.map((item) => (item.id === el.id ? { ...item, content: next } : item))
                              );
                            }}
                            onBlur={(e) => {
                              const url = e.target.value.trim();
                              setElements((prev) => {
                                const next = prev.map((item) =>
                                  item.id === el.id
                                    ? { ...item, content: { ...item.content, url } }
                                    : item
                                );
                                const row = next.find((x) => x.id === el.id);
                                if (row) {
                                  void updateElementContent({ elementId: el.id, content: row.content });
                                }
                                return next;
                              });
                            }}
                            placeholder="https://example.com"
                            className="w-full shrink-0 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 outline-none focus:ring-1 focus:ring-violet-500"
                          />
                          <input
                            type="text"
                            value={contentLabel(el.content)}
                            onChange={(e) => {
                              const label = e.target.value;
                              const next = { ...el.content, label };
                              setElements((prev) =>
                                prev.map((item) => (item.id === el.id ? { ...item, content: next } : item))
                              );
                            }}
                            onBlur={() => {
                              setElements((prev) => {
                                const row = prev.find((x) => x.id === el.id);
                                if (row) {
                                  void updateElementContent({ elementId: el.id, content: row.content });
                                }
                                return prev;
                              });
                            }}
                            placeholder="Title (optional)"
                            className="w-full shrink-0 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-100 outline-none focus:ring-1 focus:ring-violet-500"
                          />
                        </>
                        </div>
                      ) : null}
                      {contentUrl(el.content).trim() ? (
                        <a
                          href={safeHref(contentUrl(el.content))}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`flex min-h-0 flex-col gap-1 rounded-xl border border-zinc-700 bg-gradient-to-br from-zinc-800 to-zinc-900 p-3 shadow-inner transition hover:border-violet-500/50 hover:from-zinc-700 ${showSelected ? "mt-auto" : "flex-1 justify-center"}`}
                        >
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-300/90">
                            Link
                          </span>
                          <span className="line-clamp-2 text-sm font-semibold text-white">
                            {contentLabel(el.content).trim() || hostnameHint(contentUrl(el.content))}
                          </span>
                          <span className="truncate text-[11px] text-zinc-400">
                            {hostnameHint(contentUrl(el.content))}
                          </span>
                        </a>
                      ) : showSelected ? (
                        <p className="text-[11px] text-zinc-500">Enter a URL to show a bookmark card.</p>
                      ) : (
                        <p className="flex flex-1 items-center justify-center text-center text-[11px] text-zinc-500">
                          Click tile to add link
                        </p>
                      )}
                    </div>
                  ) : null}

                  {el.type === "video" ? (
                    <MoodboardVideoBlock
                      element={el}
                      setElements={setElements}
                      onActivate={activateElement}
                      isSelected={showSelected}
                    />
                  ) : null}

                  {el.type === "arrow" ? (
                    <MoodboardArrowEditor
                      element={el}
                      setElements={setElements}
                      showControls={showSelected}
                    />
                  ) : null}

                  {el.type === "line" ? (
                    <MoodboardArrowEditor
                      element={el}
                      setElements={setElements}
                      showControls={showSelected}
                      showArrowHead={false}
                    />
                  ) : null}

                  {el.type === "drawing" ? (
                    <div className="h-full min-h-[120px] w-full bg-transparent px-1 pb-1 pt-6 shadow-none ring-0">
                      <MoodboardDrawingEditor
                        element={el}
                        setElements={setElements}
                        showControls={showSelected}
                      />
                    </div>
                  ) : null}

                  {el.type === "comment" ? (
                    <MoodboardCommentBlock
                      element={el}
                      setElements={setElements}
                      scheduleNoteSave={scheduleNoteSave}
                      moodboardId={moodboard?.id ?? ""}
                      onError={setError}
                    />
                  ) : null}

                  {el.type === "file" ? (
                    <MoodboardFileBlock
                      element={el}
                      isSelected={showSelected}
                      onUpload={(file) => void handleFileUpload(el, file)}
                    />
                  ) : null}

                  {el.type === "shape" ? (
                    <MoodboardShapeEditor
                      element={el}
                      setElements={setElements}
                      showControls={showSelected}
                    />
                  ) : null}
                </div>
              </Rnd>
              );
            })}
            </div>
          </div>

          <div className="pointer-events-none fixed bottom-6 left-1/2 z-[9999] max-w-[calc(100vw-2rem)] -translate-x-1/2 print:hidden">
            <div className="pointer-events-auto flex max-h-[40vh] flex-wrap items-center justify-center gap-1.5 overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-900/95 px-3 py-2 shadow-2xl backdrop-blur-md">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void handleAdd("image")}
                  className="rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-100 transition hover:bg-zinc-700"
                >
                  ➕ Image
                </button>
                <button
                  type="button"
                  onClick={() => void handleAdd("video")}
                  className="rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-100 transition hover:bg-zinc-700"
                >
                  ➕ Video
                </button>
                <button
                  type="button"
                  onClick={() => void handleAdd("link")}
                  className="rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-100 transition hover:bg-zinc-700"
                >
                  ➕ Link
                </button>
                <button
                  type="button"
                  onClick={() => void handleAdd("file")}
                  className="rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-100 transition hover:bg-zinc-700"
                >
                  ➕ File
                </button>
              </div>
              <div className="mx-0.5 hidden h-7 w-px shrink-0 bg-zinc-600/80 sm:block" aria-hidden />
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void handleAdd("line")}
                  className="rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-100 transition hover:bg-zinc-700"
                >
                  ➕ Line
                </button>
                <button
                  type="button"
                  onClick={() => void handleAdd("arrow")}
                  className="rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-100 transition hover:bg-zinc-700"
                >
                  ➕ Arrow
                </button>
                <button
                  type="button"
                  onClick={() => void handleAdd("shape")}
                  className="rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-100 transition hover:bg-zinc-700"
                >
                  ➕ Shape
                </button>
              </div>
              <div className="mx-0.5 hidden h-7 w-px shrink-0 bg-zinc-600/80 sm:block" aria-hidden />
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void handleAdd("drawing")}
                  className="rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-100 transition hover:bg-zinc-700"
                >
                  ➕ Drawing
                </button>
                <button
                  type="button"
                  onClick={() => void handleAdd("note")}
                  className="rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-100 transition hover:bg-zinc-700"
                >
                  ➕ Note
                </button>
                <button
                  type="button"
                  onClick={() => void handleAdd("comment")}
                  className="rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-100 transition hover:bg-zinc-700"
                >
                  ➕ Comment
                </button>
                <button
                  type="button"
                  onClick={() => void handleAdd("color")}
                  className="rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-100 transition hover:bg-zinc-700"
                >
                  ➕ Color
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      <aside
        className={`fixed top-[64px] right-0 bottom-0 z-50 flex w-96 transform flex-col border-l border-neutral-700 bg-neutral-900 shadow-2xl transition-transform duration-300 ease-in-out print:hidden ${
          isAiSidebarOpen ? "translate-x-0" : "translate-x-full"
        }`}
        aria-hidden={!isAiSidebarOpen}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-neutral-700 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-100">AI image generator</h2>
          <button
            type="button"
            onClick={() => setIsAiSidebarOpen(false)}
            className="rounded-md p-1.5 text-zinc-400 transition hover:bg-neutral-800 hover:text-zinc-100"
            aria-label="Close AI sidebar"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          <label className="flex flex-col gap-1.5 text-xs font-medium text-zinc-400">
            Prompt
            <textarea
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              rows={6}
              placeholder="A moody editorial photoshoot in a library…"
              disabled={aiGenerating}
              className="resize-y rounded-lg border border-neutral-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none ring-zinc-500 placeholder:text-zinc-600 focus:ring-2 disabled:opacity-60"
            />
          </label>
          <button
            type="button"
            onClick={() => void handleAiGenerate()}
            disabled={aiGenerating || !aiPrompt.trim()}
            className="rounded-lg border border-violet-600 bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white shadow transition hover:bg-violet-600 disabled:opacity-50"
          >
            {aiGenerating ? "Generating…" : "Generate"}
          </button>
          {aiGenerating ? (
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <span
                className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-zinc-600 border-t-violet-400"
                aria-hidden
              />
              Creating your image…
            </div>
          ) : null}
          <div className="min-h-[200px] flex-1 rounded-lg border border-dashed border-neutral-700 bg-zinc-950/80 p-2">
            {aiGeneratedUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- remote preview URL
              <img
                src={aiGeneratedUrl}
                alt="Generated preview"
                className="mx-auto max-h-[280px] w-full rounded-md object-contain"
              />
            ) : (
              <p className="flex h-full min-h-[180px] items-center justify-center px-2 text-center text-xs text-zinc-600">
                Generated image preview appears here.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => void handleAddAiImageToBoard()}
            disabled={!aiGeneratedUrl || aiGenerating}
            className="rounded-lg border border-emerald-600 bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white shadow transition hover:bg-emerald-600 disabled:opacity-50"
          >
            ➕ Add to Board
          </button>
        </div>
      </aside>
    </div>
  );
}

export default function MoodboardPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-[calc(100dvh-64px)] items-center justify-center bg-zinc-950 text-sm text-zinc-500">
          Loading moodboard…
        </div>
      }
    >
      <MoodboardPageContent />
    </Suspense>
  );
}
