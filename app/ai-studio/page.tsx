"use client";

import { Power } from "lucide-react";
import Image from "next/image";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import MaskingCanvas, { type MaskingCanvasHandle } from "@/components/MaskingCanvas";
import RadianceHDRPanel, {
  DEFAULT_RADIANCE_HDR_SETTINGS,
  type RadianceHdrSettings,
} from "@/app/components/RadianceHDRPanel";
import { getAllMoodboards, sendImageToMoodboard } from "@/app/actions/moodboard";

type ToolKey =
  | "material-replacement"
  | "object-swap"
  | "object-removal"
  | "relight"
  | "radiance-hdr"
  | "image-to-video"
  | "text-to-photo"
  | "text-to-video";

const EDIT_TOOLS: Array<{ key: ToolKey; label: string }> = [
  { key: "material-replacement", label: "Material Replacement" },
  { key: "object-swap", label: "Object Swap" },
  { key: "object-removal", label: "Object Removal" },
  { key: "relight", label: "Relight" },
  { key: "radiance-hdr", label: "Radiance HDR" },
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
  "object-removal": "",
  relight: "",
  "radiance-hdr": "",
  "image-to-video": "",
  "text-to-photo": "",
  "text-to-video": "",
};

const AI_STUDIO_LAST_IMAGE_KEY = "aiStudioLastImage";
const COMFYUI_PATH_STORAGE_KEY = "comfyui_path";
const DEFAULT_COMFYUI_PATH =
  "F:\\ComfyUI_windows_portable_nvidia\\ComfyUI_windows_portable\\run_nvidia_gpu.bat";

const DEFAULT_TEXT2IMAGE_WIDTH = 1024;
const DEFAULT_TEXT2IMAGE_HEIGHT = 1024;
const DEFAULT_VIDEO_WIDTH = 832;
const DEFAULT_VIDEO_HEIGHT = 480;
const DEFAULT_IMAGE2VIDEO_WIDTH = 512;
const DEFAULT_IMAGE2VIDEO_HEIGHT = 512;
const DEFAULT_VIDEO_LENGTH = 33;
const DEFAULT_BATCH_SIZE = 1;

const DRAW_MASK_BRUSH_COLOR = "rgba(255, 0, 0, 0.5)";
const DRAW_MASK_BRUSH_SIZE = 40;

function extractSourceImagePathFromUrl(photoUrl: string): string {
  const trimmed = photoUrl.trim();
  if (!trimmed) {
    return "";
  }
  try {
    const url = new URL(trimmed, typeof window !== "undefined" ? window.location.origin : "http://localhost");
    const pathParam = url.searchParams.get("path") ?? url.searchParams.get("imagePath");
    if (pathParam) {
      return decodeURIComponent(pathParam);
    }
  } catch {
    // Ignore malformed URLs and fall back to server-side filename lookup.
  }
  return "";
}

