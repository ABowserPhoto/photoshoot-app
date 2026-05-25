"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent, type SyntheticEvent } from "react";

type LightboxViewerProps = {
  imageUrl: string;
  taskId: string;
  onClose: () => void;
  localFolderName?: string;
  filename?: string;
  absoluteLocalPath?: string;
  storagePath?: string;
};

function toSafeFilename(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    const decodedPath = decodeURIComponent(url.pathname);
    const parts = decodedPath.split("/").filter(Boolean);
    return (parts.at(-1) ?? "").trim();
  } catch {
    const normalized = trimmed.replace(/\\/g, "/");
    const parts = normalized.split("/").filter(Boolean);
    const last = parts.at(-1) ?? trimmed;
    const [withoutQuery] = last.split("?");
    const [withoutHash] = withoutQuery.split("#");
    return decodeURIComponent(withoutHash).trim();
  }
}

export default function LightboxViewer({
  imageUrl,
  taskId,
  onClose,
  localFolderName = "",
  filename = "",
  absoluteLocalPath = "",
  storagePath = "",
}: LightboxViewerProps) {
  const [isSmartSelectMode, setIsSmartSelectMode] = useState(false);
  const [targetCoords, setTargetCoords] = useState<Array<{ x: number; y: number }>>([]);
  const [markerPositions, setMarkerPositions] = useState<Array<{ x: number; y: number }>>([]);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [isActionSuccess, setIsActionSuccess] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [isGeneratingMask, setIsGeneratingMask] = useState(false);
  const [samTextPrompt, setSamTextPrompt] = useState("");
  const [brightness, setBrightness] = useState(1);
  const [saturation, setSaturation] = useState(1);
  const [hue, setHue] = useState(0);
  const [contrast, setContrast] = useState(1);
  const [blur, setBlur] = useState(0);
  const [shadows, setShadows] = useState(0);
  const [highlights, setHighlights] = useState(0);
  const [generatedMaskPath, setGeneratedMaskPath] = useState<string | null>(null);
  const [displayImageUrl, setDisplayImageUrl] = useState(imageUrl);
  const [currentSourcePath, setCurrentSourcePath] = useState(absoluteLocalPath);
  const [isApplyingEdit, setIsApplyingEdit] = useState(false);
  const maskPollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const resolvedFilename = filename.trim() || toSafeFilename(imageUrl);

  const handleClose = useCallback(
    (event?: SyntheticEvent) => {
      event?.stopPropagation();
      onClose();
    },
    [onClose]
  );

  const clearMaskPollInterval = useCallback(() => {
    if (maskPollIntervalRef.current !== null) {
      clearInterval(maskPollIntervalRef.current);
      maskPollIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        handleClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleClose]);

  useEffect(() => {
    return () => {
      clearMaskPollInterval();
    };
  }, [clearMaskPollInterval]);

  useEffect(() => {
    setDisplayImageUrl(imageUrl);
    setCurrentSourcePath(absoluteLocalPath);
  }, [imageUrl, absoluteLocalPath]);

  useEffect(() => {
    setBrightness(1);
    setSaturation(1);
    setHue(0);
    setContrast(1);
    setBlur(0);
    setShadows(0);
    setHighlights(0);
  }, [absoluteLocalPath, taskId]);

  useEffect(() => {
    clearMaskPollInterval();
    setIsSmartSelectMode(false);
    setTargetCoords([]);
    setMarkerPositions([]);
    setActionMessage(null);
    setIsActionSuccess(false);
    setIsActionLoading(false);
    setIsGeneratingMask(false);
    setSamTextPrompt("");
    setGeneratedMaskPath(null);
    setIsApplyingEdit(false);
  }, [clearMaskPollInterval, absoluteLocalPath, taskId]);

  const handleImageClick = (event: MouseEvent<HTMLImageElement>) => {
    if (!isSmartSelectMode) {
      return;
    }

    const img = event.currentTarget;
    const scaleX = img.naturalWidth / img.clientWidth;
    const scaleY = img.naturalHeight / img.clientHeight;
    const naturalX = Math.round(event.nativeEvent.offsetX * scaleX);
    const naturalY = Math.round(event.nativeEvent.offsetY * scaleY);

    setTargetCoords((prev) => [...prev, { x: naturalX, y: naturalY }]);
    setMarkerPositions((prev) => [
      ...prev,
      { x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY },
    ]);
  };

  const handleReplaceSky = useCallback(async () => {
    if (!resolvedFilename) {
      console.log("[LightboxViewer] Replace Sky: missing filename");
      setActionMessage("Missing filename for sky replacement.");
      return;
    }

    setIsActionLoading(true);
    setActionMessage(null);
    setIsActionSuccess(false);
    try {
      const res = await fetch("/api/ai-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          local_folder_name: localFolderName,
          task_id: taskId,
          filename: resolvedFilename,
        }),
      });
      const data = (await res.json().catch(() => null)) as { error?: unknown; promptId?: string } | null;
      if (!res.ok) {
        console.log("[LightboxViewer] Replace Sky failed", data?.error);
        setActionMessage("Replace Sky request failed.");
        return;
      }
      setActionMessage(data?.promptId ? `Sky replacement queued (${data.promptId}).` : "Sky replacement queued.");
    } catch (error) {
      console.log("[LightboxViewer] Replace Sky error", error);
      setActionMessage("Network error while queuing sky replacement.");
    } finally {
      setIsActionLoading(false);
    }
  }, [localFolderName, resolvedFilename, taskId]);

  const handleRemoveObject = useCallback(async () => {
    const removalTarget = window.prompt("What would you like to remove?")?.trim() ?? "";
    if (!removalTarget) {
      return;
    }

    const imagePath = absoluteLocalPath.trim();
    if (!imagePath) {
      console.log("[LightboxViewer] Remove Object: missing absoluteLocalPath");
      setActionMessage("Local file path unavailable for object removal.");
      return;
    }

    setIsActionLoading(true);
    setActionMessage(null);
    setIsActionSuccess(false);
    try {
      const res = await fetch("/api/ai-remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imagePath,
          removalTarget,
        }),
      });
      const data = (await res.json().catch(() => null)) as { error?: unknown; promptId?: string } | null;
      if (!res.ok) {
        console.log("[LightboxViewer] Remove Object failed", data?.error);
        setActionMessage("Remove Object request failed.");
        return;
      }
      setActionMessage(
        data?.promptId ? `Object removal queued (${data.promptId}).` : "Object removal queued."
      );
    } catch (error) {
      console.log("[LightboxViewer] Remove Object error", error);
      setActionMessage("Network error while queuing object removal.");
    } finally {
      setIsActionLoading(false);
    }
  }, [absoluteLocalPath]);

  const handleGenerateMask = useCallback(async () => {
    const trimmedTextPrompt = samTextPrompt.trim();
    if (targetCoords.length === 0 && !trimmedTextPrompt) {
      return;
    }

    const imagePath = absoluteLocalPath.trim();
    if (!imagePath) {
      console.log("[LightboxViewer] Generate Mask: missing absoluteLocalPath");
      setActionMessage("Local file path unavailable for mask generation.");
      setIsActionSuccess(false);
      return;
    }

    clearMaskPollInterval();
    setIsGeneratingMask(true);
    setActionMessage(null);
    setIsActionSuccess(false);
    try {
      const res = await fetch("/api/generate-mask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          absoluteLocalPath: imagePath,
          targetCoords,
          taskId,
          samTextPrompt: trimmedTextPrompt,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { error?: unknown; success?: boolean; prompt_id?: string | null }
        | null;
      if (!res.ok) {
        console.log("[LightboxViewer] Generate Mask failed", data?.error);
        setActionMessage("Mask generation request failed.");
        setIsActionSuccess(false);
        setIsGeneratingMask(false);
        return;
      }

      const promptId = data?.prompt_id?.trim() ?? "";
      if (!promptId) {
        setActionMessage("Mask generation queued but no prompt_id was returned.");
        setIsActionSuccess(false);
        setIsGeneratingMask(false);
        return;
      }

      maskPollIntervalRef.current = setInterval(() => {
        void (async () => {
          try {
            const statusRes = await fetch(
              `/api/check-mask-status?prompt_id=${encodeURIComponent(promptId)}`,
              { cache: "no-store" }
            );
            const statusData = (await statusRes.json().catch(() => null)) as
              | { status?: string; maskPath?: string; error?: unknown }
              | null;

            if (!statusRes.ok) {
              clearMaskPollInterval();
              setIsGeneratingMask(false);
              setActionMessage("Failed to check mask generation status.");
              setIsActionSuccess(false);
              return;
            }

            if (statusData?.status === "processing") {
              return;
            }

            if (statusData?.status === "done" && statusData.maskPath) {
              clearMaskPollInterval();
              setGeneratedMaskPath(statusData.maskPath);
              setTargetCoords([]);
              setMarkerPositions([]);
              setSamTextPrompt("");
              setIsGeneratingMask(false);
              setActionMessage("Mask generated and loaded!");
              setIsActionSuccess(true);
              return;
            }

            clearMaskPollInterval();
            setIsGeneratingMask(false);
            setActionMessage("Mask generation finished but no mask file was found.");
            setIsActionSuccess(false);
          } catch (error) {
            console.log("[LightboxViewer] Mask status poll error", error);
            clearMaskPollInterval();
            setIsGeneratingMask(false);
            setActionMessage("Network error while waiting for mask generation.");
            setIsActionSuccess(false);
          }
        })();
      }, 1500);
    } catch (error) {
      console.log("[LightboxViewer] Generate Mask error", error);
      clearMaskPollInterval();
      setActionMessage("Network error while queuing mask generation.");
      setIsActionSuccess(false);
      setIsGeneratingMask(false);
    }
  }, [absoluteLocalPath, clearMaskPollInterval, samTextPrompt, targetCoords, taskId]);

  const resetAdjustmentSliders = useCallback(() => {
    setBrightness(1);
    setSaturation(1);
    setHue(0);
    setContrast(1);
    setBlur(0);
    setShadows(0);
    setHighlights(0);
  }, []);

  const previewFilter = `brightness(${brightness}) saturate(${saturation}) hue-rotate(${hue}deg) contrast(${contrast}) blur(${blur}px)`;
  const maskPreviewUrl = generatedMaskPath
    ? `/api/local-image?path=${encodeURIComponent(generatedMaskPath)}`
    : null;

  const handleApplyAdjustments = useCallback(async () => {
    const imagePath = currentSourcePath.trim() || absoluteLocalPath.trim();
    if (!imagePath) {
      console.log("[LightboxViewer] Apply Adjustments: missing absoluteLocalPath");
      setActionMessage("Local file path unavailable for image adjustments.");
      setIsActionSuccess(false);
      return;
    }

    setIsApplyingEdit(true);
    setActionMessage(null);
    setIsActionSuccess(false);
    try {
      const adjustmentPayload = {
        absoluteLocalPath: imagePath,
        taskId,
        storagePath: storagePath.trim() || undefined,
        maskPath: generatedMaskPath ?? undefined,
        brightness: Number(brightness),
        saturation: Number(saturation),
        hue: Number(hue),
        contrast: Number(contrast),
        blur: Number(blur),
        shadows: Number(shadows),
        highlights: Number(highlights),
      };

      const res = await fetch("/api/sharp-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(adjustmentPayload),
      });
      const data = (await res.json().catch(() => null)) as
        | { error?: unknown; success?: boolean; outputPath?: string }
        | null;
      if (!res.ok) {
        console.log("[LightboxViewer] Apply Adjustments failed", data?.error);
        setActionMessage("Failed to apply image adjustments.");
        setIsActionSuccess(false);
        return;
      }
      if (data?.outputPath) {
        setCurrentSourcePath(data.outputPath);
        setDisplayImageUrl(
          `/api/local-image?path=${encodeURIComponent(data.outputPath)}&v=${Date.now()}`
        );
      }
      resetAdjustmentSliders();
      setActionMessage(
        data?.outputPath ? `Adjustments saved to ${data.outputPath}.` : "Adjustments applied successfully."
      );
      setIsActionSuccess(true);
    } catch (error) {
      console.log("[LightboxViewer] Apply Adjustments error", error);
      setActionMessage("Network error while applying image adjustments.");
      setIsActionSuccess(false);
    } finally {
      setIsApplyingEdit(false);
    }
  }, [
    absoluteLocalPath,
    blur,
    brightness,
    contrast,
    currentSourcePath,
    generatedMaskPath,
    highlights,
    hue,
    resetAdjustmentSliders,
    saturation,
    shadows,
    storagePath,
    taskId,
  ]);

  const toggleSmartSelect = () => {
    setIsSmartSelectMode((prev) => {
      if (prev) {
        setTargetCoords([]);
        setMarkerPositions([]);
      }
      return !prev;
    });
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/95 backdrop-blur-sm"
      onClick={(event) => handleClose(event)}
      role="dialog"
      aria-modal="true"
      aria-label="Merged photo lightbox"
    >
      <button
        type="button"
        onClick={(event) => handleClose(event)}
        className="absolute right-4 top-4 z-[110] inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900/90 text-lg text-zinc-200 transition hover:bg-zinc-800"
        aria-label="Close lightbox"
      >
        ✕
      </button>

      <div className="flex flex-1 flex-col items-center justify-center px-4 pb-56 pt-16" onClick={(event) => event.stopPropagation()}>
        {displayImageUrl ? (
          <div className="relative inline-block max-h-[80vh] max-w-[90vw]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={displayImageUrl}
              alt="Merged photo preview"
              onClick={handleImageClick}
              className={`relative block max-h-[80vh] max-w-[90vw] object-contain ${
                isSmartSelectMode ? "cursor-crosshair" : "cursor-default"
              }`}
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={displayImageUrl}
              alt=""
              aria-hidden
              className="pointer-events-none absolute inset-0 h-full w-full object-contain"
              style={{
                filter: previewFilter,
                WebkitMaskImage: maskPreviewUrl ? `url('${maskPreviewUrl}')` : undefined,
                maskImage: maskPreviewUrl ? `url('${maskPreviewUrl}')` : undefined,
                WebkitMaskSize: "cover",
                maskSize: "cover",
              }}
            />
            {markerPositions.map((markerPosition, index) => (
              <span
                key={`${markerPosition.x}-${markerPosition.y}-${index}`}
                className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2"
                style={{ left: markerPosition.x, top: markerPosition.y }}
              >
                <span className="absolute inline-flex h-4 w-4 animate-ping rounded-full bg-blue-500 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-blue-500 ring-2 ring-white/80" />
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-zinc-400">No image available for this task.</p>
        )}

        {actionMessage ? (
          <p
            className={`mt-4 max-w-lg text-center text-sm ${
              isActionSuccess ? "text-emerald-300" : "text-zinc-300"
            }`}
          >
            {actionMessage}
          </p>
        ) : null}
      </div>

      <div
        className="absolute bottom-28 left-1/2 z-[110] flex w-[min(92vw,40rem)] -translate-x-1/2 flex-col gap-3 rounded-2xl bg-zinc-900/90 p-4 shadow-2xl backdrop-blur-md"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="flex flex-col gap-1.5 text-xs font-medium text-zinc-300">
            <span className="flex items-center justify-between">
              Brightness
              <span className="tabular-nums text-zinc-400">{brightness.toFixed(1)}</span>
            </span>
            <input
              type="range"
              min={0.5}
              max={4}
              step={0.1}
              value={brightness}
              onChange={(event) => setBrightness(Number(event.target.value))}
              disabled={isApplyingEdit || isActionLoading}
              className="w-full accent-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-zinc-300">
            <span className="flex items-center justify-between">
              Saturation
              <span className="tabular-nums text-zinc-400">{saturation.toFixed(1)}</span>
            </span>
            <input
              type="range"
              min={0}
              max={3}
              step={0.1}
              value={saturation}
              onChange={(event) => setSaturation(Number(event.target.value))}
              disabled={isApplyingEdit || isActionLoading}
              className="w-full accent-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-zinc-300">
            <span className="flex items-center justify-between">
              Hue
              <span className="tabular-nums text-zinc-400">{hue.toFixed(0)}°</span>
            </span>
            <input
              type="range"
              min={0}
              max={360}
              step={1}
              value={hue}
              onChange={(event) => setHue(Number(event.target.value))}
              disabled={isApplyingEdit || isActionLoading}
              className="w-full accent-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-zinc-300">
            <span className="flex items-center justify-between">
              Contrast
              <span className="tabular-nums text-zinc-400">{contrast.toFixed(1)}</span>
            </span>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.1}
              value={contrast}
              onChange={(event) => setContrast(Number(event.target.value))}
              disabled={isApplyingEdit || isActionLoading}
              className="w-full accent-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-zinc-300 sm:col-span-2 lg:col-span-1">
            <span className="flex items-center justify-between">
              Blur
              <span className="tabular-nums text-zinc-400">{blur.toFixed(0)}px</span>
            </span>
            <input
              type="range"
              min={0}
              max={20}
              step={1}
              value={blur}
              onChange={(event) => setBlur(Number(event.target.value))}
              disabled={isApplyingEdit || isActionLoading}
              className="w-full accent-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-zinc-300">
            <span className="flex items-center justify-between">
              Shadows
              <span className="tabular-nums text-zinc-400">{shadows.toFixed(1)}</span>
            </span>
            <input
              type="range"
              min={0}
              max={10}
              step={0.5}
              value={shadows}
              onChange={(event) => setShadows(Number(event.target.value))}
              disabled={isApplyingEdit || isActionLoading}
              className="w-full accent-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-zinc-300">
            <span className="flex items-center justify-between">
              Highlights
              <span className="tabular-nums text-zinc-400">{highlights.toFixed(1)}</span>
            </span>
            <input
              type="range"
              min={0}
              max={10}
              step={0.5}
              value={highlights}
              onChange={(event) => setHighlights(Number(event.target.value))}
              disabled={isApplyingEdit || isActionLoading}
              className="w-full accent-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </label>
        </div>
        {generatedMaskPath ? (
          <p className="truncate text-[11px] text-zinc-500" title={generatedMaskPath}>
            Mask: {generatedMaskPath}
          </p>
        ) : null}
        <button
          type="button"
          disabled={isApplyingEdit || isActionLoading}
          onClick={() => void handleApplyAdjustments()}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-violet-600 bg-violet-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isApplyingEdit ? (
            <>
              <span
                className="inline-block size-3.5 animate-spin rounded-full border-2 border-white border-t-transparent"
                aria-hidden
              />
              Applying…
            </>
          ) : (
            "Apply Adjustments"
          )}
        </button>
      </div>

      <div
        className="absolute bottom-6 left-1/2 z-[110] flex -translate-x-1/2 flex-wrap items-center justify-center gap-3 rounded-2xl bg-zinc-900/90 p-4 shadow-2xl backdrop-blur-md"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          disabled={isActionLoading}
          onClick={() => void handleReplaceSky()}
          className="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-100 transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Replace Sky
        </button>
        <button
          type="button"
          disabled={isActionLoading}
          onClick={() => void handleRemoveObject()}
          className="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-100 transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Remove Object
        </button>
        <button
          type="button"
          onClick={toggleSmartSelect}
          className={`rounded-lg border px-4 py-2 text-sm font-semibold transition ${
            isSmartSelectMode
              ? "border-blue-500 bg-blue-600 text-white"
              : "border-zinc-700 bg-zinc-800 text-zinc-100 hover:bg-zinc-700"
          }`}
        >
          Smart Select
        </button>
        <input
          type="text"
          value={samTextPrompt}
          onChange={(event) => setSamTextPrompt(event.target.value)}
          placeholder="e.g., windows, sky"
          disabled={isGeneratingMask || isActionLoading}
          className="w-40 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 sm:w-48"
          aria-label="SAM3 text prompt"
        />
        {targetCoords.length > 0 || samTextPrompt.trim() ? (
          <button
            type="button"
            disabled={isGeneratingMask || isActionLoading}
            onClick={() => void handleGenerateMask()}
            className="inline-flex items-center gap-2 rounded-lg border border-emerald-600 bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isGeneratingMask ? (
              <>
                <span
                  className="inline-block size-3.5 animate-spin rounded-full border-2 border-white border-t-transparent"
                  aria-hidden
                />
                Generating…
              </>
            ) : (
              "Generate Mask"
            )}
          </button>
        ) : null}
      </div>
    </div>
  );
}
