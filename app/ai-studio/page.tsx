"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import MaskingCanvas, { type MaskingCanvasHandle } from "@/components/MaskingCanvas";

type ToolKey =
  | "material-replacement"
  | "object-swap"
  | "relight"
  | "image-to-video"
  | "text-to-photo"
  | "text-to-video";

const EDIT_TOOLS: Array<{ key: ToolKey; label: string }> = [
  { key: "material-replacement", label: "Material Replacement" },
  { key: "object-swap", label: "Object Swap" },
  { key: "relight", label: "Relight" },
];

const GENERATION_TOOLS: Array<{ key: ToolKey; label: string }> = [
  { key: "image-to-video", label: "Image to Video" },
  { key: "text-to-photo", label: "Text to Photo" },
  { key: "text-to-video", label: "Text to Video" },
];

const AI_TOOLS: Array<{ key: ToolKey; label: string }> = [...EDIT_TOOLS, ...GENERATION_TOOLS];
const EMPTY_PROMPTS: Record<ToolKey, string> = {
  "material-replacement": "",
  "object-swap": "",
  relight: "",
  "image-to-video": "",
  "text-to-photo": "",
  "text-to-video": "",
};

const TOOL_PRESETS: Record<ToolKey, string[]> = {
  "material-replacement": [
    "Replace sofa material with earthtone high end microfiber material",
    "Replace rugs with modern earthtone cashmere rugs",
    "Replace wood cabinets with high end matt wood veneer and matt laminate in gray and earth tones",
    "Replace dark backsplash with matte white tile",
  ],
  "object-swap": [
    "Remove clutter from kitchen counters",
    "Replace old sofa with a modern neutral sectional",
    "Remove pictures and art from the walls",
    "Remove visible cables and small floor clutter",
  ],
  relight: [
    "Enhance natural window light for a bright interior",
    "Soften harsh shadows in the living room corners",
    "Warm up interior lighting for a welcoming evening mood",
    "Balance mixed indoor and daylight color temperature",
  ],
  "image-to-video": [
    "Create a slow cinematic push-in camera move through the living room",
    "Generate a smooth left-to-right parallax reveal of the space",
    "Create a vertical social-media walkthrough animation",
  ],
  "text-to-photo": [
    "Modern Scandinavian living room with natural light and warm earth tones",
    "Luxury minimalist kitchen with matte wood and stone finishes",
    "Bright real estate bedroom scene, editorial style, ultra realistic",
  ],
  "text-to-video": [
    "Create a 6-second cinematic real estate walkthrough of a modern apartment",
    "Generate a smooth daytime-to-golden-hour living room transition shot",
    "Create an aerial-inspired reveal sequence of a luxury home interior",
  ],
};

