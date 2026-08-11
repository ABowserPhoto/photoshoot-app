"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Lock, RotateCcw, RotateCw } from "lucide-react";

type GalleryItem = {
  chunkIndex: number;
  firstFilename: string;
  previewUrl: string;
  storagePath: string;
};

type GalleryResponse = {
  success?: boolean;
  localFolderName?: string;
  status?: string;
  photoshootType?: string;
  bracketSize?: number;
  totalChunks?: number;
  gallery?: GalleryItem[];
  selectedGallery?: GalleryItem[];
  selection?: {
    selectedChunkIndices?: number[];
    selectedFiles?: string[];
    submittedAt?: string | null;
  };
  error?: string;
};

type ProcessResponse = {
  success?: boolean;
  message?: string;
  error?: string;
  taskStatusUpdated?: boolean;
  gallerySelectionSaved?: boolean;
  dbWarning?: string | null;
};

type RotateDirection = "cw" | "ccw";

function formatSelectionLockedLabel(submittedAt: string): string | null {
  const parsed = new Date(submittedAt);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  const datePart = new Intl.DateTimeFormat("de-DE", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(parsed);
  const timePart = new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
  return `Auswahl gesperrt am ${datePart} um ${timePart} Uhr`;
}

export default function GalleryPage() {
  const searchParams = useSearchParams();
  const routeParams = useParams<{ shootId: string }>();
  const shootId = typeof routeParams?.shootId === "string" ? routeParams.shootId : "";
  const bracketSizeFromUrl = searchParams.get("bracketSize") ?? "3";
  const selectionStorageKey = useMemo(
    () => (shootId.trim() ? `gallery_selection_${shootId.trim()}` : ""),
    [shootId]
  );

  const [localFolderName, setLocalFolderName] = useState("");
  const [taskStatus, setTaskStatus] = useState<string | null>(null);
  const [photoshootType, setPhotoshootType] = useState("");
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [selectedChunks, setSelectedChunks] = useState<Set<number>>(new Set());
  const [ratingsByChunk, setRatingsByChunk] = useState<Record<number, number>>({});
  const [ratingFilter, setRatingFilter] = useState<number | "all">("all");
  const [activeChunkIndex, setActiveChunkIndex] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isLockedByServer, setIsLockedByServer] = useState(false);
  const [lockedSelectedGallery, setLockedSelectedGallery] = useState<GalleryItem[]>([]);
  const [selectionLockedAt, setSelectionLockedAt] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [rotatingByChunk, setRotatingByChunk] = useState<Record<number, RotateDirection | undefined>>({});

  const selectedCount = selectedChunks.size;
  const isLandscape = useMemo(() => {
    const type = photoshootType.trim().toLowerCase();
    return ["immobilien", "food", "real estate"].includes(type);
  }, [photoshootType]);
  const selectedIndices = useMemo(
    () => Array.from(selectedChunks).sort((a, b) => a - b),
    [selectedChunks]
  );
  const filteredGallery = useMemo(() => {
    if (ratingFilter === "all") {
      return gallery;
    }
    return gallery.filter((item) => (ratingsByChunk[item.chunkIndex] ?? 0) === ratingFilter);
  }, [gallery, ratingFilter, ratingsByChunk]);

  /** After successful submit, only selected scenes are shown (ignores rating filter). */
  const gridItems = useMemo(() => {
    if (isLockedByServer) {
      if (lockedSelectedGallery.length > 0) {
        return lockedSelectedGallery;
      }
      return gallery.filter((item) => selectedChunks.has(item.chunkIndex));
    }
    if (isSuccess) {
      return gallery.filter((item) => selectedChunks.has(item.chunkIndex));
    }
    return filteredGallery;
  }, [gallery, filteredGallery, isSuccess, isLockedByServer, lockedSelectedGallery, selectedChunks]);

  const activeModalItem = useMemo(
    () => (activeChunkIndex == null ? null : gridItems.find((item) => item.chunkIndex === activeChunkIndex) ?? null),
    [activeChunkIndex, gridItems]
  );
  const activeModalPosition = useMemo(() => {
    if (activeChunkIndex == null) {
      return -1;
    }
    return gridItems.findIndex((item) => item.chunkIndex === activeChunkIndex);
  }, [activeChunkIndex, gridItems]);
  const isSelectionAvailable = useMemo(() => {
    const normalized = (taskStatus ?? "").trim().toLowerCase().replace(/\s+/g, "-");
    const allowedStatuses = new Set(["preview-sent", "selection-available"]);
    return allowedStatuses.has(normalized);
  }, [taskStatus]);
  const isExpired = useMemo(() => {
    if (taskStatus == null) {
      return false;
    }
    return !isSelectionAvailable;
  }, [isSelectionAvailable, taskStatus]);
  const selectionLockedLabel = useMemo(() => {
    if (selectionLockedAt) {
      return formatSelectionLockedLabel(selectionLockedAt);
    }
    if (isLockedByServer || isSuccess) {
      return "Auswahl gesperrt – Ihre Fotos wurden erfolgreich übermittelt.";
    }
    return null;
  }, [isLockedByServer, isSuccess, selectionLockedAt]);
  const showLockedBadge = (isLockedByServer || isSuccess) && Boolean(selectionLockedLabel);

  useEffect(() => {
    if (!shootId.trim()) {
      return;
    }
    void loadGallery(shootId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shootId, bracketSizeFromUrl]);

  useEffect(() => {
    if (!selectionStorageKey) {
      setSelectedChunks(new Set());
      return;
    }
    if (isLockedByServer) {
      return;
    }
    try {
      const raw = window.localStorage.getItem(selectionStorageKey);
      if (!raw) {
        setSelectedChunks(new Set());
        return;
      }
      const parsed = JSON.parse(raw) as unknown;
      const selected = Array.isArray(parsed)
        ? parsed.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 0)
        : [];
      setSelectedChunks(new Set(selected));
    } catch {
      setSelectedChunks(new Set());
    }
  }, [isLockedByServer, selectionStorageKey]);

  useEffect(() => {
    if (!selectionStorageKey) {
      return;
    }
    if (isLockedByServer) {
      window.localStorage.removeItem(selectionStorageKey);
      return;
    }
    window.localStorage.setItem(selectionStorageKey, JSON.stringify(selectedIndices));
  }, [isLockedByServer, selectionStorageKey, selectedIndices]);

  async function loadGallery(targetShootId: string) {
    setIsLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsSuccess(false);
    setIsLockedByServer(false);
    setLockedSelectedGallery([]);
    setSelectionLockedAt(null);
    setRatingsByChunk({});
    setActiveChunkIndex(null);
    try {
      const response = await fetch("/api/gallery/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shootId: targetShootId,
          bracketSize: Number(bracketSizeFromUrl) || 3,
        }),
      });
      const payload = (await response.json().catch(() => null)) as GalleryResponse | null;
      if (!response.ok) {
        setTaskStatus(null);
        setGallery([]);
        setErrorMessage(payload?.error ?? `Galerie konnte nicht geladen werden (${response.status}).`);
        return;
      }
      setLocalFolderName(payload?.localFolderName ?? "");
      setTaskStatus(typeof payload?.status === "string" ? payload.status : "");
      setPhotoshootType(typeof payload?.photoshootType === "string" ? payload.photoshootType : "");
      setGallery(payload?.gallery ?? []);
      const serverSelectedIndices = Array.from(
        new Set(
          (Array.isArray(payload?.selection?.selectedChunkIndices) ? payload.selection.selectedChunkIndices : [])
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value >= 0)
        )
      ).sort((a, b) => a - b);
      if (serverSelectedIndices.length > 0) {
        setSelectedChunks(new Set(serverSelectedIndices));
        setIsSuccess(true);
        setIsLockedByServer(true);
        setLockedSelectedGallery(payload?.selectedGallery ?? []);
        const submittedAt =
          typeof payload?.selection?.submittedAt === "string" ? payload.selection.submittedAt.trim() : "";
        setSelectionLockedAt(submittedAt || null);
        setSuccessMessage("Auswahl bereits eingereicht. Galerie ist im Nur-Lesen-Modus.");
        return;
      }
    } catch {
      setTaskStatus(null);
      setGallery([]);
      setErrorMessage("Netzwerkfehler beim Laden der Galerie.");
    } finally {
      setIsLoading(false);
    }
  }

  function toggleChunk(index: number) {
    if (isSuccess || isLockedByServer) {
      return;
    }
    setSelectedChunks((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }

  function setRating(index: number, rating: number) {
    if (isSuccess || isLockedByServer) {
      return;
    }
    setRatingsByChunk((prev) => ({ ...prev, [index]: rating }));
  }

  function openLightbox(index: number) {
    setActiveChunkIndex(index);
  }

  function closeLightbox() {
    setActiveChunkIndex(null);
  }

  function goToRelativeItem(offset: -1 | 1) {
    if (activeModalPosition < 0 || gridItems.length === 0) {
      return;
    }
    const nextPosition = (activeModalPosition + offset + gridItems.length) % gridItems.length;
    setActiveChunkIndex(gridItems[nextPosition]?.chunkIndex ?? null);
  }

  async function submitSelections() {
    if (isSuccess || isLockedByServer) {
      return;
    }
    if (selectedIndices.length === 0) {
      setErrorMessage("Bitte wählen Sie mindestens eine Szene aus.");
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const response = await fetch("/api/gallery/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shootId,
          local_folder_name: localFolderName.trim(),
          bracketSize: Number(bracketSizeFromUrl) || 3,
          selectedChunkIndices: selectedIndices,
        }),
      });
      const payload = (await response.json().catch(() => null)) as ProcessResponse | null;
      if (!response.ok) {
        setErrorMessage(payload?.error ?? `Auswahl konnte nicht gespeichert werden (${response.status}).`);
        return;
      }
      if (payload?.success === false) {
        setErrorMessage(payload.message ?? "Die Auswahl konnte nicht vollständig verarbeitet werden.");
        return;
      }
      if (
        shootId.trim() &&
        (payload?.taskStatusUpdated === false || payload?.gallerySelectionSaved === false)
      ) {
        setErrorMessage(
          payload.dbWarning ??
            payload.error ??
            "Die Auswahl konnte nicht in der Datenbank gespeichert werden. Bitte versuchen Sie es erneut."
        );
        return;
      }
      if (selectionStorageKey) {
        window.localStorage.removeItem(selectionStorageKey);
      }
      setIsSuccess(true);
      setSelectionLockedAt(new Date().toISOString());
      setSuccessMessage("Auswahl erfolgreich gesendet. Vielen Dank!");
    } catch {
      setErrorMessage("Netzwerkfehler beim Absenden der Auswahl.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function rotatePreview(item: GalleryItem, direction: RotateDirection) {
    if (isLockedByServer) {
      return;
    }
    if (!shootId.trim()) {
      setErrorMessage("Could not rotate image: missing shootId.");
      return;
    }
    setRotatingByChunk((prev) => ({ ...prev, [item.chunkIndex]: direction }));
    setErrorMessage(null);
    try {
      const response = await fetch("/api/gallery/rotate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shootId: shootId.trim(),
          chunkIndex: item.chunkIndex,
          direction,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { success?: boolean; previewUrl?: string; error?: string }
        | null;
      if (!response.ok || !payload?.success) {
        setErrorMessage(payload?.error ?? `Rotation failed (${response.status}).`);
        return;
      }
      const refreshedUrl =
        payload.previewUrl?.trim() ||
        `${item.previewUrl}${item.previewUrl.includes("?") ? "&" : "?"}t=${Date.now()}`;
      setGallery((prev) =>
        prev.map((entry) =>
          entry.chunkIndex === item.chunkIndex
            ? {
                ...entry,
                previewUrl: refreshedUrl,
              }
            : entry
        )
      );
    } catch {
      setErrorMessage("Network error while rotating image.");
    } finally {
      setRotatingByChunk((prev) => {
        const next = { ...prev };
        delete next[item.chunkIndex];
        return next;
      });
    }
  }

  function StarsRow({
    chunkIndex,
    size = "text-base",
    disabled = false,
  }: {
    chunkIndex: number;
    size?: string;
    disabled?: boolean;
  }) {
    const currentRating = ratingsByChunk[chunkIndex] ?? 0;
    return (
      <div className={`flex items-center gap-1 ${disabled ? "pointer-events-none opacity-50" : ""}`}>
        {Array.from({ length: 5 }, (_, idx) => {
          const starValue = idx + 1;
          const active = starValue <= currentRating;
          return (
            <button
              key={starValue}
              type="button"
              disabled={disabled}
              onClick={(event) => {
                event.stopPropagation();
                setRating(chunkIndex, starValue);
              }}
              aria-label={`Bewertung ${starValue} Sterne`}
              className={`${size} leading-none transition ${active ? "text-yellow-400" : "text-zinc-500 hover:text-zinc-300"}`}
            >
              ★
            </button>
          );
        })}
      </div>
    );
  }

  function displayFilename(filename: string): string {
    return filename.replace(/\.[^/.]+$/, "");
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="sticky top-0 z-30 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur">
        <div className="mx-auto flex h-32 w-full max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center">
            <img
              src="/Logo_1024_white.webp"
              alt="Logo"
              className="h-28 w-auto object-contain"
            />
          </div>
          <div className="text-sm font-medium uppercase tracking-[0.22em] text-zinc-100">Vorschau</div>
        </div>
      </header>

      {isExpired ? (
        <section className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-6">
          <div className="w-full max-w-3xl rounded-2xl border border-zinc-800 bg-zinc-900/70 p-8 text-center shadow-2xl">
            <img
              src="/Logo_1024_white.webp"
              alt="Logo"
              className="mx-auto h-24 w-auto object-contain"
            />
            <p className="mt-6 text-lg font-medium text-zinc-100">
              Dieser Galerie-Link ist abgelaufen. Ihre endgültigen Bilder werden bearbeitet oder wurden bereits geliefert.
            </p>
          </div>
        </section>
      ) : (
      <>
      <div className="mx-auto max-w-7xl px-4 pb-28 pt-4 sm:px-6">
        <header className="mb-4">
          <h1 className="text-xl font-semibold">
            {showLockedBadge ? "Ihre ausgewählten Fotos" : "Wählen Sie Ihre Lieblingsfotos aus"}
          </h1>
          {showLockedBadge ? (
            <div
              className="mt-3 inline-flex max-w-full items-center gap-2.5 rounded-full border border-emerald-700/50 bg-emerald-950/40 px-4 py-2 text-sm text-emerald-100 shadow-sm"
              role="status"
              aria-live="polite"
            >
              <Lock className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
              <span className="font-medium">{selectionLockedLabel}</span>
            </div>
          ) : (
            <p className="mt-1 text-sm text-zinc-400">
              Klicken Sie auf ein Bild, um die Szene zu markieren. Über das Vergrößern-Symbol öffnen
              Sie die Vollansicht.
            </p>
          )}
        </header>

        {!isSuccess && !isLockedByServer ? (
        <section className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 p-2">
          <span className="px-1 text-xs font-medium uppercase tracking-wide text-zinc-300">
            Bewertung filtern
          </span>
          <button
            type="button"
            onClick={() => setRatingFilter("all")}
            className={`rounded-md px-3 py-1 text-xs font-medium ${
              ratingFilter === "all"
                ? "bg-zinc-100 text-zinc-900"
                : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
            }`}
          >
            Alle
          </button>
          {Array.from({ length: 5 }, (_, idx) => {
            const rating = idx + 1;
            const active = ratingFilter === rating;
            return (
              <button
                key={rating}
                type="button"
                onClick={() => setRatingFilter(rating)}
                className={`rounded-md px-3 py-1 text-xs font-medium ${
                  active ? "bg-yellow-400 text-zinc-900" : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                }`}
              >
                {rating}★
              </button>
            );
          })}
        </section>
        ) : null}

        {errorMessage ? (
          <p className="mb-4 rounded-md border border-red-700 bg-red-950/60 px-3 py-2 text-sm text-red-100">
            {errorMessage}
          </p>
        ) : null}
        {successMessage ? (
          <p className="mb-4 rounded-md border border-emerald-700 bg-emerald-950/60 px-3 py-2 text-sm text-emerald-100">
            {successMessage}
          </p>
        ) : null}

        {isLoading ? (
          <p className="text-sm text-zinc-400">Galerie wird geladen...</p>
        ) : gridItems.length === 0 ? (
          <p className="text-sm text-zinc-400">
            Keine Vorschauen für den aktuellen Filter gefunden.
          </p>
        ) : (
          <section
            className={
              isLandscape
                ? "grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
                : "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-5"
            }
          >
            {gridItems.map((item) => {
              const selected = selectedChunks.has(item.chunkIndex);
              const activeRotateDirection = rotatingByChunk[item.chunkIndex];
              const isRotatingThisItem = Boolean(activeRotateDirection);
              return (
                <article
                  key={item.chunkIndex}
                  className={`group relative overflow-hidden rounded-lg border bg-zinc-900/60 ${
                    selected ? "border-green-500/80 ring-1 ring-green-500/40" : "border-zinc-800"
                  }`}
                >
                  <button
                    type="button"
                    disabled={isSuccess || isLockedByServer}
                    onClick={() => toggleChunk(item.chunkIndex)}
                    className="relative block w-full text-left disabled:cursor-not-allowed"
                    aria-pressed={selected}
                    aria-label={`Szene ${item.chunkIndex + 1} ${selected ? "abwählen" : "auswählen"}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.previewUrl}
                      alt={`Scene ${item.chunkIndex + 1}`}
                      className={
                        isLandscape
                          ? "h-32 w-full bg-black object-contain transition duration-200 group-hover:opacity-95"
                          : "aspect-[3/4] h-auto w-full bg-black object-contain transition duration-200 group-hover:opacity-95"
                      }
                      loading="lazy"
                    />
                    {selected ? (
                      <span className="absolute left-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-green-500 text-xs font-bold text-white shadow">
                        ✓
                      </span>
                    ) : null}
                  </button>
                  <div className="border-t border-zinc-800 px-2 py-2">
                    <div className="truncate text-[11px] text-zinc-400">{displayFilename(item.firstFilename)}</div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <StarsRow chunkIndex={item.chunkIndex} disabled={isSuccess || isLockedByServer} />
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            openLightbox(item.chunkIndex);
                          }}
                          title="Vollansicht"
                          aria-label={`Szene ${item.chunkIndex + 1} vergrößern`}
                          className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-zinc-500 bg-zinc-900 px-1 text-[10px] font-semibold text-zinc-300 hover:bg-zinc-800"
                        >
                          ⤢
                        </button>
                        <button
                          type="button"
                          disabled={isSuccess || isLockedByServer || isRotatingThisItem}
                          onClick={(event) => {
                            event.stopPropagation();
                            void rotatePreview(item, "ccw");
                          }}
                          title="Nach links drehen (90°)"
                          aria-label={`Rotate scene ${item.chunkIndex + 1} left by 90 degrees`}
                          className="inline-flex h-5 w-5 items-center justify-center rounded-sm border border-zinc-500 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <RotateCcw
                            className={`h-3 w-3 ${activeRotateDirection === "ccw" ? "animate-spin" : ""}`}
                          />
                        </button>
                        <button
                          type="button"
                          disabled={isSuccess || isLockedByServer || isRotatingThisItem}
                          onClick={(event) => {
                            event.stopPropagation();
                            void rotatePreview(item, "cw");
                          }}
                          title="Nach rechts drehen (90°)"
                          aria-label={`Rotate scene ${item.chunkIndex + 1} right by 90 degrees`}
                          className="inline-flex h-5 w-5 items-center justify-center rounded-sm border border-zinc-500 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <RotateCw
                            className={`h-3 w-3 ${activeRotateDirection === "cw" ? "animate-spin" : ""}`}
                          />
                        </button>
                        <button
                          type="button"
                          disabled={isSuccess || isLockedByServer}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleChunk(item.chunkIndex);
                          }}
                          aria-label={`Szene ${item.chunkIndex + 1} ${selected ? "abwählen" : "auswählen"}`}
                          aria-disabled={isSuccess || isLockedByServer}
                          className={`inline-flex h-5 w-5 items-center justify-center rounded-sm border text-[11px] font-bold disabled:cursor-not-allowed disabled:opacity-60 ${
                            selected
                              ? "border-green-400 bg-green-500 text-white"
                              : "border-zinc-500 bg-zinc-900 text-zinc-300"
                          }`}
                        >
                          {selected ? "✓" : ""}
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </div>

      {activeModalItem ? (
        <div
          className="fixed inset-0 z-40 bg-black/90"
          onClick={closeLightbox}
          role="presentation"
        >
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              closeLightbox();
            }}
            className="absolute right-4 top-4 z-50 inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-600 bg-zinc-900/80 text-xl text-zinc-100"
            aria-label="Schließen"
          >
            ×
          </button>

          {gridItems.length > 1 ? (
            <>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  goToRelativeItem(-1);
                }}
                className="absolute left-4 top-1/2 z-50 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-zinc-600 bg-zinc-900/80 text-2xl text-zinc-100"
                aria-label="Vorheriges Bild"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  goToRelativeItem(1);
                }}
                className="absolute right-4 top-1/2 z-50 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-zinc-600 bg-zinc-900/80 text-2xl text-zinc-100"
                aria-label="Nächstes Bild"
              >
                ›
              </button>
            </>
          ) : null}

          <div
            className="mx-auto flex h-full w-full max-w-7xl flex-col items-center justify-center px-4 pb-8 pt-16"
            onClick={(event) => event.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={activeModalItem.previewUrl}
              alt={activeModalItem.firstFilename}
              className="max-h-[78vh] w-auto max-w-full object-contain"
            />
            <div className="mt-3 w-full max-w-3xl rounded-lg border border-zinc-700 bg-zinc-900/80 px-4 py-3">
              <div className="truncate text-sm text-zinc-300">{displayFilename(activeModalItem.firstFilename)}</div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <StarsRow
                  chunkIndex={activeModalItem.chunkIndex}
                  size="text-xl"
                  disabled={isSuccess || isLockedByServer}
                />
                <button
                  type="button"
                  disabled={isSuccess || isLockedByServer}
                  onClick={() => toggleChunk(activeModalItem.chunkIndex)}
                  aria-disabled={isSuccess || isLockedByServer}
                  className={`inline-flex h-7 min-w-7 items-center justify-center rounded-sm border px-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${
                    selectedChunks.has(activeModalItem.chunkIndex)
                      ? "border-green-400 bg-green-500 text-white"
                      : "border-zinc-500 bg-zinc-900 text-zinc-300"
                  }`}
                >
                  {selectedChunks.has(activeModalItem.chunkIndex) ? "Ausgewählt" : "Auswählen"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <p className="text-sm text-zinc-300">
            {selectedCount} Szenen ausgewählt
          </p>
          <button
            type="button"
            onClick={() => void submitSelections()}
            disabled={isSubmitting || selectedCount === 0 || isSuccess || isLockedByServer}
            className={`h-10 rounded-md px-5 text-sm font-semibold text-white ${
              isSuccess || isLockedByServer
                ? "cursor-default bg-[#9E9900]"
                : "bg-[#BA1F00] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            }`}
          >
            {isLockedByServer
              ? "Auswahl bereits gesendet"
              : isSuccess
                ? "Auswahl gesendet!"
                : isSubmitting
                  ? "Wird gesendet..."
                  : "Auswahl absenden"}
          </button>
        </div>
      </div>
      </>
      )}
    </main>
  );
}

