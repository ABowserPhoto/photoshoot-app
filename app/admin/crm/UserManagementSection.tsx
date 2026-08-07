"use client";

import { Archive, ArchiveRestore, Key, Link2, Loader2, Unlink } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { archiveUser, unarchiveUser } from "@/app/actions/users";

export type CrmUser = {
  id: string;
  name: string;
  email: string;
  createdAt: string | null;
  createdAtLabel: string;
  role: string;
  roleKey: "admin" | "staff";
  jibblePersonId: string | null;
  isArchived: boolean;
};

type JibblePerson = {
  id: string;
  name: string;
};

type UserFormState = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "staff";
  password: string;
};

const EMPTY_FORM: UserFormState = {
  id: "",
  name: "",
  email: "",
  role: "staff",
  password: "",
};

const PASSWORD_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*";

function generateSecurePassword(length = 12): string {
  const values = new Uint32Array(length);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => PASSWORD_CHARSET[value % PASSWORD_CHARSET.length]).join("");
}

type UserManagementSectionProps = {
  active: boolean;
  onToast: (message: string) => void;
  onError: (message: string | null) => void;
};

export default function UserManagementSection({ active, onToast, onError }: UserManagementSectionProps) {
  const [users, setUsers] = useState<CrmUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [form, setForm] = useState<UserFormState>(EMPTY_FORM);
  const [isResetPasswordModalOpen, setIsResetPasswordModalOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedUserName, setSelectedUserName] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resettingPassword, setResettingPassword] = useState(false);

  // Jibble linking state
  const [jibblePeople, setJibblePeople] = useState<JibblePerson[]>([]);
  const [jibbleLoading, setJibbleLoading] = useState(false);
  const [jibbleLinkingUserId, setJibbleLinkingUserId] = useState<string | null>(null);
  const [jibbleSaving, setJibbleSaving] = useState<string | null>(null); // userId being saved
  const [jibbleDropdownUserId, setJibbleDropdownUserId] = useState<string | null>(null);
  const [archivingUserId, setArchivingUserId] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    onError(null);
    try {
      const response = await fetch("/api/admin/crm/users", { cache: "no-store", credentials: "include" });
      const json = (await response.json().catch(() => null)) as
        | { ok?: boolean; users?: CrmUser[]; error?: string }
        | null;
      if (!response.ok) {
        throw new Error(json?.error ?? `Failed to load users (${response.status})`);
      }
      setUsers(
        (json?.users ?? []).map((user) => ({
          ...user,
          isArchived: Boolean(user.isArchived),
        }))
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to load users.");
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    if (active) {
      void loadUsers();
    }
  }, [active, loadUsers]);

  // Close Jibble dropdown when clicking outside.
  useEffect(() => {
    if (!jibbleDropdownUserId) return;
    function handleClick(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setJibbleDropdownUserId(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [jibbleDropdownUserId]);

  const openCreateModal = () => {
    setIsEditMode(false);
    setForm({ ...EMPTY_FORM, password: generateSecurePassword() });
    setModalOpen(true);
  };

  const openEditModal = (user: CrmUser) => {
    setIsEditMode(true);
    setForm({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.roleKey,
      password: "",
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
    setIsEditMode(false);
    setForm(EMPTY_FORM);
  };

  const handleGeneratePassword = () => {
    setForm((prev) => ({ ...prev, password: generateSecurePassword() }));
  };

  const openResetPasswordModal = (user: CrmUser) => {
    setSelectedUserId(user.id);
    setSelectedUserName(user.name.trim() || user.email || "this user");
    setResetPassword(generateSecurePassword());
    setIsResetPasswordModalOpen(true);
  };

  const closeResetPasswordModal = () => {
    if (resettingPassword) return;
    setIsResetPasswordModalOpen(false);
    setSelectedUserId("");
    setSelectedUserName("");
    setResetPassword("");
  };

  const handleGenerateResetPassword = () => {
    setResetPassword(generateSecurePassword());
  };

  const handleConfirmResetPassword = async () => {
    if (!selectedUserId) {
      onError("No user selected for password reset.");
      return;
    }
    if (!resetPassword.trim()) {
      onError("Generate a password before confirming the reset.");
      return;
    }

    setResettingPassword(true);
    onError(null);
    try {
      const response = await fetch("/api/admin/crm/users/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ userId: selectedUserId, newPassword: resetPassword }),
      });
      const json = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok) {
        throw new Error(json?.error ?? `Password reset failed (${response.status})`);
      }

      setIsResetPasswordModalOpen(false);
      setSelectedUserId("");
      setSelectedUserName("");
      setResetPassword("");
      onToast("Password reset successful! Ensure you copied the new password.");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to reset password.");
    } finally {
      setResettingPassword(false);
    }
  };

  const handleSubmit = async () => {
    if (!form.email.trim()) {
      onError("Email is required.");
      return;
    }
    if (!isEditMode && !form.password.trim()) {
      onError("Generate a password before creating the user.");
      return;
    }

    setSaving(true);
    onError(null);
    try {
      const response = await fetch("/api/admin/crm/users", {
        method: isEditMode ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(
          isEditMode
            ? { id: form.id, name: form.name.trim(), email: form.email.trim(), role: form.role }
            : { name: form.name.trim(), email: form.email.trim(), password: form.password, role: form.role }
        ),
      });
      const json = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok) {
        throw new Error(json?.error ?? `${isEditMode ? "Update" : "Create"} user failed (${response.status})`);
      }

      setModalOpen(false);
      setIsEditMode(false);
      setForm(EMPTY_FORM);
      onToast(
        isEditMode
          ? "User updated successfully!"
          : "User created successfully! Make sure to copy the password."
      );
      await loadUsers();
    } catch (err) {
      onError(err instanceof Error ? err.message : `Failed to ${isEditMode ? "update" : "create"} user.`);
    } finally {
      setSaving(false);
    }
  };

  // ── Jibble linking ───────────────────────────────────────────────────────────

  const fetchJibblePeople = async (): Promise<JibblePerson[]> => {
    if (jibblePeople.length > 0) return jibblePeople;
    setJibbleLoading(true);
    try {
      const response = await fetch("/api/jibble/users", { credentials: "include" });
      const json = (await response.json().catch(() => null)) as
        | { ok?: boolean; people?: JibblePerson[]; error?: string }
        | null;
      if (!response.ok) throw new Error(json?.error ?? "Failed to load Jibble users.");
      const people = json?.people ?? [];
      setJibblePeople(people);
      return people;
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to load Jibble users.");
      return [];
    } finally {
      setJibbleLoading(false);
    }
  };

  const handleOpenJibbleDropdown = async (userId: string) => {
    setJibbleLinkingUserId(userId);
    setJibbleDropdownUserId(userId);
    await fetchJibblePeople();
    setJibbleLinkingUserId(null);
  };

  const handleSelectJibblePerson = async (userId: string, jibblePersonId: string | null) => {
    setJibbleDropdownUserId(null);
    setJibbleSaving(userId);
    try {
      const response = await fetch("/api/admin/crm/users/link-jibble", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ userId, jibblePersonId }),
      });
      const json = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok) throw new Error(json?.error ?? "Failed to link Jibble account.");

      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, jibblePersonId: jibblePersonId ?? null } : u))
      );
      onToast(
        jibblePersonId
          ? "Jibble account linked successfully!"
          : "Jibble account unlinked."
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to link Jibble account.");
    } finally {
      setJibbleSaving(null);
    }
  };

  const handleToggleArchive = async (user: CrmUser) => {
    const label = user.name || user.email || "this user";
    if (user.isArchived) {
      if (!window.confirm(`Unarchive ${label}? They will regain login access and appear in assignee lists again.`)) {
        return;
      }
    } else if (
      !window.confirm(
        `Archive ${label}? Their history stays intact, but they will lose login access and disappear from active assignee lists.`
      )
    ) {
      return;
    }

    setArchivingUserId(user.id);
    onError(null);
    try {
      const result = user.isArchived
        ? await unarchiveUser(user.id)
        : await archiveUser(user.id);
      if (!result.ok) {
        throw new Error(result.error);
      }
      setUsers((prev) =>
        prev
          .map((u) => (u.id === user.id ? { ...u, isArchived: result.isArchived } : u))
          .sort((a, b) => {
            if (a.isArchived !== b.isArchived) {
              return a.isArchived ? 1 : -1;
            }
            return a.email.localeCompare(b.email, "en");
          })
      );
      onToast(result.isArchived ? `${label} archived.` : `${label} restored.`);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to update archive status.");
    } finally {
      setArchivingUserId(null);
    }
  };

  return (
    <>
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">User management</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Create accounts, assign roles, link Jibble profiles, and archive former employees without deleting history.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void loadUsers()}
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
              Add User
            </button>
          </div>
        </div>

        <div className="max-h-[600px] overflow-y-auto overflow-x-auto rounded-xl border border-zinc-800 pr-2">
          <table className="min-w-full divide-y divide-zinc-800 text-sm">
            <thead className="sticky top-0 z-10 bg-zinc-950/95 backdrop-blur-sm">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Email
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Role
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Created
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Jibble
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
                    Loading users…
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
                    No users found yet.
                  </td>
                </tr>
              ) : (
                users.map((user) => {
                  const linkedPerson = jibblePeople.find((p) => p.id === user.jibblePersonId);
                  const isLinkingThis = jibbleLinkingUserId === user.id;
                  const isSavingThis = jibbleSaving === user.id;
                  const isDropdownOpenFor = jibbleDropdownUserId === user.id;

                  return (
                    <tr
                      key={user.id}
                      className={`hover:bg-zinc-950/40 ${user.isArchived ? "opacity-70" : ""}`}
                    >
                      <td className="px-4 py-3 font-medium text-zinc-100">
                        <span className="inline-flex flex-wrap items-center gap-2">
                          {user.name || "—"}
                          {user.isArchived ? (
                            <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-300 ring-1 ring-zinc-600">
                              Archived
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-zinc-300">{user.email || "—"}</td>
                      <td className="px-4 py-3 text-zinc-300">{user.role}</td>
                      <td className="px-4 py-3 text-zinc-300">{user.createdAtLabel}</td>

                      {/* Jibble cell */}
                      <td className="relative px-4 py-3">
                        <div className="flex items-center gap-2">
                          {user.jibblePersonId ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-900/50 px-2.5 py-0.5 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-700/50">
                              <Link2 className="h-3 w-3" aria-hidden="true" />
                              {linkedPerson?.name ?? user.jibblePersonId.slice(0, 8) + "…"}
                            </span>
                          ) : (
                            <span className="text-xs text-zinc-600 italic">Not linked</span>
                          )}

                          <div className="relative" ref={isDropdownOpenFor ? dropdownRef : undefined}>
                            <button
                              type="button"
                              disabled={isLinkingThis || isSavingThis}
                              onClick={() => void handleOpenJibbleDropdown(user.id)}
                              title={user.jibblePersonId ? "Change Jibble link" : "Link Jibble account"}
                              className="inline-flex items-center rounded-lg border border-zinc-600 p-1.5 text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-50"
                            >
                              {isLinkingThis || isSavingThis ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                              ) : (
                                <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                              )}
                              <span className="sr-only">Link Jibble</span>
                            </button>

                            {isDropdownOpenFor && !jibbleLoading && (
                              <div className="absolute left-0 top-full z-50 mt-1 min-w-[220px] rounded-xl border border-zinc-700 bg-zinc-900 py-1 shadow-2xl">
                                {jibblePeople.length === 0 ? (
                                  <p className="px-3 py-2 text-xs text-zinc-400">
                                    No Jibble users found.
                                  </p>
                                ) : (
                                  <>
                                    {user.jibblePersonId && (
                                      <button
                                        type="button"
                                        onClick={() => void handleSelectJibblePerson(user.id, null)}
                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-red-400 hover:bg-zinc-800"
                                      >
                                        <Unlink className="h-3 w-3 shrink-0" aria-hidden="true" />
                                        Unlink Jibble
                                      </button>
                                    )}
                                    <div className="max-h-64 overflow-y-auto">
                                      {jibblePeople.map((person) => (
                                        <button
                                          key={person.id}
                                          type="button"
                                          onClick={() =>
                                            void handleSelectJibblePerson(user.id, person.id)
                                          }
                                          className={`flex w-full items-start gap-2 px-3 py-2 text-left text-xs hover:bg-zinc-800 ${
                                            person.id === user.jibblePersonId
                                              ? "bg-violet-900/30 text-violet-300"
                                              : "text-zinc-200"
                                          }`}
                                        >
                                          <span className="min-w-0 flex-1 truncate">{person.name}</span>
                                          <span className="shrink-0 font-mono text-[10px] text-zinc-500">
                                            {person.id.slice(0, 8)}…
                                          </span>
                                        </button>
                                      ))}
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Actions cell */}
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-2">
                          {!user.isArchived ? (
                            <button
                              type="button"
                              onClick={() => openResetPasswordModal(user)}
                              title="Reset Password"
                              className="inline-flex items-center rounded-lg border border-zinc-600 p-1.5 text-zinc-200 transition hover:bg-zinc-800"
                            >
                              <Key className="h-4 w-4" aria-hidden="true" />
                              <span className="sr-only">Reset Password</span>
                            </button>
                          ) : null}
                          {!user.isArchived ? (
                            <button
                              type="button"
                              onClick={() => openEditModal(user)}
                              className="inline-flex items-center rounded-lg border border-zinc-600 px-3 py-1.5 text-xs font-semibold text-zinc-200 transition hover:bg-zinc-800"
                            >
                              Edit
                            </button>
                          ) : null}
                          <button
                            type="button"
                            disabled={archivingUserId === user.id}
                            onClick={() => void handleToggleArchive(user)}
                            title={user.isArchived ? "Unarchive user" : "Archive user"}
                            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
                              user.isArchived
                                ? "border-emerald-700/60 bg-emerald-950/40 text-emerald-200 hover:bg-emerald-900/40"
                                : "border-amber-700/60 bg-amber-950/30 text-amber-100 hover:bg-amber-900/40"
                            }`}
                          >
                            {archivingUserId === user.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                            ) : user.isArchived ? (
                              <ArchiveRestore className="h-3.5 w-3.5" aria-hidden="true" />
                            ) : (
                              <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                            {user.isArchived ? "Unarchive" : "Archive"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {modalOpen ? (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="user-modal-title"
            className="w-full max-w-lg rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="user-modal-title" className="text-lg font-semibold text-white">
              {isEditMode ? "Edit user" : "Add user"}
            </h3>
            <p className="mt-1 text-sm text-zinc-400">
              {isEditMode
                ? "Update this team member's profile details."
                : "The account is confirmed immediately. Copy the generated password for the employee."}
            </p>

            <div className="mt-5 space-y-4">
              <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-400">
                Name
                <input
                  value={form.name}
                  onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                  className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500"
                />
              </label>

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
                Role
                <select
                  value={form.role}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      role: event.target.value === "admin" ? "admin" : "staff",
                    }))
                  }
                  className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500"
                >
                  <option value="admin">Admin</option>
                  <option value="staff">Staff</option>
                </select>
              </label>

              {!isEditMode ? (
                <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  Password
                  <div className="mt-2 flex gap-2">
                    <input
                      readOnly
                      value={form.password}
                      className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-violet-500"
                    />
                    <button
                      type="button"
                      onClick={handleGeneratePassword}
                      className="shrink-0 rounded-lg border border-zinc-600 px-3 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-800"
                    >
                      Generate Password
                    </button>
                  </div>
                </label>
              ) : null}
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
                onClick={() => void handleSubmit()}
                disabled={saving}
                className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
              >
                {saving ? (isEditMode ? "Updating…" : "Creating…") : isEditMode ? "Update User" : "Create User"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isResetPasswordModalOpen ? (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-password-modal-title"
            className="w-full max-w-lg rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="reset-password-modal-title" className="text-lg font-semibold text-white">
              Reset password
            </h3>
            <p className="mt-3 text-sm text-amber-100/90">
              You are generating a new temporary password for {selectedUserName}.
            </p>

            <label className="mt-5 block text-xs font-semibold uppercase tracking-wide text-zinc-400">
              Password
              <div className="mt-2 flex gap-2">
                <input
                  readOnly
                  value={resetPassword}
                  className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-violet-500"
                />
                <button
                  type="button"
                  onClick={handleGenerateResetPassword}
                  className="shrink-0 rounded-lg border border-zinc-600 px-3 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-800"
                >
                  Generate Password
                </button>
              </div>
            </label>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeResetPasswordModal}
                disabled={resettingPassword}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmResetPassword()}
                disabled={resettingPassword}
                className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
              >
                {resettingPassword ? "Resetting…" : "Confirm Reset"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
