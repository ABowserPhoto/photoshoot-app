"use client";

import { GitMerge, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import ReminderDraftedMarker from "@/app/admin/crm/ReminderDraftedMarker";
import PricingTierPicker from "@/app/admin/crm/PricingTierPicker";
import { approveClient } from "@/app/actions/approveClient";
import { formatEuro } from "@/lib/adminStatsFormat";
import { pricingTierLabel, type PricingTier } from "@/lib/pricingTiers";

export type ContactPerson = {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
};

export type CrmClient = {
  id: string;
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  billingAddress: string;
  lexofficeId: string;
  contactPersons: ContactPerson[];
  lifetimeRevenue: number;
  reminderDates?: string[];
  isApproved: boolean;
  hasLogin: boolean;
  pricingTier: PricingTier | null;
};

type ClientFormState = {
  id: string;
  company_name: string;
  contact_name: string;
  email: string;
  phone: string;
  billing_address: string;
  lexoffice_id: string;
  contact_persons: ContactPerson[];
  is_approved: boolean;
  pricing_tier: PricingTier | null;
};

const EMPTY_FORM: ClientFormState = {
  id: "",
  company_name: "",
  contact_name: "",
  email: "",
  phone: "",
  billing_address: "",
  lexoffice_id: "",
  contact_persons: [],
  is_approved: true,
  pricing_tier: null,
};

function pricingTierTone(tier: PricingTier): string {
  switch (tier) {
    case "standard":
      return "bg-violet-500/15 text-violet-200";
    case "legacy":
      return "bg-sky-500/15 text-sky-200";
    case "corporate":
      return "bg-emerald-500/15 text-emerald-200";
    default: {
      const exhaustive: never = tier;
      return exhaustive;
    }
  }
}

function PricingTierBadge({ client }: { client: CrmClient }) {
  if (!client.isApproved) {
    return <span className="text-xs text-zinc-500">—</span>;
  }
  if (!client.pricingTier) {
    return (
      <span className="inline-flex rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-200">
        No tier
      </span>
    );
  }

  const tone = pricingTierTone(client.pricingTier);

  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>
      {pricingTierLabel(client.pricingTier)}
    </span>
  );
}

function newContactPerson(): ContactPerson {
  return { id: crypto.randomUUID(), name: "", email: "", phone: "", role: "" };
}

type ClientManagerSectionProps = {
  active: boolean;
  onToast: (message: string) => void;
  onError: (message: string | null) => void;
};

