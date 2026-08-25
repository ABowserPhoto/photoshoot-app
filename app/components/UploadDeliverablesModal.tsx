"use client";

import { useEffect, useMemo, useState } from "react";

import {
  DELIVERABLE_FILE_INPUT_ACCEPT,
  isEditedUploadFile,
} from "@/lib/deliverableFiles";
import {
  buildContactPersonName,
  buildInvoicePreflightSummary,
  type FinalizeShootTask,
} from "@/lib/finalizeShootPayload";
import { formatEuro } from "@/lib/adminStatsFormat";
import { resolveSocialCategoryRoute } from "@/lib/socialCategoryRouting";

export type UploadDeliverablesTask = FinalizeShootTask;

type PreviewItem = {
  key: string;
  file: File;
  url: string;
  isImage: boolean;
};

type UploadDeliverablesModalProps = {
  open: boolean;
  task: UploadDeliverablesTask | null;
  category?: string;
  onClose: () => void;
  /** Route A: existing Drive upload + finalize-shoot. Receives ALL files. */
  onUploadToDrive: (files: File[]) => Promise<void>;
  /** Route B: social grid queue for selected images only. */
  onScheduleSocials: (files: File[]) => Promise<void>;
  /** Called after both routes succeed (or Route B skipped). */
  onComplete: () => void;
};

function isPreviewableImage(file: File): boolean {
  const mime = (file.type || "").toLowerCase();
  const name = file.name.toLowerCase();
  return (
    mime.startsWith("image/") ||
    name.endsWith(".jpg") ||
    name.endsWith(".jpeg") ||
    name.endsWith(".png") ||
    name.endsWith(".webp")
  );
}

function clientDisplayName(task: UploadDeliverablesTask): string {
  return task.companyName.trim() || buildContactPersonName(task) || task.taskTitle.trim() || "Client";
}

