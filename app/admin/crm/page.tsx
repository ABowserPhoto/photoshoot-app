"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuthRole } from "@/app/contexts/AuthRoleContext";
import { formatEuro } from "@/lib/adminStatsFormat";
import ClientManagerSection from "@/app/admin/crm/ClientManagerSection";
import UserManagementSection from "@/app/admin/crm/UserManagementSection";
import CreditNoteUploadModal from "@/app/components/CreditNoteUploadModal";

type CrmTab = "billing" | "clients" | "users";

type UnpaidBillingItem = {
  id: string;
  type: "lexoffice" | "credit_note";
  clientName: string;
  companyName: string | null;
  contactName: string | null;
  invoiceNumber: string | null;
  documentName: string;
  date: string | null;
  dateLabel: string;
  amount: number;
  clientEmail: string | null;
  canSendReminder: boolean;
  lexofficeInvoiceId: string | null;
  taskId: string | null;
  contactId: string | null;
  voucherStatus: string | null;
  linkedJobName: string | null;
};

function matchesUnpaidBillingSearch(item: UnpaidBillingItem, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }

  const haystack = [
    item.clientName,
    item.companyName,
    item.contactName,
    item.invoiceNumber,
    item.documentName,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.toLowerCase());

  return haystack.some((value) => value.includes(needle));
}

const TAB_ITEMS: { id: CrmTab; label: string }[] = [
  { id: "billing", label: "Unpaid Billing" },
  { id: "clients", label: "Client Manager" },
  { id: "users", label: "User Management" },
];