export default function ClientManagerSection({ active, onToast, onError }: ClientManagerSectionProps) {
  const [clients, setClients] = useState<CrmClient[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<ClientFormState>(EMPTY_FORM);
  const [searchTerm, setSearchTerm] = useState("");
  const [isMergeModalOpen, setIsMergeModalOpen] = useState(false);
  const [selectedSourceClient, setSelectedSourceClient] = useState<CrmClient | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [merging, setMerging] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [clientPendingDelete, setClientPendingDelete] = useState<CrmClient | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [clientPendingApproval, setClientPendingApproval] = useState<CrmClient | null>(null);
  const [approvalTier, setApprovalTier] = useState<PricingTier | null>(null);
  const [tierEditClient, setTierEditClient] = useState<CrmClient | null>(null);
  const [tierDraft, setTierDraft] = useState<PricingTier | null>(null);
  const [savingTier, setSavingTier] = useState(false);

  const mergeTargetOptions = useMemo(() => {
    if (!selectedSourceClient) {
      return [];
    }
    return clients.filter((client) => client.id !== selectedSourceClient.id);
  }, [clients, selectedSourceClient]);

  const filteredClients = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    const matched = !query
      ? clients
      : clients.filter((client) => {
          const companyName = client.companyName.toLowerCase();
          const contactName = client.contactName.toLowerCase();
          const email = client.email.toLowerCase();
          return companyName.includes(query) || contactName.includes(query) || email.includes(query);
        });

    return [...matched].sort((a, b) => {
      if (a.isApproved !== b.isApproved) {
        return a.isApproved ? 1 : -1;
      }
      return a.companyName.localeCompare(b.companyName, "en");
    });
  }, [clients, searchTerm]);

  const pendingClients = useMemo(
    () => filteredClients.filter((client) => !client.isApproved),
    [filteredClients]
  );
  const pendingTotal = useMemo(
    () => clients.filter((client) => !client.isApproved).length,
    [clients]
  );

  const loadClients = useCallback(async () => {
    setLoading(true);
    onError(null);
    try {
      const response = await fetch("/api/admin/crm/clients", { cache: "no-store", credentials: "include" });
      const json = (await response.json().catch(() => null)) as
        | { ok?: boolean; clients?: CrmClient[]; error?: string }
        | null;
      if (!response.ok) {
        throw new Error(json?.error ?? `Failed to load clients (${response.status})`);
      }
      setClients(json?.clients ?? []);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to load clients.");
      setClients([]);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    if (!active) {
      return;
    }
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (!cancelled) {
        await loadClients();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, loadClients]);

  const handleSyncLexoffice = async () => {
    setSyncing(true);
    onError(null);
    try {
      const response = await fetch("/api/admin/crm/lexoffice-sync", {
        method: "POST",
        credentials: "include",
      });
      const json = (await response.json().catch(() => null)) as {
        ok?: boolean;
        synced?: number;
        errors?: string[];
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(json?.error ?? `Sync failed (${response.status})`);
      }
      const synced = json?.synced ?? 0;
      const errors = json?.errors ?? [];
      onToast(
        errors.length > 0
          ? `Synced ${synced} clients. ${errors.length} error(s): ${errors.slice(0, 2).join("; ")}`
          : `Synced ${synced} clients from Lexoffice.`
      );
      await loadClients();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to sync with Lexoffice.");
    } finally {
      setSyncing(false);
    }
  };

  const openCreateModal = () => {
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEditModal = (client: CrmClient) => {
    setForm({
      id: client.id,
      company_name: client.companyName,
      contact_name: client.contactName,
      email: client.email,
      phone: client.phone,
      billing_address: client.billingAddress,
      lexoffice_id: client.lexofficeId,
      contact_persons: client.contactPersons.length > 0 ? client.contactPersons : [],
      is_approved: client.isApproved,
      pricing_tier: client.pricingTier,
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) {
      return;
    }
    setModalOpen(false);
    setForm(EMPTY_FORM);
  };

  const updateContactPerson = (index: number, field: keyof ContactPerson, value: string) => {
    setForm((prev) => {
      const updated = prev.contact_persons.map((cp, i) =>
        i === index ? { ...cp, [field]: value } : cp
      );
      return { ...prev, contact_persons: updated };
    });
  };

  const addContactPerson = () => {
    setForm((prev) => ({
      ...prev,
      contact_persons: [...prev.contact_persons, newContactPerson()],
    }));
  };

  const removeContactPerson = (index: number) => {
    setForm((prev) => ({
      ...prev,
      contact_persons: prev.contact_persons.filter((_, i) => i !== index),
    }));
  };

  const handleSave = async () => {
    if (!form.company_name.trim()) {
      onError("Company name is required.");
      return;
    }
    if (form.id && form.is_approved) {
      const existing = clients.find((client) => client.id === form.id);
      if (existing && !existing.isApproved && !form.pricing_tier) {
        onError("Choose a pricing tier before approving this client.");
        return;
      }
    }

    setSaving(true);
    onError(null);
    try {
      const validPersons = form.contact_persons.filter((cp) => cp.name.trim() !== "");
      const response = await fetch("/api/admin/crm/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...(form.id ? { id: form.id } : {}),
          company_name: form.company_name.trim(),
          contact_name: form.contact_name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          billing_address: form.billing_address.trim(),
          lexoffice_id: form.lexoffice_id.trim(),
          contact_persons: validPersons,
          pricing_tier: form.pricing_tier,
          ...(form.id ? { is_approved: form.is_approved } : {}),
        }),
      });
      const json = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok) {
        throw new Error(json?.error ?? `Save failed (${response.status})`);
      }
      setModalOpen(false);
      setForm(EMPTY_FORM);
      onToast(form.id ? "Client updated." : "Client added.");
      await loadClients();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to save client.");
    } finally {
      setSaving(false);
    }
  };

  const closeDeleteModal = () => {
    if (deletingId) {
      return;
    }
    setClientPendingDelete(null);
    setDeleteError(null);
  };

  const handleDeleteClient = async () => {
    const client = clientPendingDelete;
    if (!client) {
      return;
    }

    setDeletingId(client.id);
    setDeleteError(null);
    onError(null);
    try {
      const response = await fetch("/api/admin/crm/clients", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id: client.id }),
      });
      const json = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        clientDeleted?: boolean;
        login?: "removed" | "none" | "kept";
        loginMessage?: string | null;
      } | null;
      if (!response.ok || json?.ok === false) {
        const message = json?.error ?? `Delete failed (${response.status})`;
        if (json?.clientDeleted) {
          setClientPendingDelete(null);
          setDeleteError(null);
          await loadClients();
        } else {
          setDeleteError(message);
        }
        onError(message);
        return;
      }
      setClientPendingDelete(null);
      setDeleteError(null);
      if (json?.login === "kept" && json.loginMessage) {
        onError(`Client deleted. ${json.loginMessage}`);
        onToast("Client deleted. The website login was kept.");
      } else if (json?.login === "removed") {
        onToast(
          json.loginMessage ? `Client deleted. ${json.loginMessage}` : "Client deleted. Their website login was removed."
        );
      } else {
        onToast("Client deleted.");
      }
      await loadClients();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete client.";
      setDeleteError(message);
      onError(message);
    } finally {
      setDeletingId(null);
    }
  };

  const openApprovalModal = (client: CrmClient) => {
    setApprovalTier(client.pricingTier);
    setClientPendingApproval(client);
  };

  const closeApprovalModal = () => {
    if (approvingId) {
      return;
    }
    setClientPendingApproval(null);
    setApprovalTier(null);
  };

  const handleApproveClient = async () => {
    const client = clientPendingApproval;
    if (!client || !approvalTier) {
      onError("Choose a pricing tier before approving this client.");
      return;
    }

    setApprovingId(client.id);
    onError(null);
    try {
      const result = await approveClient(client.id, approvalTier);
      if (!result.ok) {
        throw new Error(result.error);
      }
      if (result.lexofficeError) {
        onToast(
          `${client.companyName} is approved. Lexoffice sync failed and was logged: ${result.lexofficeError}`
        );
      } else if (result.lexofficeSynced) {
        onToast(`${client.companyName} approved and synced to Lexoffice.`);
      } else {
        onToast(`${client.companyName} approved.`);
      }
      setClientPendingApproval(null);
      setApprovalTier(null);
      await loadClients();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to approve client.");
    } finally {
      setApprovingId(null);
    }
  };

  const openTierModal = (client: CrmClient) => {
    setTierDraft(client.pricingTier);
    setTierEditClient(client);
  };

  const closeTierModal = () => {
    if (savingTier) {
      return;
    }
    setTierEditClient(null);
    setTierDraft(null);
  };

  const handleSaveTier = async () => {
    if (!tierEditClient || !tierDraft) {
      onError("Choose a pricing tier.");
      return;
    }

    setSavingTier(true);
    onError(null);
    try {
      const response = await fetch("/api/admin/crm/clients", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id: tierEditClient.id, pricing_tier: tierDraft }),
      });
      const json = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error ?? `Failed to update pricing tier (${response.status})`);
      }
      const savedTier = tierDraft;
      const savedId = tierEditClient.id;
      setClients((prev) =>
        prev.map((client) => (client.id === savedId ? { ...client, pricingTier: savedTier } : client))
      );
      setTierEditClient(null);
      setTierDraft(null);
      onToast("Pricing tier updated.");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to update pricing tier.");
    } finally {
      setSavingTier(false);
    }
  };

  const openMergeModal = (client: CrmClient) => {
    const otherClients = clients.filter((row) => row.id !== client.id);
    setSelectedSourceClient(client);
    setMergeTargetId(otherClients[0]?.id ?? "");
    setIsMergeModalOpen(true);
  };

  const closeMergeModal = () => {
    if (merging) {
      return;
    }
    setIsMergeModalOpen(false);
    setSelectedSourceClient(null);
    setMergeTargetId("");
  };

  const handleConfirmMerge = async () => {
    if (!selectedSourceClient) {
      onError("No source client selected.");
      return;
    }
    if (!mergeTargetId) {
      onError("Select a target client to merge into.");
      return;
    }

    setMerging(true);
    onError(null);
    try {
      const response = await fetch("/api/admin/crm/clients/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          sourceId: selectedSourceClient.id,
          targetId: mergeTargetId,
        }),
      });
      const json = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok) {
        throw new Error(json?.error ?? `Merge failed (${response.status})`);
      }

      setIsMergeModalOpen(false);
      setSelectedSourceClient(null);
      setMergeTargetId("");
      onToast("Clients merged successfully!");
      await loadClients();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to merge clients.");
    } finally {
      setMerging(false);
    }
  };

  return (
    <>
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Client manager</h2>
            <p className="mt-1 text-sm text-zinc-400">
              CRM profiles with lifetime revenue from paid or completed shoots.
              {pendingTotal > 0
                ? ` ${pendingTotal} waiting for approval.`
                : " No clients are waiting for approval."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleSyncLexoffice()}
              disabled={syncing || loading}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-950 px-4 text-sm font-semibold text-zinc-100 hover:bg-zinc-800 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} aria-hidden="true" />
              {syncing ? "Syncing…" : "Sync with Lexoffice"}
            </button>
            <button
              type="button"
              onClick={() => void loadClients()}
              disabled={loading}
              className="inline-flex h-10 items-center rounded-lg border border-zinc-700 bg-zinc-950 px-4 text-sm font-semibold text-zinc-100 hover:bg-zinc-800 disabled:opacity-50"
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex h-10 items-center rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-500"
            >
              Add Client
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
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search by company, contact, or email…"
            className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-950 py-2 pl-10 pr-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-violet-500"
          />
        </div>

        {pendingClients.length > 0 ? (
          <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-amber-100">Pending approval</h3>
              <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-200">
                {pendingClients.length}
              </span>
            </div>
            <ul className="space-y-2">
              {pendingClients.map((client) => (
                <li
                  key={client.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/20 bg-zinc-950/70 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-zinc-100">{client.companyName}</div>
                    <div className="truncate text-xs text-zinc-400">
                      {[client.contactName, client.email].filter(Boolean).join(" · ") || "No contact details"}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => openApprovalModal(client)}
                    disabled={approvingId === client.id}
                    className="inline-flex h-8 items-center rounded-lg bg-amber-500 px-3 text-xs font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
                  >
                    {approvingId === client.id ? "Approving…" : "Approve"}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="max-h-[600px] overflow-y-auto overflow-x-auto rounded-xl border border-zinc-800 pr-2">
          <table className="min-w-full divide-y divide-zinc-800 text-sm">
            <thead className="sticky top-0 z-10 bg-zinc-950/95 backdrop-blur-sm">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Company
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Pricing
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Contact(s)
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Email / Phone
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Lexoffice ID
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Lifetime revenue
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-zinc-400">
                    Loading clients…
                  </td>
                </tr>
              ) : clients.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-zinc-500">
                    No clients yet. Add your first client profile.
                  </td>
                </tr>
              ) : filteredClients.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-zinc-500">
                    No clients found matching &ldquo;{searchTerm.trim()}&rdquo;.
                  </td>
                </tr>
              ) : (
                filteredClients.map((client) => (
                  <tr
                    key={client.id}
                    className={client.isApproved ? "hover:bg-zinc-950/40" : "bg-amber-500/5 hover:bg-amber-500/10"}
                  >
                    <td className="px-4 py-3 font-medium text-zinc-100">
                      <span className="inline-flex items-center">
                        {client.companyName}
                        <ReminderDraftedMarker dates={client.reminderDates} />
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {client.isApproved ? (
                        <span className="inline-flex rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-300">
                          Approved
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-200">
                          Pending
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <PricingTierBadge client={client} />
                        {client.isApproved ? (
                          <button
                            type="button"
                            onClick={() => openTierModal(client)}
                            disabled={savingTier || deletingId === client.id}
                            className="inline-flex items-center rounded-lg border border-zinc-600 px-2 py-1 text-xs font-semibold text-zinc-200 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {client.pricingTier ? "Change" : "Assign"}
                          </button>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-zinc-300">
                      {client.contactPersons.length > 0 ? (
                        <ul className="space-y-0.5">
                          {client.contactPersons.map((cp) => (
                            <li key={cp.id} className="text-xs">
                              <span className="font-medium text-zinc-200">{cp.name}</span>
                              {cp.role ? (
                                <span className="ml-1 text-zinc-500">({cp.role})</span>
                              ) : null}
                              {cp.email ? (
                                <span className="ml-1 text-zinc-500">{cp.email}</span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-zinc-500">{client.contactName || "—"}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-300">
                      <div>{client.email || "—"}</div>
                      <div className="mt-0.5 text-xs text-zinc-500">{client.phone || "No phone"}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-400">{client.lexofficeId || "—"}</td>
                    <td className="px-4 py-3 font-medium text-zinc-100">{formatEuro(client.lifetimeRevenue)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-2">
                        {client.isApproved ? null : (
                          <button
                            type="button"
                            onClick={() => openApprovalModal(client)}
                            disabled={approvingId === client.id || deletingId === client.id}
                            className="inline-flex items-center rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {approvingId === client.id ? "Approving…" : "Approve"}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => openMergeModal(client)}
                          disabled={clients.length < 2 || deletingId === client.id}
                          title="Merge client"
                          className="inline-flex items-center rounded-lg border border-zinc-600 p-1.5 text-zinc-200 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <GitMerge className="h-4 w-4" aria-hidden="true" />
                          <span className="sr-only">Merge client</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteError(null);
                            setClientPendingDelete(client);
                          }}
                          disabled={deletingId === client.id}
                          title="Delete client"
                          className="inline-flex items-center rounded-lg border border-red-500/40 p-1.5 text-red-200 transition hover:bg-red-950/40 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                          <span className="sr-only">Delete client</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditModal(client)}
                          className="inline-flex items-center rounded-lg border border-zinc-600 px-3 py-1.5 text-xs font-semibold text-zinc-200 transition hover:bg-zinc-800"
                        >
                          Edit
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {modalOpen ? (
        <div className="fixed inset-0 z-[150] flex items-start justify-center overflow-y-auto bg-black/65 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="client-modal-title"
            className="my-8 w-full max-w-lg rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="client-modal-title" className="text-lg font-semibold text-white">
              {form.id ? "Edit client" : "Add client"}
            </h3>
            <p className="mt-1 text-sm text-zinc-400">Store billing contact details for your CRM.</p>

            <div className="mt-5 space-y-4">
              <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-400">
                Company name
                <input
                  value={form.company_name}
                  onChange={(event) => setForm((prev) => ({ ...prev, company_name: event.target.value }))}
                  className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500"
                />
              </label>
              <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-400">
                Primary contact (legacy)
                <input
                  value={form.contact_name}
                  onChange={(event) => setForm((prev) => ({ ...prev, contact_name: event.target.value }))}
                  className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500"
                />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  Email
                  <input
                    type="email"
                    value={form.email}
                    onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
                    className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500"
                  />
                </label>
                <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  Phone
                  <input
                    value={form.phone}
                    onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
                    className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500"
                  />
                </label>
              </div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-400">
                Billing address
                <textarea
                  value={form.billing_address}
                  onChange={(event) => setForm((prev) => ({ ...prev, billing_address: event.target.value }))}
                  rows={3}
                  className="mt-2 w-full resize-none rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500"
                />
              </label>
              <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-400">
                Lexoffice ID
                <input
                  value={form.lexoffice_id}
                  onChange={(event) => setForm((prev) => ({ ...prev, lexoffice_id: event.target.value }))}
                  className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500"
                />
              </label>

              <div>
                <span className="block text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  Pricing tier
                </span>
                <p className="mt-1 text-xs text-zinc-500">
                  Website booking prices follow this tier. No tier means the client sees no prices.
                </p>
                <div className="mt-2">
                  <PricingTierPicker
                    value={form.pricing_tier}
                    onChange={(pricingTier) => setForm((prev) => ({ ...prev, pricing_tier: pricingTier }))}
                    disabled={saving}
                  />
                </div>
              </div>

              {form.id ? (
                <div className="flex items-center justify-between gap-4 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-3">
                  <div>
                    <p className="text-sm font-medium text-zinc-100">Allow Online Booking</p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      Grants or revokes this client&apos;s website booking access.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={form.is_approved}
                    aria-label="Allow Online Booking"
                    onClick={() => setForm((prev) => ({ ...prev, is_approved: !prev.is_approved }))}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition ${
                      form.is_approved ? "bg-violet-600" : "bg-zinc-700"
                    }`}
                  >
                    <span
                      className={`pointer-events-none absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                        form.is_approved ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
              ) : null}

              {/* Contact persons */}
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                    Contact persons
                  </span>
                  <button
                    type="button"
                    onClick={addContactPerson}
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-600 px-2 py-1 text-xs font-semibold text-zinc-300 hover:bg-zinc-800"
                  >
                    <Plus className="h-3 w-3" aria-hidden="true" />
                    Add contact
                  </button>
                </div>

                {form.contact_persons.length === 0 ? (
                  <p className="mt-2 text-xs text-zinc-500">No contacts yet. Click &ldquo;Add contact&rdquo; to add one.</p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {form.contact_persons.map((cp, index) => (
                      <div
                        key={cp.id}
                        className="relative rounded-lg border border-zinc-700 bg-zinc-950 p-3"
                      >
                        <button
                          type="button"
                          onClick={() => removeContactPerson(index)}
                          className="absolute right-2 top-2 rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                          aria-label="Remove contact"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <div className="grid gap-2 pr-6 sm:grid-cols-2">
                          <input
                            placeholder="Full name *"
                            value={cp.name}
                            onChange={(e) => updateContactPerson(index, "name", e.target.value)}
                            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-violet-500 sm:col-span-2"
                          />
                          <input
                            placeholder="Email"
                            type="email"
                            value={cp.email}
                            onChange={(e) => updateContactPerson(index, "email", e.target.value)}
                            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-violet-500"
                          />
                          <input
                            placeholder="Phone"
                            value={cp.phone}
                            onChange={(e) => updateContactPerson(index, "phone", e.target.value)}
                            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-violet-500"
                          />
                          <input
                            placeholder="Role (e.g. CEO, PM)"
                            value={cp.role}
                            onChange={(e) => updateContactPerson(index, "role", e.target.value)}
                            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-violet-500 sm:col-span-2"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeModal}
                disabled={saving}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving}
                className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {clientPendingDelete ? (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-client-modal-title"
            className="w-full max-w-lg rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="delete-client-modal-title" className="text-lg font-semibold text-white">
              Delete client
            </h3>
            <p className="mt-3 text-sm text-zinc-300">
              Delete <span className="font-semibold text-white">{clientPendingDelete.companyName}</span>?
            </p>
            <p className="mt-3 text-sm text-zinc-300">
              {clientPendingDelete.hasLogin
                ? "Their website login and profile will also be removed when that login belongs only to this client, so the email can be used to sign up again. Staff, admin, owner, and team logins are never removed, including when a client record uses the same email."
                : "No website login is linked to this client. Only the CRM record will be removed."}
            </p>
            <p className="mt-3 text-xs text-zinc-500">
              Tasks and bookings stay in the archive. Tasks linked to this client will lose their connection.
            </p>
            {deleteError ? <p className="mt-3 text-sm text-red-300">{deleteError}</p> : null}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeDeleteModal}
                disabled={deletingId === clientPendingDelete.id}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteClient()}
                disabled={deletingId === clientPendingDelete.id}
                className="rounded-lg border border-red-500/40 bg-red-950/40 px-4 py-2 text-sm font-semibold text-red-100 transition hover:bg-red-950/70 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deletingId === clientPendingDelete.id ? "Deleting…" : "Delete client"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {clientPendingApproval ? (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="approve-client-modal-title"
            className="w-full max-w-lg rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="approve-client-modal-title" className="text-lg font-semibold text-white">
              Approve client
            </h3>
            <p className="mt-3 text-sm text-zinc-300">
              Approve <span className="font-semibold text-white">{clientPendingApproval.companyName}</span> and choose
              the prices they see on the website.
            </p>
            <div className="mt-5">
              <span className="block text-xs font-semibold uppercase tracking-wide text-zinc-400">Pricing tier</span>
              <div className="mt-2">
                <PricingTierPicker
                  value={approvalTier}
                  onChange={setApprovalTier}
                  disabled={approvingId === clientPendingApproval.id}
                />
              </div>
            </div>
            <p className="mt-3 text-xs text-zinc-500">
              Standard, Legacy, and Corporate use different price lists. A client with no tier sees no prices.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeApprovalModal}
                disabled={approvingId === clientPendingApproval.id}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleApproveClient()}
                disabled={!approvalTier || approvingId === clientPendingApproval.id}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {approvingId === clientPendingApproval.id ? "Approving…" : "Approve"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {tierEditClient ? (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="pricing-tier-modal-title"
            className="w-full max-w-lg rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="pricing-tier-modal-title" className="text-lg font-semibold text-white">
              Pricing tier
            </h3>
            <p className="mt-3 text-sm text-zinc-300">
              Set the tier for <span className="font-semibold text-white">{tierEditClient.companyName}</span>.
            </p>
            <div className="mt-5">
              <PricingTierPicker value={tierDraft} onChange={setTierDraft} disabled={savingTier} />
            </div>
            {!tierEditClient.pricingTier ? (
              <p className="mt-3 text-xs font-semibold text-amber-200">No tier — this client currently sees no prices.</p>
            ) : (
              <p className="mt-3 text-xs text-zinc-500">
                Current tier: {pricingTierLabel(tierEditClient.pricingTier)}. Website booking prices update immediately.
              </p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeTierModal}
                disabled={savingTier}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSaveTier()}
                disabled={savingTier || !tierDraft}
                className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
              >
                {savingTier ? "Saving…" : "Save tier"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isMergeModalOpen && selectedSourceClient ? (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="merge-client-modal-title"
            className="w-full max-w-lg rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="merge-client-modal-title" className="text-lg font-semibold text-white">
              Merge clients
            </h3>
            <p className="mt-3 text-sm text-zinc-300">
              Merge <span className="font-semibold text-white">{selectedSourceClient.companyName}</span> into…
            </p>

            <label className="mt-5 block text-xs font-semibold uppercase tracking-wide text-zinc-400">
              Target client
              <select
                value={mergeTargetId}
                onChange={(event) => setMergeTargetId(event.target.value)}
                className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500"
              >
                {mergeTargetOptions.length === 0 ? (
                  <option value="">No other clients available</option>
                ) : (
                  mergeTargetOptions.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.companyName}
                    </option>
                  ))
                )}
              </select>
            </label>

            <p className="mt-3 text-xs text-zinc-500">
              Linked Kanban tasks will move to the target client and use its company name for billing totals.
            </p>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeMergeModal}
                disabled={merging}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmMerge()}
                disabled={merging || !mergeTargetId}
                className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
              >
                {merging ? "Merging…" : "Confirm Merge"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