function exportDrawMaskBase64(
  drawCanvas: HTMLCanvasElement,
  naturalWidth: number,
  naturalHeight: number
): string {
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = naturalWidth > 0 ? naturalWidth : drawCanvas.width;
  exportCanvas.height = naturalHeight > 0 ? naturalHeight : drawCanvas.height;

  const exportCtx = exportCanvas.getContext("2d");
  const sourceCtx = drawCanvas.getContext("2d");
  if (!exportCtx || !sourceCtx) {
    return "";
  }

  exportCtx.fillStyle = "#000000";
  exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

  const sourceData = sourceCtx.getImageData(0, 0, drawCanvas.width, drawCanvas.height);
  const exportData = exportCtx.createImageData(exportCanvas.width, exportCanvas.height);
  const scaleX = exportCanvas.width / drawCanvas.width;
  const scaleY = exportCanvas.height / drawCanvas.height;

  for (let y = 0; y < exportCanvas.height; y += 1) {
    for (let x = 0; x < exportCanvas.width; x += 1) {
      const sourceX = Math.min(drawCanvas.width - 1, Math.floor(x / scaleX));
      const sourceY = Math.min(drawCanvas.height - 1, Math.floor(y / scaleY));
      const sourceIndex = (sourceY * drawCanvas.width + sourceX) * 4;
      const exportIndex = (y * exportCanvas.width + x) * 4;
      const painted = sourceData.data[sourceIndex + 3]! > 16;
      const value = painted ? 255 : 0;
      exportData.data[exportIndex] = value;
      exportData.data[exportIndex + 1] = value;
      exportData.data[exportIndex + 2] = value;
      exportData.data[exportIndex + 3] = 255;
    }
  }

  exportCtx.putImageData(exportData, 0, 0);
  return exportCanvas.toDataURL("image/png");
}

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
  "object-removal": [
    "Remove the object painted in the mask",
    "Remove unwanted furniture from the scene",
    "Remove reflections and distractions from glass surfaces",
    "Remove power lines and small visual clutter",
  ],
  relight: [
    "Enhance natural window light for a bright interior",
    "Soften harsh shadows in the living room corners",
    "Warm up interior lighting for a welcoming evening mood",
    "Balance mixed indoor and daylight color temperature",
  ],
  "radiance-hdr": [],
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

