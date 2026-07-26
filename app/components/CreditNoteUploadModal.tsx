"use client";

import { FileUp, Loader2, X } from "lucide-react";
import { useCallback, useRef, useState, type DragEvent } from "react";

import { processCreditNotePayment } from "@/app/actions/credit-note-payment";

type CreditNoteUploadModalProps = {
  open: boolean;
  taskId: string;
  taskLabel?: string;
  onClose: () => void;
  onSuccess: (result: { creditNoteFileUrl: string }) => void;
};

function isPdfFile(file: File | null | undefined): file is File {
  if (!file) return false;
  const type = (file.type || "").toLowerCase();
  const name = file.name.toLowerCase();
  return type === "application/pdf" || name.endsWith(".pdf");
}

export default function CreditNoteUploadModal({
  open,
  taskId,
  taskLabel,
  onClose,
  onSuccess,
}: CreditNoteUploadModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetAndClose = useCallback(() => {
    if (submitting) return;
    setFile(null);
    setError(null);
    setDragOver(false);
    onClose();
  }, [onClose, submitting]);

  const pickFile = useCallback((next: File | null) => {
    setError(null);
    if (!next) {
      setFile(null);
      return;
    }
    if (!isPdfFile(next)) {
      setFile(null);
      setError("Please select a PDF file.");
      return;
    }
    setFile(next);
  }, []);

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragOver(false);
      const dropped = event.dataTransfer.files?.[0] ?? null;
      pickFile(dropped);
    },
    [pickFile]
  );

  const handleSubmit = useCallback(async () => {
    if (!file || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const result = await processCreditNotePayment(taskId, formData);
      if (!result.ok) {
        throw new Error(result.error);
      }
      setFile(null);
      onSuccess({ creditNoteFileUrl: result.creditNoteFileUrl });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setSubmitting(false);
    }
  }, [file, onSuccess, submitting, taskId]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/65 p-4"
      onClick={resetAndClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="credit-note-upload-title"
        className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-950 p-4 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="credit-note-upload-title" className="text-sm font-semibold text-zinc-100">
              Upload credit note PDF
            </h2>
            <p className="mt-1 text-xs text-zinc-400">
              Marking this paid requires uploading the credit note. It will be sent to the Lexoffice
              Inbox and stored with the booking.
              {taskLabel ? (
                <>
                  {" "}
                  <span className="text-zinc-300">{taskLabel}</span>
                </>
              ) : null}
            </p>
          </div>
          <button
            type="button"
            onClick={resetAndClose}
            disabled={submitting}
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={`mt-4 flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-4 py-8 text-center transition ${
            dragOver
              ? "border-amber-400/70 bg-amber-500/10"
              : "border-zinc-700 bg-zinc-900/60 hover:border-zinc-500"
          }`}
        >
          <FileUp className="h-7 w-7 text-zinc-400" />
          <p className="mt-2 text-sm text-zinc-200">
            {file ? file.name : "Drop PDF here or click to browse"}
          </p>
          <p className="mt-1 text-[11px] text-zinc-500">PDF only · max 5 MB</p>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(event) => pickFile(event.target.files?.[0] ?? null)}
          />
        </div>

        {error ? (
          <p className="mt-3 rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={resetAndClose}
            disabled={submitting}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!file || submitting}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-600/50 bg-amber-500/15 px-3 py-1.5 text-sm font-medium text-amber-100 hover:bg-amber-500/25 disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {submitting ? "Uploading…" : "Upload & mark paid"}
          </button>
        </div>
      </div>
    </div>
  );
}