export default function AdminCrmPage() {
  const { isLoading: authLoading, isAdmin, canAccess } = useAuthRole();
  const [activeTab, setActiveTab] = useState<CrmTab>("billing");
  const [items, setItems] = useState<UnpaidBillingItem[]>([]);
  const [billingSearch, setBillingSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [creditNoteUpload, setCreditNoteUpload] = useState<{
    taskId: string;
    label: string;
  } | null>(null);
  const [invoiceScanBusy, setInvoiceScanBusy] = useState(false);

  const filteredItems = useMemo(
    () => items.filter((item) => matchesUnpaidBillingSearch(item, billingSearch)),
    [items, billingSearch]
  );

  const loadUnpaid = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/crm/unpaid-billing", { cache: "no-store", credentials: "include" });
      const json = (await response.json().catch(() => null)) as
        | { ok?: boolean; items?: UnpaidBillingItem[]; error?: string }
        | null;
      if (!response.ok) {
        throw new Error(json?.error ?? `Failed to load unpaid billing (${response.status})`);
      }
      setItems(json?.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load unpaid billing.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) {
      return;
    }
    if (!isAdmin && activeTab === "users") {
      setActiveTab("billing");
      return;
    }
    if (activeTab === "billing") {
      void loadUnpaid();
    }
  }, [activeTab, authLoading, isAdmin, loadUnpaid]);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const handleGenerateReminder = async (item: UnpaidBillingItem) => {
    setBusyItemId(item.id);
    setError(null);
    try {
      const body =
        item.type === "lexoffice"
          ? {
              type: "lexoffice",
              lexofficeInvoiceId: item.lexofficeInvoiceId,
              ...(item.taskId ? { taskId: item.taskId } : {}),
            }
          : {
              type: "credit_note",
              taskId: item.taskId,
            };

      const response = await fetch("/api/tasks/generate-reminder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const json = (await response.json().catch(() => null)) as
        | { ok?: boolean; message?: string; error?: string; markedPaid?: boolean }
        | null;
      if (!response.ok) {
        throw new Error(json?.error ?? `Reminder failed (${response.status})`);
      }
      if (json?.markedPaid) {
        setToast("Invoice already paid in Lexoffice — removed from unpaid list.");
        setItems((prev) => prev.filter((row) => row.id !== item.id));
      } else {
        setToast(json?.message ?? "HTML Draft created in Gmail!");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate reminder.");
    } finally {
      setBusyItemId(null);
    }
  };

  const handleRunInvoiceScanner = async () => {
    setInvoiceScanBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/finance/invoice-scanner", {
        method: "POST",
        credentials: "include",
      });
      const json = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            error?: string;
            scannedMessages?: number;
            skippedAlreadyProcessed?: number;
            candidateMessages?: number;
            uploadsSucceeded?: number;
            uploadsFailed?: number;
          }
        | null;
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error ?? `Invoice scan failed (${response.status})`);
      }
      const skipped = json.skippedAlreadyProcessed ?? 0;
      setToast(
        `Invoice scan complete — ${json.uploadsSucceeded ?? 0} uploaded, ${json.uploadsFailed ?? 0} failed, ${skipped} skipped (already processed).`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invoice scan failed.");
    } finally {
      setInvoiceScanBusy(false);
    }
  };

  if (authLoading) {
    return (
      <main className="flex min-h-[50vh] items-center justify-center text-sm text-zinc-400">
        Checking access…
      </main>
    );
  }

  const trimmedBillingSearch = billingSearch.trim();

  return (
    <main className="min-h-[calc(100dvh-64px)] bg-zinc-950 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-400">Admin CRM</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">Billing & clients</h1>
            <p className="mt-2 max-w-2xl text-sm text-zinc-400">
              Manage unpaid invoices, client relationships, and team access from one place.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {isAdmin || canAccess("statistics") ? (
              <Link
                href="/admin/statistics"
                className="inline-flex h-10 items-center rounded-lg border border-zinc-700 bg-zinc-900 px-4 text-sm font-semibold text-zinc-100 hover:bg-zinc-800"
              >
                Analytics
              </Link>
            ) : null}
            <Link
              href="/"
              className="inline-flex h-10 items-center rounded-lg border border-zinc-700 bg-zinc-900 px-4 text-sm font-semibold text-zinc-100 hover:bg-zinc-800"
            >
              Back to workflow
            </Link>
          </div>
        </header>

        <nav className="flex flex-wrap gap-2 border-b border-zinc-800 pb-1">
          {TAB_ITEMS.filter((tab) => tab.id !== "users" || isAdmin).map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-t-lg px-4 py-2 text-sm font-semibold transition ${
                  isActive
                    ? "border border-b-0 border-zinc-700 bg-zinc-900 text-white"
                    : "text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        {error ? (
          <div className="rounded-xl border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        ) : null}

        {activeTab === "billing" ? (
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-white">Unpaid billing</h2>
                <p className="mt-1 text-sm text-zinc-400">
                  Open Lexoffice invoices plus local credit-note self-billing, sorted oldest first.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleRunInvoiceScanner()}
                  disabled={invoiceScanBusy || loading}
                  className="inline-flex h-10 items-center rounded-lg border border-emerald-600/50 bg-emerald-950/40 px-4 text-sm font-semibold text-emerald-100 hover:bg-emerald-900/50 disabled:opacity-50"
                  title="Scan Gmail for invoices/receipts from the last 7 days and upload to Lexoffice"
                >
                  {invoiceScanBusy ? "Scanning Gmail…" : "Scan Gmail → Lexoffice"}
                </button>
                <button
                  type="button"
                  onClick={() => void loadUnpaid()}
                  disabled={loading}
                  className="inline-flex h-10 items-center rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
                >
                  {loading ? "Refreshing…" : "Refresh"}
                </button>
              </div>
            </div>

            <div className="relative mb-4">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
                aria-hidden="true"
              />
              <input
                type="search"
                value={billingSearch}
                onChange={(event) => setBillingSearch(event.target.value)}
                placeholder="Search by client, company, or invoice number..."
                aria-label="Search unpaid invoices"
                className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-950 py-2 pl-10 pr-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-violet-500"
              />
            </div>

            <div className="overflow-x-auto rounded-xl border border-zinc-800">
              <table className="min-w-full divide-y divide-zinc-800 text-sm">
                <thead className="bg-zinc-950/70">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      Client
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      Document / Job
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      Date
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      Open amount
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      Paid
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-zinc-400">
                        Loading unpaid billing…
                      </td>
                    </tr>
                  ) : filteredItems.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
                        {trimmedBillingSearch
                          ? `No unpaid invoices found for "${trimmedBillingSearch}"`
                          : "No unpaid billing items found."}
                      </td>
                    </tr>
                  ) : (
                    filteredItems.map((item) => (
                      <tr key={item.id} className="hover:bg-zinc-950/40">
                        <td className="px-4 py-3 font-medium text-zinc-100">{item.clientName}</td>
                        <td className="px-4 py-3 text-zinc-300">
                          <div>{item.documentName}</div>
                          <div className="mt-0.5 text-xs text-zinc-500">
                            {item.type === "lexoffice" ? "Lexoffice invoice" : "Credit note"}
                            {item.linkedJobName ? ` · ${item.linkedJobName}` : ""}
                            {item.voucherStatus ? ` · ${item.voucherStatus}` : ""}
                            {item.clientEmail ? ` · ${item.clientEmail}` : " · No email on file"}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-zinc-300">{item.dateLabel}</td>
                        <td className="px-4 py-3 text-zinc-100">
                          {item.amount > 0 ? formatEuro(item.amount) : "—"}
                        </td>
                        <td className="px-4 py-3">
                          {item.type === "credit_note" && item.taskId ? (
                            <label className="inline-flex items-center gap-2 text-xs font-medium text-zinc-300">
                              <input
                                type="checkbox"
                                checked={false}
                                onChange={(event) => {
                                  if (!event.target.checked || !item.taskId) return;
                                  setCreditNoteUpload({
                                    taskId: item.taskId,
                                    label: `${item.clientName} · ${item.documentName}`,
                                  });
                                }}
                              />
                              Credit Note Paid
                            </label>
                          ) : (
                            <span className="text-xs text-zinc-600">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            disabled={busyItemId === item.id || !item.canSendReminder}
                            onClick={() => void handleGenerateReminder(item)}
                            className="inline-flex items-center rounded-lg border border-amber-500/50 bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-100 transition hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                            title={
                              item.canSendReminder
                                ? undefined
                                : item.type === "lexoffice"
                                  ? "Add a task email or Lexoffice contact email first"
                                  : "Add a client email on the task first"
                            }
                          >
                            {busyItemId === item.id ? "Creating draft…" : "Generate AI Reminder & Draft Email"}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {activeTab === "clients" ? (
          <ClientManagerSection
            active={activeTab === "clients"}
            onToast={setToast}
            onError={setError}
          />
        ) : null}

        {activeTab === "users" && isAdmin ? (
          <UserManagementSection
            active={activeTab === "users"}
            onToast={setToast}
            onError={setError}
          />
        ) : null}
      </div>

      {creditNoteUpload ? (
        <CreditNoteUploadModal
          open
          taskId={creditNoteUpload.taskId}
          taskLabel={creditNoteUpload.label}
          onClose={() => setCreditNoteUpload(null)}
          onSuccess={() => {
            const paidTaskId = creditNoteUpload.taskId;
            setCreditNoteUpload(null);
            setItems((prev) =>
              prev.filter(
                (row) => !(row.type === "credit_note" && row.taskId === paidTaskId)
              )
            );
            setToast("Credit note uploaded to Lexoffice and marked as paid.");
          }}
        />
      ) : null}

      {toast ? (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed bottom-6 left-1/2 z-[200] w-full max-w-md -translate-x-1/2 px-4"
        >
          <p className="rounded-xl border border-emerald-500/40 bg-emerald-950/95 px-5 py-3 text-center text-sm font-semibold text-emerald-100 shadow-2xl">
            {toast}
          </p>
        </div>
      ) : null}
    </main>
  );
}