function AiStudioPageContent() {
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
  const absoluteLocalPathFromQuery =
    searchParams.get("absoluteLocalPath") ?? searchParams.get("absolute_local_path") ?? "";
  const isStandaloneMode = !photoUrl.trim();

  const [uploadedPhotoUrl, setUploadedPhotoUrl] = useState("");
  const [uploadedFilename, setUploadedFilename] = useState("");
  const [savedPhotoUrl, setSavedPhotoUrl] = useState<string | null>(null);
  const [currentFilename, setCurrentFilename] = useState(filename);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [previewMediaType, setPreviewMediaType] = useState<"image" | "video">("image");
  const [genWidth, setGenWidth] = useState(DEFAULT_TEXT2IMAGE_WIDTH);
  const [genHeight, setGenHeight] = useState(DEFAULT_TEXT2IMAGE_HEIGHT);
  const [genLength, setGenLength] = useState(DEFAULT_VIDEO_LENGTH);
  const [genBatchSize, setGenBatchSize] = useState(DEFAULT_BATCH_SIZE);
  const [referenceImages, setReferenceImages] = useState<File[]>([]);
  const [showOriginalImage, setShowOriginalImage] = useState(false);
  const [activeTool, setActiveTool] = useState<ToolKey>(isStandaloneMode ? "text-to-photo" : "material-replacement");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRemovingObject, setIsRemovingObject] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [generationMessage, setGenerationMessage] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [objectSwapHasSelection, setObjectSwapHasSelection] = useState(false);
  const [hasDrawnMask, setHasDrawnMask] = useState(false);
  const [maskCanvasViewport, setMaskCanvasViewport] = useState({ width: 0, height: 0 });
  const [sourceImageNaturalSize, setSourceImageNaturalSize] = useState({ width: 0, height: 0 });
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewerContainerRef = useRef<HTMLDivElement | null>(null);
  const maskingCanvasRef = useRef<MaskingCanvasHandle | null>(null);
  const drawMaskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingMaskRef = useRef(false);
  const lastDrawPointRef = useRef<{ x: number; y: number } | null>(null);
  const [promptByTool, setPromptByTool] = useState<Record<ToolKey, string>>({
    ...EMPTY_PROMPTS,
  });
  const [moodboards, setMoodboards] = useState<{ id: string; title: string }[]>([]);
  const [selectedBoardId, setSelectedBoardId] = useState<string>("");
  const [isSendingToBoard, setIsSendingToBoard] = useState(false);
  const [sendToBoardSuccess, setSendToBoardSuccess] = useState(false);
  const [radianceHdrSettings, setRadianceHdrSettings] = useState<RadianceHdrSettings>(
    DEFAULT_RADIANCE_HDR_SETTINGS
  );
  const [comfyUiPath, setComfyUiPath] = useState(DEFAULT_COMFYUI_PATH);
  const [isLaunchingComfyUi, setIsLaunchingComfyUi] = useState(false);
  const [comfyUiToast, setComfyUiToast] = useState<string | null>(null);
  const [comfyUiError, setComfyUiError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const savedPath = localStorage.getItem(COMFYUI_PATH_STORAGE_KEY);
      if (savedPath) {
        setComfyUiPath(savedPath);
      }
    } catch {
      // localStorage may be unavailable in some contexts
    }
  }, []);

  useEffect(() => {
    try {
      if (comfyUiPath.trim()) {
        localStorage.setItem(COMFYUI_PATH_STORAGE_KEY, comfyUiPath.trim());
      } else {
        localStorage.removeItem(COMFYUI_PATH_STORAGE_KEY);
      }
    } catch {
      // localStorage may be unavailable in some contexts
    }
  }, [comfyUiPath]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(AI_STUDIO_LAST_IMAGE_KEY);
      if (saved) {
        setPreviewImageUrl(saved);
        setShowOriginalImage(false);
      }
    } catch {
      // localStorage may be unavailable in some contexts
    }
  }, []);

  useEffect(() => {
    void getAllMoodboards().then((res) => {
      if (!res.ok) {
        return;
      }
      const boards = res.moodboards.map((board) => ({ id: board.id, title: board.title }));
      setMoodboards(boards);
      if (boards.length > 0) {
        setSelectedBoardId(boards[0].id);
      }
    });
  }, []);

  useEffect(() => {
    if (!previewImageUrl) {
      return;
    }
    try {
      localStorage.setItem(AI_STUDIO_LAST_IMAGE_KEY, previewImageUrl);
    } catch {
      // localStorage may be unavailable in some contexts
    }
  }, [previewImageUrl]);

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
  const isTextToPhotoTool = activeTool === "text-to-photo";
  const isTextToVideoTool = activeTool === "text-to-video";
  const isImageToVideoTool = activeTool === "image-to-video";
  const isMediaGenerationTool = isTextToPhotoTool || isTextToVideoTool || isImageToVideoTool;
  const isObjectSwapTool = activeTool === "object-swap";
  const isObjectRemovalTool = activeTool === "object-removal";
  const isRadianceHdrTool = activeTool === "radiance-hdr";
  const shouldShowMaskingCanvas =
    isObjectSwapTool && Boolean(effectivePhotoUrl) && !showingPreview && !isGenerating && !isRemovingObject;
  const shouldShowDrawMaskCanvas =
    isObjectRemovalTool && Boolean(effectivePhotoUrl) && !showingPreview && !isGenerating && !isRemovingObject;
  const canGenerateObjectSwap = !isObjectSwapTool || objectSwapHasSelection;
  const promptPlaceholder =
    isTextToPhotoTool || isTextToVideoTool
      ? "Describe what you want to generate..."
      : "Describe the edit you want to apply...";
  const showPromptField = !isImageToVideoTool && !isRadianceHdrTool;
  const generationButtonLabel = isGenerating
    ? isTextToPhotoTool
      ? "Generating Photo..."
      : isTextToVideoTool || isImageToVideoTool
        ? "Generating Video..."
        : "Generating..."
    : isMediaGenerationTool
      ? "Generate"
      : isRadianceHdrTool
        ? "Process Image"
      : "Generate Preview";
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
    if (tool !== "object-removal") {
      setHasDrawnMask(false);
      isDrawingMaskRef.current = false;
      lastDrawPointRef.current = null;
    }
    setActiveTool(tool);
    if (tool === "text-to-photo") {
      setGenWidth(DEFAULT_TEXT2IMAGE_WIDTH);
      setGenHeight(DEFAULT_TEXT2IMAGE_HEIGHT);
    } else if (tool === "text-to-video") {
      setGenWidth(DEFAULT_VIDEO_WIDTH);
      setGenHeight(DEFAULT_VIDEO_HEIGHT);
      setGenLength(DEFAULT_VIDEO_LENGTH);
      setGenBatchSize(DEFAULT_BATCH_SIZE);
    } else if (tool === "image-to-video") {
      setGenWidth(DEFAULT_IMAGE2VIDEO_WIDTH);
      setGenHeight(DEFAULT_IMAGE2VIDEO_HEIGHT);
      setGenLength(DEFAULT_VIDEO_LENGTH);
      setGenBatchSize(DEFAULT_BATCH_SIZE);
    } else if (tool === "radiance-hdr") {
      setRadianceHdrSettings(DEFAULT_RADIANCE_HDR_SETTINGS);
    }
  };

  const getDrawMaskPoint = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = drawMaskCanvasRef.current;
    if (!canvas) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  }, []);

  const paintDrawMaskStroke = useCallback((from: { x: number; y: number }, to: { x: number; y: number }) => {
    const canvas = drawMaskCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) {
      return;
    }
    ctx.strokeStyle = DRAW_MASK_BRUSH_COLOR;
    ctx.lineWidth = DRAW_MASK_BRUSH_SIZE;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }, []);

  const handleDrawMaskMouseDown = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      const point = getDrawMaskPoint(event);
      if (!point) {
        return;
      }
      isDrawingMaskRef.current = true;
      lastDrawPointRef.current = point;
      paintDrawMaskStroke(point, point);
      setHasDrawnMask(true);
    },
    [getDrawMaskPoint, paintDrawMaskStroke]
  );

  const handleDrawMaskMouseMove = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isDrawingMaskRef.current) {
        return;
      }
      const point = getDrawMaskPoint(event);
      const lastPoint = lastDrawPointRef.current;
      if (!point || !lastPoint) {
        return;
      }
      paintDrawMaskStroke(lastPoint, point);
      lastDrawPointRef.current = point;
      setHasDrawnMask(true);
    },
    [getDrawMaskPoint, paintDrawMaskStroke]
  );

  const stopDrawMask = useCallback(() => {
    isDrawingMaskRef.current = false;
    lastDrawPointRef.current = null;
  }, []);

  const handleClearDrawMask = useCallback(() => {
    const canvas = drawMaskCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) {
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawnMask(false);
    isDrawingMaskRef.current = false;
    lastDrawPointRef.current = null;
  }, []);

  const handleRemoveObject = useCallback(async () => {
    const canvas = drawMaskCanvasRef.current;
    if (!canvas) {
      return;
    }
    const maskBase64 = exportDrawMaskBase64(
      canvas,
      sourceImageNaturalSize.width,
      sourceImageNaturalSize.height
    );
    if (!maskBase64) {
      setGenerationError("Mask export failed. Draw a mask over the object you want to remove.");
      setGenerationMessage(null);
      return;
    }

    const filenameForRequest = effectiveFilename.trim();
    const sourceImagePath =
      absoluteLocalPathFromQuery.trim() ||
      extractSourceImagePathFromUrl(effectivePhotoUrl) ||
      extractSourceImagePathFromUrl(photoUrl);
    if (!sourceImagePath && !filenameForRequest) {
      setGenerationError("Cannot resolve the source image. Open AI Studio from a merged photo or upload a named image.");
      setGenerationMessage(null);
      return;
    }

    setIsRemovingObject(true);
    setGenerationError(null);
    setGenerationMessage("Removing Object... Please wait");
    setShowOriginalImage(false);

    try {
      const response = await fetch("/api/ai-inpaint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceImagePath,
          maskBase64,
          filename: filenameForRequest,
          taskId: taskIdForRequest,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { imageUrl?: string; error?: string }
        | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? `Object removal failed (${response.status}).`);
      }

      const imageUrl = payload?.imageUrl?.trim() ?? "";
      if (!imageUrl) {
        throw new Error("Object removal completed but no image URL was returned.");
      }

      setPreviewImageUrl(imageUrl);
      setPreviewMediaType("image");
      setGenerationMessage("Object removed successfully.");
      handleClearDrawMask();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Object removal failed.";
      setGenerationError(message);
      setGenerationMessage(null);
    } finally {
      setIsRemovingObject(false);
    }
  }, [
    absoluteLocalPathFromQuery,
    effectiveFilename,
    effectivePhotoUrl,
    handleClearDrawMask,
    photoUrl,
    sourceImageNaturalSize.height,
    sourceImageNaturalSize.width,
    taskIdForRequest,
  ]);

  useEffect(() => {
    if (!shouldShowDrawMaskCanvas) {
      return;
    }
    handleClearDrawMask();
  }, [
    effectivePhotoUrl,
    handleClearDrawMask,
    maskingCanvasSize.height,
    maskingCanvasSize.width,
    shouldShowDrawMaskCanvas,
  ]);

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
    setPreviewMediaType("image");
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
      activeTool !== "radiance-hdr" &&
      activeTool !== "object-swap" &&
      !isMediaGenerationTool
    ) {
      setGenerationError(
        "Preview generation is currently wired for Material Replacement, Relight, Radiance HDR, Object Swap, and the Media Generation tools."
      );
      setGenerationMessage(null);
      return;
    }

    if (isMediaGenerationTool) {
      const promptText = promptByTool[activeTool].trim();
      if ((isTextToPhotoTool || isTextToVideoTool) && !promptText) {
        setGenerationError("Please enter a prompt before generating.");
        setGenerationMessage(null);
        return;
      }

      const filenameForRequest = effectiveFilename.trim();
      const sourceImagePath =
        absoluteLocalPathFromQuery.trim() ||
        extractSourceImagePathFromUrl(effectivePhotoUrl) ||
        extractSourceImagePathFromUrl(photoUrl);
      if (isImageToVideoTool && !sourceImagePath && !filenameForRequest) {
        setGenerationError("Please load or upload a source image before generating video.");
        setGenerationMessage(null);
        return;
      }
      if (isImageToVideoTool && !effectivePhotoUrl) {
        setGenerationError("Image to Video requires a loaded source image in the viewer.");
        setGenerationMessage(null);
        return;
      }

      setIsGenerating(true);
      setGenerationError(null);
      setGenerationMessage(
        isTextToPhotoTool
          ? "Generating photo... Please wait."
          : "Generating video... This may take several minutes."
      );
      setPreviewImageUrl(null);
      setPreviewMediaType("image");
      setShowOriginalImage(false);
      clearStatusPolling();

      try {
        const mode = isTextToPhotoTool
          ? "text2image"
          : isTextToVideoTool
            ? "text2video"
            : "image2video";
        const response = await fetch("/api/ai-generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode,
            prompt: promptText,
            width: genWidth,
            height: genHeight,
            length: genLength,
            batchSize: genBatchSize,
            sourceImagePath,
            filename: filenameForRequest,
            taskId: taskIdForRequest,
          }),
        });
        const payload = (await response.json().catch(() => null)) as
          | {
              success?: boolean;
              mediaUrl?: string;
              type?: "image" | "video";
              error?: string;
            }
          | null;

        if (!response.ok || !payload?.success || !payload.mediaUrl) {
          setGenerationError(payload?.error || `Generation failed (${response.status}).`);
          setGenerationMessage(null);
          return;
        }

        const mediaUrl = `${payload.mediaUrl}${payload.mediaUrl.includes("?") ? "&" : "?"}t=${Date.now()}`;
        setPreviewImageUrl(mediaUrl);
        setPreviewMediaType(payload.type === "video" ? "video" : "image");
        setGenerationMessage(
          payload.type === "video" ? "Video generated successfully." : "Photo generated successfully."
        );
      } catch {
        setGenerationError(`Network error while generating ${activeToolLabel}.`);
        setGenerationMessage(null);
      } finally {
        setIsGenerating(false);
      }
      return;
    }

    const requiresSourceImage = true;
    const filenameForRequest = effectiveFilename.trim();
    const sourceImagePathForRequest = absoluteLocalPathFromQuery.trim();
    if (requiresSourceImage && !filenameForRequest && !sourceImagePathForRequest) {
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
    setPreviewMediaType("image");
    setShowOriginalImage(false);
    clearStatusPolling();
    try {
      const formPayload = new FormData();
      formPayload.append("filename", filenameForRequest);
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
      if (isRadianceHdrTool) {
        formPayload.append("sourceImagePath", sourceImagePathForRequest);
        formPayload.append("shadow_amount", String(radianceHdrSettings.shadow_amount));
        formPayload.append("highlight_amount", String(radianceHdrSettings.highlight_amount));
        formPayload.append("shadow_tone", String(radianceHdrSettings.shadow_tone));
        formPayload.append("highlight_tone", String(radianceHdrSettings.highlight_tone));
        formPayload.append("color_correction", String(radianceHdrSettings.color_correction));
        formPayload.append("local_contrast", String(radianceHdrSettings.local_contrast));
        formPayload.append("creative_white_scale", String(radianceHdrSettings.creative_white_scale));
        formPayload.append("exposure_adjust", String(radianceHdrSettings.exposure_adjust));
        formPayload.append("gamut_compress", String(radianceHdrSettings.gamut_compress));
      }
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
            setPreviewMediaType("image");
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
    setPreviewMediaType("image");
    setShowOriginalImage(false);
    try {
      localStorage.removeItem(AI_STUDIO_LAST_IMAGE_KEY);
    } catch {
      // ignore
    }
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

  const handleClearSavedImage = () => {
    try {
      localStorage.removeItem(AI_STUDIO_LAST_IMAGE_KEY);
    } catch {
      // ignore
    }
    setPreviewImageUrl(null);
    setPreviewMediaType("image");
    setSendToBoardSuccess(false);
    setShowOriginalImage(false);
  };

  const handleLaunchComfyUi = async () => {
    const path = comfyUiPath.trim();
    if (!path) {
      setComfyUiError("Enter the path to your ComfyUI launch script first.");
      setComfyUiToast(null);
      return;
    }

    setIsLaunchingComfyUi(true);
    setComfyUiError(null);
    setComfyUiToast(null);

    try {
      const response = await fetch("/api/local/start-comfyui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comfyPath: path }),
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? `Launch failed (${response.status}).`);
      }
      setComfyUiToast("Booting AI Servers... Check your terminal window!");
    } catch (error) {
      setComfyUiError(error instanceof Error ? error.message : "Failed to launch ComfyUI.");
    } finally {
      setIsLaunchingComfyUi(false);
    }
  };

  const handleSendToMoodboard = async () => {
    if (!previewImageUrl || !selectedBoardId) {
      return;
    }
    setIsSendingToBoard(true);
    setSendToBoardSuccess(false);
    try {
      const res = await sendImageToMoodboard(selectedBoardId, previewImageUrl);
      if (!res.success) {
        setGenerationError(res.error || "Failed to send image to moodboard.");
        return;
      }
      setSendToBoardSuccess(true);
      window.setTimeout(() => setSendToBoardSuccess(false), 2000);
    } catch {
      setGenerationError("Network error while sending to moodboard.");
    } finally {
      setIsSendingToBoard(false);
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
            Back to Workflow
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
              ) : shouldShowDrawMaskCanvas ? (
                <div
                  className="relative"
                  style={{
                    width: maskingCanvasSize.width,
                    height: maskingCanvasSize.height,
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={effectivePhotoUrl}
                    alt={effectiveFilename || "Selected photo"}
                    className="h-full w-full rounded-lg object-contain shadow-lg shadow-black/20"
                    draggable={false}
                  />
                  <canvas
                    ref={drawMaskCanvasRef}
                    width={maskingCanvasSize.width}
                    height={maskingCanvasSize.height}
                    className="absolute inset-0 cursor-crosshair touch-none rounded-lg"
                    aria-label="Draw object removal mask"
                    onMouseDown={handleDrawMaskMouseDown}
                    onMouseMove={handleDrawMaskMouseMove}
                    onMouseUp={stopDrawMask}
                    onMouseLeave={stopDrawMask}
                  />
                </div>
              ) : displayedImageUrl ? (
                showingPreview && previewMediaType === "video" ? (
                  // eslint-disable-next-line jsx-a11y/media-has-caption
                  <video
                    src={displayedImageUrl}
                    autoPlay
                    loop
                    muted
                    playsInline
                    controls
                    className="max-h-[66vh] w-auto max-w-full rounded-lg object-contain shadow-lg shadow-black/20"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={displayedImageUrl}
                    alt={effectiveFilename || "Selected photo"}
                    className="max-h-[66vh] w-auto max-w-full rounded-lg object-contain shadow-lg shadow-black/20"
                  />
                )
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
            {previewImageUrl ? (
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
                <button
                  type="button"
                  onClick={handleClearSavedImage}
                  className="inline-flex h-10 shrink-0 items-center justify-center rounded-lg border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Clear Image
                </button>
                <select
                  value={selectedBoardId}
                  onChange={(event) => setSelectedBoardId(event.target.value)}
                  disabled={moodboards.length === 0 || isSendingToBoard}
                  className="min-w-[180px] flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                  aria-label="Select moodboard destination"
                >
                  {moodboards.length === 0 ? (
                    <option value="">No moodboards available</option>
                  ) : (
                    moodboards.map((board) => (
                      <option key={board.id} value={board.id}>
                        {board.title}
                      </option>
                    ))
                  )}
                </select>
                <button
                  type="button"
                  disabled={!selectedBoardId || isSendingToBoard}
                  onClick={() => void handleSendToMoodboard()}
                  className="inline-flex h-10 shrink-0 items-center justify-center rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-violet-500 dark:hover:bg-violet-400"
                >
                  {sendToBoardSuccess
                    ? "✅ Sent! (Refresh Moodboard to see)"
                    : isSendingToBoard
                      ? "Sending…"
                      : "🎯 Send to Moodboard"}
                </button>
              </div>
            ) : null}
            <div className="mx-auto mt-4 w-full max-w-3xl rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-center dark:border-zinc-800 dark:bg-zinc-950/60">
              {!isMediaGenerationTool ? (
                <>
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
                </>
              ) : isImageToVideoTool ? (
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Image to Video animates the currently loaded source image using Wan 2.1.
                </p>
              ) : null}
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
            <div className="mb-4 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950/60">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
                Start AI Servers
              </h2>
              <input
                type="text"
                value={comfyUiPath}
                onChange={(event) => setComfyUiPath(event.target.value)}
                placeholder={DEFAULT_COMFYUI_PATH}
                className="h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              />
              <button
                type="button"
                disabled={isLaunchingComfyUi || !comfyUiPath.trim()}
                onClick={() => void handleLaunchComfyUi()}
                className="mt-2 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 text-sm font-semibold text-white transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-amber-500 dark:hover:bg-amber-400"
              >
                <Power className="h-4 w-4" aria-hidden="true" />
                {isLaunchingComfyUi ? "Launching…" : "Start AI Servers"}
              </button>
              {comfyUiToast ? (
                <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">{comfyUiToast}</p>
              ) : null}
              {comfyUiError ? (
                <p className="mt-2 text-xs text-red-600 dark:text-red-400">{comfyUiError}</p>
              ) : null}
            </div>

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
              {showPromptField ? (
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  {isTextToPhotoTool || isTextToVideoTool ? "Text Prompt" : "Prompt"}
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
              ) : null}
              {isMediaGenerationTool ? (
                <div className="mt-3 space-y-3">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Base Dimensions
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                      Width
                      <input
                        type="number"
                        min={64}
                        max={2048}
                        step={8}
                        value={genWidth}
                        onChange={(event) => setGenWidth(Number(event.target.value) || DEFAULT_TEXT2IMAGE_WIDTH)}
                        className="mt-1 h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                      />
                    </label>
                    <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                      Height
                      <input
                        type="number"
                        min={64}
                        max={2048}
                        step={8}
                        value={genHeight}
                        onChange={(event) => setGenHeight(Number(event.target.value) || DEFAULT_TEXT2IMAGE_HEIGHT)}
                        className="mt-1 h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                      />
                    </label>
                  </div>
                  {isTextToVideoTool || isImageToVideoTool ? (
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                        Video Length (frames)
                        <input
                          type="number"
                          min={1}
                          max={256}
                          step={1}
                          value={genLength}
                          onChange={(event) => setGenLength(Number(event.target.value) || DEFAULT_VIDEO_LENGTH)}
                          className="mt-1 h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                        />
                      </label>
                      <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                        Batch Size
                        <input
                          type="number"
                          min={1}
                          max={4}
                          step={1}
                          value={genBatchSize}
                          onChange={(event) => setGenBatchSize(Number(event.target.value) || DEFAULT_BATCH_SIZE)}
                          className="mt-1 h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                        />
                      </label>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {isRadianceHdrTool ? (
                <RadianceHDRPanel settings={radianceHdrSettings} onChange={setRadianceHdrSettings} />
              ) : null}
              {showPromptField && activePresets.length > 0 ? (
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
              {isObjectRemovalTool ? (
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={handleClearDrawMask}
                    className="inline-flex h-10 items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    Clear Mask
                  </button>
                  <button
                    type="button"
                    disabled={!hasDrawnMask || isRemovingObject}
                    onClick={() => void handleRemoveObject()}
                    className="inline-flex h-10 items-center justify-center rounded-lg bg-red-600 px-4 text-sm font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-red-500 dark:hover:bg-red-400"
                  >
                    {isRemovingObject ? "Removing Object..." : "Remove Object"}
                  </button>
                </div>
              ) : null}
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={
                    isGenerating ||
                    !canGenerateObjectSwap ||
                    (isImageToVideoTool && !effectivePhotoUrl)
                  }
                  onClick={() => void handleGeneratePreview()}
                  className="inline-flex h-10 items-center justify-center rounded-lg bg-zinc-900 px-4 text-sm font-semibold text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  {generationButtonLabel}
                </button>
                <button
                  type="button"
                  disabled={!previewImageUrl || previewMediaType === "video"}
                  onClick={() => void handleConfirmSaveFinalEdit()}
                  className="inline-flex h-10 items-center justify-center rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
                >
                  {isSaving ? "Saving..." : "Confirm & Save Final Edit"}
                </button>
              </div>
              <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                {isMediaGenerationTool
                  ? isTextToPhotoTool
                    ? "Generates a Flux photo preview in the viewer."
                    : "Generates a Wan 2.1 video preview. Video jobs may take 5–10 minutes."
                  : isRadianceHdrTool
                    ? "Applies Radiance HDR shadow/highlight recovery and ACES output transform."
                  : '(Generates a preview below. "Confirm & Save" creates the final _wf file)'}
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

export default function AiStudioPage() {
  return (
    <Suspense fallback={null}>
      <AiStudioPageContent />
    </Suspense>
  );
}