function InvoicePreflightSection({ task }: { task: UploadDeliverablesTask }) {
  const summary = useMemo(() => buildInvoicePreflightSummary(task), [task]);

  if (summary.skipInvoice) {
    return (
      <section className="mb-5 rounded-xl border border-zinc-300 bg-zinc-50 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800/60">
        <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Invoice Summary / Pre-Flight Check
        </h4>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Invoicing is disabled for this booking. Deliverables will upload without creating a Lexoffice
          invoice.
        </p>
        {(summary.billingEntityName || summary.billingAddress) && (
          <dl className="mt-3 text-sm">
            <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Client / billing entity
            </dt>
            <dd className="font-medium text-zinc-900 dark:text-zinc-100">
              {summary.billingEntityName || "—"}
            </dd>
            {summary.billingAddress ? (
              <dd className="mt-0.5 text-zinc-700 dark:text-zinc-300">{summary.billingAddress}</dd>
            ) : null}
          </dl>
        )}
      </section>
    );
  }

  return (
    <section className="mb-5 rounded-xl border border-amber-300/70 bg-amber-50/80 px-4 py-4 dark:border-amber-700/50 dark:bg-amber-950/20">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Invoice Summary / Pre-Flight Check
          </h4>
          <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
            Lexoffice will bill the company name below — not the contact person.
          </p>
        </div>
        <span className="rounded-full bg-amber-200/80 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-950 dark:bg-amber-900/60 dark:text-amber-100">
          {summary.taxType} · {summary.taxRate}% VAT
        </span>
      </div>

      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div className="sm:col-span-2">
          <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Billing entity
          </dt>
          <dd className="font-semibold text-zinc-900 dark:text-zinc-100">
            {summary.billingEntityName || (
              <span className="text-red-600 dark:text-red-400">Missing company name</span>
            )}
          </dd>
          {summary.billingAddress ? (
            <dd className="mt-0.5 text-zinc-700 dark:text-zinc-300">{summary.billingAddress}</dd>
          ) : (
            <dd className="mt-0.5 text-amber-800 dark:text-amber-200/90">
              No billing address on file (street, zip, city)
            </dd>
          )}
        </div>
        {summary.contactPersonName ? (
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Gallery recipient (not on invoice)
            </dt>
            <dd className="text-zinc-800 dark:text-zinc-200">{summary.contactPersonName}</dd>
          </div>
        ) : null}
      </dl>

      <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900/80">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            <tr>
              <th className="px-3 py-2 font-medium">Item</th>
              <th className="px-3 py-2 font-medium">Qty</th>
              <th className="px-3 py-2 font-medium">Unit</th>
              <th className="px-3 py-2 text-right font-medium">Line total</th>
            </tr>
          </thead>
          <tbody>
            {summary.lineItems.map((item) => (
              <tr
                key={`${item.name}-${item.quantity}-${item.unitPrice}`}
                className="border-b border-zinc-100 last:border-0 dark:border-zinc-800"
              >
                <td className="px-3 py-2 text-zinc-900 dark:text-zinc-100">{item.name}</td>
                <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">{item.quantity}</td>
                <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">
                  {formatEuro(item.unitPrice)}
                </td>
                <td className="px-3 py-2 text-right text-zinc-900 dark:text-zinc-100">
                  {formatEuro(item.lineTotal)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="mt-3 grid gap-1 text-sm sm:grid-cols-3">
        <div className="flex justify-between gap-2 sm:block">
          <dt className="text-zinc-500 dark:text-zinc-400">Net total</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-100">
            {formatEuro(summary.subtotalNet)}
          </dd>
        </div>
        <div className="flex justify-between gap-2 sm:block">
          <dt className="text-zinc-500 dark:text-zinc-400">VAT ({summary.taxRate}%)</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-100">
            {formatEuro(summary.taxAmount)}
          </dd>
        </div>
        <div className="flex justify-between gap-2 sm:block">
          <dt className="text-zinc-500 dark:text-zinc-400">Gross total</dt>
          <dd className="font-semibold text-zinc-900 dark:text-zinc-100">
            {formatEuro(summary.subtotalGross)}
          </dd>
        </div>
      </dl>

      {summary.warnings.length > 0 ? (
        <ul className="mt-3 space-y-1 text-sm text-red-700 dark:text-red-400">
          {summary.warnings.map((warning) => (
            <li key={warning}>• {warning}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export default function UploadDeliverablesModal({
  open,
  task,
  category,
  onClose,
  onUploadToDrive,
  onScheduleSocials,
  onComplete,
}: UploadDeliverablesModalProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [files, setFiles] = useState<File[]>([]);
  const [socialKeys, setSocialKeys] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const effectiveCategory = (category ?? task?.photoshootType ?? "").trim();
  const route = useMemo(
    () => resolveSocialCategoryRoute(effectiveCategory),
    [effectiveCategory]
  );

  const previews = useMemo<PreviewItem[]>(() => {
    return files.map((file, index) => ({
      key: `${file.name}-${file.size}-${file.lastModified}-${index}`,
      file,
      url: isPreviewableImage(file) ? URL.createObjectURL(file) : "",
      isImage: isPreviewableImage(file),
    }));
  }, [files]);

  useEffect(() => {
    return () => {
      for (const item of previews) {
        if (item.url) {
          URL.revokeObjectURL(item.url);
        }
      }
    };
  }, [previews]);

  useEffect(() => {
    if (!open) {
      setStep(1);
      setFiles([]);
      setSocialKeys(new Set());
      setError(null);
      setBusy(false);
    }
  }, [open]);

  if (!open || !task) {
    return null;
  }

  function addFiles(next: File[]) {
    const accepted = next.filter(isEditedUploadFile);
    if (accepted.length === 0) {
      setError("Only JPG/JPEG images, videos, and PDF files are supported.");
      return;
    }
    setFiles((prev) => [...prev, ...accepted]);
    setError(null);
  }

  function toggleSocial(key: string) {
    setSocialKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  async function handleSubmit() {
    if (files.length === 0) {
      setError("Please select at least one file.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const socialFiles = previews
        .filter((item) => socialKeys.has(item.key) && item.isImage)
        .map((item) => item.file);

      // Route A first (unchanged Drive + email finalize path).
      await onUploadToDrive(files);

      // Route B — selected social images only (optional).
      if (socialFiles.length > 0) {
        await onScheduleSocials(socialFiles);
      }

      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-zinc-900">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-6 py-5 dark:border-zinc-800">
          <div>
            <h3 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
              Upload Deliverables
            </h3>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {task.taskTitle || clientDisplayName(task)} · Step {step} of 2
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-md px-2 py-1 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            X
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <InvoicePreflightSection task={task} />

          {step === 1 ? (
            <>
              <div
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  addFiles(Array.from(event.dataTransfer.files));
                }}
                className="rounded-xl border-2 border-dashed border-zinc-300 bg-zinc-50 p-8 text-center dark:border-zinc-700 dark:bg-zinc-800/60"
              >
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                  Drag & drop finished JPEGs (videos/PDFs also accepted)
                </p>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  or choose files manually
                </p>
                <input
                  type="file"
                  multiple
                  accept={DELIVERABLE_FILE_INPUT_ACCEPT}
                  onChange={(event) => {
                    addFiles(Array.from(event.target.files ?? []));
                    event.target.value = "";
                  }}
                  className="mt-4 block w-full text-sm text-zinc-700 file:mr-4 file:rounded-md file:border-0 file:bg-zinc-900 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-zinc-700 dark:text-zinc-200 dark:file:bg-zinc-100 dark:file:text-zinc-900"
                />
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {previews.length === 0 ? (
                  <p className="col-span-full text-sm text-zinc-500 dark:text-zinc-400">
                    No files selected yet.
                  </p>
                ) : (
                  previews.map((item) => (
                    <div
                      key={item.key}
                      className="overflow-hidden rounded-lg border border-zinc-200 bg-zinc-950 dark:border-zinc-700"
                    >
                      {item.isImage && item.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.url}
                          alt={item.file.name}
                          className="aspect-square h-auto w-full object-cover"
                        />
                      ) : (
                        <div className="flex aspect-square items-center justify-center bg-zinc-100 px-2 text-center text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                          {item.file.name}
                        </div>
                      )}
                      <p className="truncate px-2 py-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                        {item.file.name}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </>
          ) : (
            <>
              <div className="mb-4 rounded-lg border border-emerald-700/40 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-100">
                {route.routingBadge}
              </div>
              <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
                Click photos to mark them for the Social Scheduler grid. Unselected files still go to
                Google Drive.
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {previews.map((item) => {
                  const selected = socialKeys.has(item.key);
                  const disabled = !item.isImage;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      disabled={disabled || busy}
                      onClick={() => toggleSocial(item.key)}
                      className={`relative overflow-hidden rounded-lg border text-left transition ${
                        selected
                          ? "border-emerald-500 ring-2 ring-emerald-500/50"
                          : "border-zinc-200 dark:border-zinc-700"
                      } ${disabled ? "cursor-not-allowed opacity-50" : "hover:border-zinc-400"}`}
                    >
                      {item.isImage && item.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.url}
                          alt={item.file.name}
                          className="aspect-square h-auto w-full object-cover"
                        />
                      ) : (
                        <div className="flex aspect-square items-center justify-center bg-zinc-100 px-2 text-center text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                          Not for social
                        </div>
                      )}
                      {selected ? (
                        <span className="absolute left-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-xs font-bold text-white">
                          ✓
                        </span>
                      ) : null}
                      <p className="truncate px-2 py-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                        {item.file.name}
                      </p>
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                {socialKeys.size} photo{socialKeys.size === 1 ? "" : "s"} selected for social
              </p>
            </>
          )}

          {error ? <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-zinc-200 px-6 py-4 dark:border-zinc-800">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (step === 2) {
                setStep(1);
                return;
              }
              onClose();
            }}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-zinc-300 px-4 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            {step === 1 ? "Cancel" : "Back"}
          </button>

          {step === 1 ? (
            <button
              type="button"
              disabled={busy || files.length === 0}
              onClick={() => {
                if (files.length === 0) {
                  setError("Please select at least one file.");
                  return;
                }
                setError(null);
                setStep(2);
              }}
              className="inline-flex h-10 items-center justify-center rounded-lg bg-zinc-900 px-4 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              Next: Social Selection
            </button>
          ) : (
            <button
              type="button"
              disabled={busy || files.length === 0}
              onClick={() => void handleSubmit()}
              className="inline-flex h-10 items-center justify-center rounded-lg bg-[#BA1F00] px-4 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Uploading & scheduling..." : "Upload to Drive & Schedule Socials"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
