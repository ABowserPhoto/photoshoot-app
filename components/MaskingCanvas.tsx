"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Circle, Image as KonvaImage, Layer, Line, Rect, Stage } from "react-konva";

type MaskingCanvasProps = {
  imageUrl: string;
  width: number;
  height: number;
  onMaskExport?: (maskBlob: Blob) => void;
  onSelectionChange?: (hasSelection: boolean) => void;
};

export type MaskingCanvasHandle = {
  exportMaskBlob: () => Promise<Blob | null>;
  clearSelection: () => void;
  hasSelection: () => boolean;
};

const CLOSE_DISTANCE_PX = 14;

function flattenPoints(points: Array<{ x: number; y: number }>): number[] {
  return points.flatMap((point) => [point.x, point.y]);
}

function isNearFirstPoint(points: Array<{ x: number; y: number }>, nextPoint: { x: number; y: number }): boolean {
  if (points.length < 3) {
    return false;
  }
  const firstPoint = points[0];
  const dx = firstPoint.x - nextPoint.x;
  const dy = firstPoint.y - nextPoint.y;
  return Math.hypot(dx, dy) <= CLOSE_DISTANCE_PX;
}

const MaskingCanvas = forwardRef<MaskingCanvasHandle, MaskingCanvasProps>(function MaskingCanvas(
  { imageUrl, width, height, onMaskExport, onSelectionChange },
  ref
) {
  const stageRef = useRef<import("konva/lib/Stage").Stage>(null);
  const [backgroundImage, setBackgroundImage] = useState<HTMLImageElement | null>(null);
  const [points, setPoints] = useState<Array<{ x: number; y: number }>>([]);
  const [isClosed, setIsClosed] = useState(false);
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number } | null>(null);
  const [isExportingMask, setIsExportingMask] = useState(false);

  const clearSelection = useCallback(() => {
    setPoints([]);
    setIsClosed(false);
    setHoverPoint(null);
    onSelectionChange?.(false);
  }, [onSelectionChange]);

  useEffect(() => {
    clearSelection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl]);

  useEffect(() => {
    if (!imageUrl) {
      setBackgroundImage(null);
      return;
    }
    const nextImage = new window.Image();
    nextImage.crossOrigin = "anonymous";
    nextImage.src = imageUrl;
    nextImage.onload = () => {
      setBackgroundImage(nextImage);
    };
    nextImage.onerror = () => {
      setBackgroundImage(null);
    };
  }, [imageUrl]);

  const hasSelection = useMemo(() => isClosed && points.length >= 3, [isClosed, points.length]);

  const closeShape = useCallback(() => {
    if (points.length >= 3) {
      setIsClosed(true);
      setHoverPoint(null);
      onSelectionChange?.(true);
    }
  }, [onSelectionChange, points.length]);

  const undoLastPoint = useCallback(() => {
    setPoints((prev) => {
      if (prev.length === 0) {
        return prev;
      }
      const nextPoints = prev.slice(0, -1);
      if (nextPoints.length < 3) {
        setIsClosed(false);
        onSelectionChange?.(false);
      }
      return nextPoints;
    });
    setHoverPoint(null);
  }, [onSelectionChange]);

  const handleStagePointerDown = () => {
    if (isClosed) {
      return;
    }
    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();
    if (!pointer) {
      return;
    }
    if (isNearFirstPoint(points, pointer)) {
      closeShape();
      return;
    }
    setPoints((prev) => [...prev, pointer]);
  };

  const handleStagePointerMove = () => {
    if (isClosed) {
      return;
    }
    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();
    if (!pointer) {
      setHoverPoint(null);
      return;
    }
    setHoverPoint(pointer);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditableTarget =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable === true;
      if (isEditableTarget) {
        return;
      }

      if (event.key === "Backspace" || event.key === "Delete") {
        if (points.length > 0) {
          event.preventDefault();
          undoLastPoint();
        }
        return;
      }

      if (event.key === "Enter" && !isClosed && points.length >= 3) {
        event.preventDefault();
        closeShape();
        return;
      }

      if (event.key === "Escape") {
        if (points.length > 0 || isClosed) {
          event.preventDefault();
          clearSelection();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [clearSelection, closeShape, isClosed, points.length, undoLastPoint]);

  const exportMaskBlob = useCallback(async (): Promise<Blob | null> => {
    if (!stageRef.current || !hasSelection) {
      return null;
    }
    setIsExportingMask(true);
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    try {
      const blob = (await stageRef.current.toBlob({
        mimeType: "image/png",
        pixelRatio: 1,
      })) as Blob | null;
      if (!blob) {
        return null;
      }
      onMaskExport?.(blob);
      return blob;
    } finally {
      setIsExportingMask(false);
    }
  }, [hasSelection, onMaskExport]);

  useImperativeHandle(
    ref,
    () => ({
      exportMaskBlob,
      clearSelection,
      hasSelection: () => hasSelection,
    }),
    [clearSelection, exportMaskBlob, hasSelection]
  );

  const openPath = useMemo(() => {
    if (isClosed || points.length === 0) {
      return flattenPoints(points);
    }
    if (!hoverPoint) {
      return flattenPoints(points);
    }
    return flattenPoints([...points, hoverPoint]);
  }, [hoverPoint, isClosed, points]);

  if (!imageUrl || width <= 0 || height <= 0) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
        Load an image to start masking.
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative overflow-hidden rounded-lg border border-zinc-300 shadow-lg shadow-black/20 dark:border-zinc-700">
        {!isExportingMask ? (
          <div className="pointer-events-none absolute left-2 top-2 z-10 rounded-md bg-black/60 px-2 py-1 text-[11px] font-medium text-white">
            Click to place points, Enter/double-click to close, Backspace to undo, Esc to clear.
          </div>
        ) : null}
        {!isExportingMask && hasSelection ? (
          <div className="pointer-events-none absolute right-2 top-2 z-10 rounded-md bg-emerald-600/90 px-2 py-1 text-[11px] font-semibold text-white">
            Selection closed
          </div>
        ) : null}
        <Stage
          ref={stageRef}
          width={width}
          height={height}
          onMouseDown={handleStagePointerDown}
          onMouseMove={handleStagePointerMove}
          onMouseLeave={() => setHoverPoint(null)}
          onDblClick={closeShape}
        >
          <Layer>
            <Rect x={0} y={0} width={width} height={height} fill={isExportingMask ? "#000000" : "transparent"} />
            {backgroundImage && !isExportingMask ? (
              <KonvaImage image={backgroundImage} width={width} height={height} listening={false} />
            ) : null}
            {points.length > 0 ? (
              <Line
                points={isClosed ? flattenPoints(points) : openPath}
                closed={isClosed}
                stroke={isExportingMask ? "#FFFFFF" : "#ef4444"}
                strokeWidth={isExportingMask ? 0 : 2}
                fill={isClosed ? (isExportingMask ? "#FFFFFF" : "rgba(255, 0, 0, 0.4)") : undefined}
                listening={false}
              />
            ) : null}
            {!isExportingMask
              ? points.map((point, index) => (
                  <Circle key={`point-${index}`} x={point.x} y={point.y} radius={4} fill="#ef4444" listening={false} />
                ))
              : null}
          </Layer>
        </Stage>
      </div>
      <button
        type="button"
        onClick={clearSelection}
        className="inline-flex h-8 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        Clear Selection
      </button>
    </div>
  );
});

export default MaskingCanvas;