export default function AiStudioPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const photoUrl = searchParams.get("photoUrl") ?? "";
  const taskId =
    searchParams.get("taskId") ??
    searchParams.get("taskID") ??
    searchParams.get("task_id") ??
    searchParams.get("id") ??
    searchParams.get("localFolderName") ??
    searchParams.get("local_folder_name") ??
    "";
  const taskIdForRequest = taskId.trim();
  const filename = searchParams.get("filename") ?? "";
  const isStandaloneMode = !photoUrl.trim();

  const [uploadedPhotoUrl, setUploadedPhotoUrl] = useState("");
  const [uploadedFilename, setUploadedFilename] = useState("");
  const [savedPhotoUrl, setSavedPhotoUrl] = useState<string | null>(null);
  const [currentFilename, setCurrentFilename] = useState(filename);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [referenceImages, setReferenceImages] = useState<File[]>([]);
  const [showOriginalImage, setShowOriginalImage] = useState(false);
  const [activeTool, setActiveTool] = useState<ToolKey>(isStandaloneMode ? "text-to-photo" : "material-replacement");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [generationMessage, setGenerationMessage] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [objectSwapHasSelection, setObjectSwapHasSelection] = useState(false);
  const [maskCanvasViewport, setMaskCanvasViewport] = useState({ width: 0, height: 0 });
  const [sourceImageNaturalSize, setSourceImageNaturalSize] = useState({ width: 0, height: 0 });
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewerContainerRef = useRef<HTMLDivElement | null>(null);
  const maskingCanvasRef = useRef<MaskingCanvasHandle | null>(null);
  const [promptByTool, setPromptByTool] = useState<Record<ToolKey, string>>({
    ...EMPTY_PROMPTS,
  });

  useEffect(() => {
    return () => {
      if (uploadedPhotoUrl) {
        URL.revokeObjectURL(uploadedPhotoUrl);
      }
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      if (pollingTimeoutRef.current) {
        clearTimeout(pollingTimeoutRef.current);
        pollingTimeoutRef.current = null;
      }
    };
  }, [uploadedPhotoUrl]);

  const effectivePhotoUrl = savedPhotoUrl || uploadedPhotoUrl || photoUrl;
  const effectiveFilename = currentFilename || uploadedFilename || filename;
  const displayedImageUrl = previewImageUrl && !showOriginalImage ? previewImageUrl : effectivePhotoUrl;
  const showingPreview = Boolean(previewImageUrl && !showOriginalImage);
  const activeToolLabel = useMemo(
    () => AI_TOOLS.find((tool) => tool.key === activeTool)?.label ?? "AI Tool",
    [activeTool]
  );
  const activePresets = TOOL_PRESETS[activeTool] ?? [];
  const isObjectSwapTool = activeTool === "object-swap";
  const shouldShowMaskingCanvas = isObjectSwapTool && Boolean(effectivePhotoUrl) && !showingPreview && !isGenerating;
  const canGenerateObjectSwap = !isObjectSwapTool || objectSwapHasSelection;
  const promptPlaceholder =
    activeTool === "text-to-photo" || activeTool === "text-to-video"
      ? "Describe what you want to generate..."
      : "Describe the edit you want to apply...";
  const referenceImagePreviews = useMemo(
    () =>
      referenceImages.map((file) => ({
        file,
        key: `${file.name}-${file.size}-${file.lastModified}`,
        previewUrl: URL.createObjectURL(file),
      })),
    [referenceImages]
  );

  useEffect(() => {
    return () => {
      referenceImagePreviews.forEach((item) => {
        URL.revokeObjectURL(item.previewUrl);
      });
    };
  }, [referenceImagePreviews]);

  useEffect(() => {
    const viewerElement = viewerContainerRef.current;
    if (!viewerElement) {
      return;
    }

    const updateViewport = () => {
      const rect = viewerElement.getBoundingClientRect();
      setMaskCanvasViewport({
        width: Math.max(0, Math.floor(rect.width - 24)),
        height: Math.max(0, Math.floor(rect.height - 24)),
      });
    };

    updateViewport();
    const observer = new ResizeObserver(() => {
      updateViewport();
    });
    observer.observe(viewerElement);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!effectivePhotoUrl) {
      return;
    }
    const image = new window.Image();
    image.src = effectivePhotoUrl;
    image.onload = () => {
      setSourceImageNaturalSize({
        width: image.naturalWidth || 0,
        height: image.naturalHeight || 0,
      });
    };
    image.onerror = () => {
      setSourceImageNaturalSize({ width: 0, height: 0 });
    };
  }, [effectivePhotoUrl]);

  const maskingCanvasSize = useMemo(() => {
    const maxWidth = Math.max(maskCanvasViewport.width, 0);
    const maxHeight = Math.max(maskCanvasViewport.height, 0);
    const imageWidth = sourceImageNaturalSize.width;
    const imageHeight = sourceImageNaturalSize.height;

    if (!maxWidth || !maxHeight) {
      return { width: 0, height: 0 };
    }
    if (!imageWidth || !imageHeight) {
      return { width: maxWidth, height: maxHeight };
    }
    const scale = Math.min(maxWidth / imageWidth, maxHeight / imageHeight);
    return {
      width: Math.max(1, Math.floor(imageWidth * scale)),
      height: Math.max(1, Math.floor(imageHeight * scale)),
    };
  }, [maskCanvasViewport.height, maskCanvasViewport.width, sourceImageNaturalSize.height, sourceImageNaturalSize.width]);

  const handleSetActiveTool = (tool: ToolKey) => {
    if (tool !== "object-swap") {
      setObjectSwapHasSelection(false);
    }
    setActiveTool(tool);
  };

  const handleUploadImage = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    if (uploadedPhotoUrl) {
      URL.revokeObjectURL(uploadedPhotoUrl);
    }
    const nextObjectUrl = URL.createObjectURL(file);
    setUploadedPhotoUrl(nextObjectUrl);
    setUploadedFilename(file.name);
    setCurrentFilename(file.name);
    setSavedPhotoUrl(null);
    setPreviewImageUrl(null);
    setShowOriginalImage(false);
    setGenerationMessage(null);
    setGenerationError(null);
  };

  const handleReferenceImagesSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) {
      return;
    }
    setReferenceImages((prev) => [...prev, ...files]);
    event.target.value = "";
  };

  const handleRemoveReferenceImage = (indexToRemove: number) => {
    setReferenceImages((prev) => prev.filter((_, index) => index !== indexToRemove));
  };

  const clearStatusPolling = () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    if (pollingTimeoutRef.current) {
      clearTimeout(pollingTimeoutRef.current);
      pollingTimeoutRef.current = null;
    }
  };

  const handleGeneratePreview = async () => {
    if (
      activeTool !== "material-replacement" &&
      activeTool !== "relight" &&
      activeTool !== "object-swap" &&
      activeTool !== "image-to-video" &&
      activeTool !== "text-to-photo" &&
      activeTool !== "text-to-video"
    ) {
      setGenerationError(
        "Preview generation is currently wired for Material Replacement, Relight, Object Swap, Image to Video, Text to Photo, and Text to Video."
      );
      setGenerationMessage(null);
      return;
    }
    const requiresSourceImage = activeTool !== "text-to-photo" && activeTool !== "text-to-video";
    const filenameForRequest = effectiveFilename.trim();
    if (requiresSourceImage && !filenameForRequest) {
      setGenerationError(`Please select or upload an image before generating a ${activeToolLabel} preview.`);
      setGenerationMessage(null);
      return;
    }
    if (isObjectSwapTool && !maskingCanvasRef.current?.hasSelection()) {
      setGenerationError("Object Swap requires a closed polygon mask. Draw a selection before generating.");
      setGenerationMessage(null);
      return;
    }

    setIsGenerating(true);
    setGenerationError(null);
    setGenerationMessage(null);
    setPreviewImageUrl(null);
    setShowOriginalImage(false);
    clearStatusPolling();
    try {
      const formPayload = new FormData();
      if (requiresSourceImage) {
        formPayload.append("filename", filenameForRequest);
      }
      if (isObjectSwapTool) {
        const maskBlob = await maskingCanvasRef.current?.exportMaskBlob();
        if (!maskBlob) {
          setGenerationError("Object Swap requires a valid mask export.");
          setIsGenerating(false);
          return;
        }
        formPayload.append("maskFile", maskBlob, `mask_${Date.now()}.png`);
      }
      formPayload.append("prompt", promptByTool[activeTool].trim());
      if (taskIdForRequest) {
        formPayload.append("taskId", taskIdForRequest);
        formPayload.append("task_id", taskIdForRequest);
      }
      referenceImages.forEach((file) => {
        formPayload.append("referenceImages", file, file.name);
      });

      const endpointTool = activeTool.toLowerCase().replace(/ /g, "-");
      const response = await fetch(`/api/comfy/${endpointTool}`, {
        method: "POST",
        body: formPayload,
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            success?: boolean;
            prompt_id?: string;
            error?: string;
          }
        | null;
      if (!response.ok || !payload?.success) {
        setGenerationError(payload?.error || `Failed to trigger ${activeToolLabel} preview (${response.status}).`);
        setIsGenerating(false);
        return;
      }
      const promptId = payload.prompt_id?.trim() ?? "";
      if (!promptId) {
        setGenerationMessage(`${activeToolLabel} preview queued successfully.`);
        setIsGenerating(false);
        return;
      }
      setGenerationMessage(`${activeToolLabel} preview queued (prompt ${promptId}).`);

      let pollingBusy = false;
      const pollStatus = async () => {
        if (pollingBusy) {
          return;
        }
        pollingBusy = true;
        try {
          const statusResponse = await fetch(`/api/comfy/status?prompt_id=${encodeURIComponent(promptId)}`, {
            cache: "no-store",
          });
          const statusPayload = (await statusResponse.json().catch(() => null)) as
            | {
                status?: "processing" | "completed";
                previewUrl?: string;
                error?: string;
              }
            | null;

          if (!statusResponse.ok) {
            clearStatusPolling();
            setIsGenerating(false);
            setGenerationError(statusPayload?.error || `Polling failed (${statusResponse.status}).`);
            return;
          }

          if (statusPayload?.status === "completed" && statusPayload.previewUrl) {
            clearStatusPolling();
            setIsGenerating(false);
            setPreviewImageUrl(
              `${statusPayload.previewUrl}${statusPayload.previewUrl.includes("?") ? "&" : "?"}t=${Date.now()}`
            );
            setShowOriginalImage(false);
            setGenerationMessage("Preview generated successfully.");
          }
        } catch {
          clearStatusPolling();
          setIsGenerating(false);
          setGenerationError("Network error while polling ComfyUI status.");
        } finally {
          pollingBusy = false;
        }
      };

      pollingIntervalRef.current = setInterval(() => {
        void pollStatus();
      }, 2500);
      pollingTimeoutRef.current = setTimeout(() => {
        clearStatusPolling();
        setIsGenerating(false);
        setGenerationError("Preview generation timed out after 3 minutes.");
      }, 180000);

      void pollStatus();
    } catch {
      setGenerationError(`Network error while triggering ${activeToolLabel} preview.`);
      setIsGenerating(false);
    }
  };

  const handleStartNewEdit = () => {
    clearStatusPolling();
    if (uploadedPhotoUrl) {
      URL.revokeObjectURL(uploadedPhotoUrl);
    }
    setUploadedPhotoUrl("");
    setUploadedFilename("");
    setSavedPhotoUrl(null);
    setCurrentFilename("");
    setPreviewImageUrl(null);
    setShowOriginalImage(false);
    setIsSaving(false);
    setIsGenerating(false);
    setGenerationMessage(null);
    setGenerationError(null);
    setReferenceImages([]);
    setPromptByTool({ ...EMPTY_PROMPTS });
    setActiveTool("text-to-photo");
    router.push("/ai-studio");
  };

  const handleConfirmSaveFinalEdit = async () => {
    if (!previewImageUrl) {
      return;
    }
    setIsSaving(true);
    setGenerationError(null);
    setGenerationMessage(null);
    try {
      const response = await fetch("/api/comfy/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalFilename: currentFilename || null,
          previewUrl: previewImageUrl,
          taskId: taskIdForRequest,
          task_id: taskIdForRequest,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            success?: boolean;
            newFilename?: string;
            newPhotoUrl?: string;
            error?: string;
          }
        | null;
      if (!response.ok || !payload?.success || !payload.newFilename || !payload.newPhotoUrl) {
        setGenerationError(payload?.error || `Failed to save final edit (${response.status}).`);
        return;
      }

      const nextPhotoUrl = `${payload.newPhotoUrl}${payload.newPhotoUrl.includes("?") ? "&" : "?"}t=${Date.now()}`;
      setSavedPhotoUrl(nextPhotoUrl);
      setCurrentFilename(payload.newFilename);
      setPreviewImageUrl(null);
      setShowOriginalImage(false);
      setGenerationMessage(`Edit saved successfully as ${payload.newFilename}`);
    } catch {
      setGenerationError("Network error while saving final edit.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col bg-zinc-100 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mx-auto w-full max-w-[1800px] flex-1 px-4 py-5 sm:px-6 lg:px-8">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white/90 px-4 py-3 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/80">
          <div className="flex min-w-0 items-center gap-3">
            <Image
              src="/logo.webp"
              alt="Workflow"
              width={168}
              height={46}
              className="h-10 w-auto shrink-0 object-contain"
              priority
            />
            <h1 className="truncate text-xl font-semibold tracking-tight">AI Studio</h1>
          </div>
          <div className="min-w-0">
            <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
              {effectiveFilename ? `Editing ${effectiveFilename}` : "Advanced photo edit workspace"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
          >
            Back to Kanban
          </button>
        </header>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(280px,1fr)]">
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              <span className="truncate">Task: {taskId || "N/A"}</span>
              <span className="truncate">Tool: {activeToolLabel}</span>
            </div>
            <div
              ref={viewerContainerRef}
              className="flex min-h-[68vh] items-center justify-center rounded-xl border border-zinc-200 bg-zinc-100 p-3 dark:border-zinc-800 dark:bg-zinc-950"
            >
              {shouldShowMaskingCanvas ? (
                <MaskingCanvas
                  ref={maskingCanvasRef}
                  imageUrl={effectivePhotoUrl}
                  width={maskingCanvasSize.width}
                  height={maskingCanvasSize.height}
                  onSelectionChange={setObjectSwapHasSelection}
                />
              ) : displayedImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={displayedImageUrl}
                  alt={effectiveFilename || "Selected photo"}
                  className="max-h-[66vh] w-auto max-w-full rounded-lg object-contain shadow-lg shadow-black/20"
                />
              ) : (
                <div className="w-full max-w-xl rounded-lg border border-dashed border-zinc-300 px-6 py-10 text-center dark:border-zinc-700">
                  <p className="text-sm font-medium">Upload Image</p>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    Standalone mode is active. Upload a photo or use Text to Photo/Text to Video.
                  </p>
                  <label className="mt-4 inline-flex cursor-pointer items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800">
                    Choose Image
                    <input type="file" accept="image/*" onChange={handleUploadImage} className="hidden" />
                  </label>
                </div>
              )}
            </div>
            <div className="mx-auto mt-4 w-full max-w-3xl rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-center dark:border-zinc-800 dark:bg-zinc-950/60">
              <div className="mb-2 flex flex-wrap items-center justify-center gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Reference Images
                </p>
                <label className="inline-flex cursor-pointer items-center justify-center rounded-md border border-zinc-300 bg-white px-2 py-1 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800">
                  Add Images
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleReferenceImagesSelected}
                    className="hidden"
                  />
                </label>
              </div>
              {referenceImagePreviews.length > 0 ? (
                <div className="grid grid-cols-4 justify-items-center gap-2 sm:grid-cols-6 md:grid-cols-8">
                  {referenceImagePreviews.map((item, index) => (
                    <div
                      key={`${item.key}-${index}`}
                      className="relative h-14 w-14 overflow-hidden rounded-md border border-zinc-300 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={item.previewUrl} alt={item.file.name} className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => handleRemoveReferenceImage(index)}
                        className="absolute right-0 top-0 inline-flex h-4 w-4 items-center justify-center rounded-bl bg-black/70 text-[10px] font-bold text-white"
                        aria-label={`Remove reference image ${item.file.name}`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Upload one or more reference images to guide the generation.
                </p>
              )}
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleStartNewEdit}
                className="inline-flex h-8 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                New Edit
              </button>
              {previewImageUrl && effectivePhotoUrl ? (
                <button
                  type="button"
                  onClick={() => setShowOriginalImage((prev) => !prev)}
                  className="inline-flex h-8 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  {showingPreview ? "View Original" : "View Preview"}
                </button>
              ) : null}
            </div>
          </div>

          <aside className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
              Tools
            </h2>
            <div className="grid grid-cols-3 gap-2 justify-items-start">
              {EDIT_TOOLS.map((tool) => {
                const isActive = tool.key === activeTool;
                return (
                  <button
                    key={tool.key}
                    type="button"
                    onClick={() => handleSetActiveTool(tool.key)}
                    className={`h-24 w-24 rounded-lg border p-1 text-[10px] transition flex flex-col items-center justify-center text-center leading-tight ${
                      isActive
                        ? "border-zinc-900 bg-zinc-900 text-white shadow-md dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                        : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    }`}
                  >
                    {tool.label}
                  </button>
                );
              })}
            </div>
            <div className="my-3 border-t border-zinc-200 dark:border-zinc-800" />
            <div className="grid grid-cols-3 gap-2 justify-items-start">
              {GENERATION_TOOLS.map((tool) => {
                const isActive = tool.key === activeTool;
                return (
                  <button
                    key={tool.key}
                    type="button"
                    onClick={() => handleSetActiveTool(tool.key)}
                    className={`h-24 w-24 rounded-lg border p-1 text-[10px] transition flex flex-col items-center justify-center text-center leading-tight ${
                      isActive
                        ? "border-zinc-900 bg-zinc-900 text-white shadow-md dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                        : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    }`}
                  >
                    {tool.label}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950/60">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                {activeToolLabel}
              </p>
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                Prompt
                <textarea
                  value={promptByTool[activeTool]}
                  onChange={(event) =>
                    setPromptByTool((prev) => ({
                      ...prev,
                      [activeTool]: event.target.value,
                    }))
                  }
                  placeholder={promptPlaceholder}
                  className="mt-1 h-32 w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-500"
                />
              </label>
              {activePresets.length > 0 ? (
                <div className="mt-2">
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Tool Presets
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {activePresets.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() =>
                          setPromptByTool((prev) => ({
                            ...prev,
                            [activeTool]: preset,
                          }))
                        }
                        className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-[11px] font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={isGenerating || !canGenerateObjectSwap}
                  onClick={() => void handleGeneratePreview()}
                  className="inline-flex h-10 items-center justify-center rounded-lg bg-zinc-900 px-4 text-sm font-semibold text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  {isGenerating ? "Generating..." : "Generate Preview"}
                </button>
                <button
                  type="button"
                  disabled={!previewImageUrl}
                  onClick={() => void handleConfirmSaveFinalEdit()}
                  className="inline-flex h-10 items-center justify-center rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-500 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
                >
                  {isSaving ? "Saving..." : "Confirm & Save Final Edit"}
                </button>
              </div>
              <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                (Generates a preview below. &quot;Confirm &amp; Save&quot; creates the final _wf file)
              </p>
              {generationMessage ? (
                <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">{generationMessage}</p>
              ) : null}
              {generationError ? (
                <p className="mt-2 text-xs text-red-600 dark:text-red-400">{generationError}</p>
              ) : null}
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
