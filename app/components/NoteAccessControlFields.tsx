"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { NotebookAccessLevel } from "@/lib/server/notesSupabase";

export type NoteAccessRecipient = {
  id: string;
  email: string | null;
  full_name: string | null;
};

type NoteAccessControlFieldsProps = {
  accessLevel: NotebookAccessLevel;
  assignedUserIds: string[];
  recipients: NoteAccessRecipient[];
  isAdmin: boolean;
  onAccessLevelChange: (level: NotebookAccessLevel) => void;
  onToggleUser: (userId: string) => void;
  /** Compact styling for the inline note editor toolbar. */
  compact?: boolean;
  /** Place Access and Users controls side-by-side (note editor toolbar). */
  inline?: boolean;
};

function recipientLabel(user: NoteAccessRecipient) {
  return user.full_name?.trim() || user.email?.trim() || user.id;
}

function AssignedUsersDropdown({
  assignedUserIds,
  recipients,
  onToggleUser,
  compact,
}: {
  assignedUserIds: string[];
  recipients: NoteAccessRecipient[];
  onToggleUser: (userId: string) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const summary = useMemo(() => {
    if (assignedUserIds.length === 0) {
      return "Select users…";
    }
    if (assignedUserIds.length === 1) {
      const user = recipients.find((r) => r.id === assignedUserIds[0]);
      return user ? recipientLabel(user) : "1 user";
    }
    return `${assignedUserIds.length} users`;
  }, [assignedUserIds, recipients]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const triggerClass = compact
    ? "inline-flex min-w-[9rem] max-w-[180px] items-center justify-between gap-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-200 outline-none hover:bg-zinc-900"
    : "mt-1 inline-flex w-full items-center justify-between gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none hover:bg-zinc-800";

  return (
    <div ref={rootRef} className="relative">
      <label className={compact ? "flex items-center gap-1.5 text-[11px] text-zinc-500" : "block text-xs text-zinc-400"}>
        {compact ? "Users" : "Users"}
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className={triggerClass}
        >
          <span className="truncate">{summary}</span>
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 opacity-70 ${open ? "rotate-180" : ""}`} />
        </button>
      </label>
      {open ? (
        <div
          className={`absolute z-50 mt-1 max-h-48 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-950 p-2 shadow-xl ${
            compact ? "left-0 min-w-[12rem]" : "inset-x-0"
          }`}
          role="listbox"
          aria-multiselectable="true"
        >
          {recipients.length === 0 ? (
            <p className="px-1 py-2 text-xs text-zinc-500">No active users found.</p>
          ) : (
            <ul className="space-y-1">
              {recipients.map((user) => {
                const checked = assignedUserIds.includes(user.id);
                return (
                  <li key={user.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm text-zinc-200 hover:bg-zinc-800">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggleUser(user.id)}
                        className="rounded border-zinc-600"
                      />
                      <span className="truncate">{recipientLabel(user)}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {assignedUserIds.length === 0 ? (
            <p className="mt-2 px-1 text-[11px] text-amber-300/90">
              Select at least one user to save.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function NoteAccessControlFields({
  accessLevel,
  assignedUserIds,
  recipients,
  isAdmin,
  onAccessLevelChange,
  onToggleUser,
  compact = false,
  inline = false,
}: NoteAccessControlFieldsProps) {
  const selectClass = compact
    ? "rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-200 outline-none"
    : "mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none";

  const accessSelect = (
    <label
      className={
        compact
          ? "flex items-center gap-1.5 text-[11px] text-zinc-500"
          : "mt-3 block text-xs text-zinc-400"
      }
    >
      Access
      <select
        value={accessLevel}
        onChange={(event) => onAccessLevelChange(event.target.value as NotebookAccessLevel)}
        className={selectClass}
      >
        <option value="all">All Team</option>
        {isAdmin ? <option value="admin_only">Admin Only</option> : null}
        <option value="specific">Specific Users</option>
      </select>
    </label>
  );

  const usersDropdown =
    accessLevel === "specific" ? (
      <AssignedUsersDropdown
        assignedUserIds={assignedUserIds}
        recipients={recipients}
        onToggleUser={onToggleUser}
        compact={compact}
      />
    ) : null;

  if (compact && inline) {
    return (
      <>
        {accessSelect}
        {usersDropdown}
      </>
    );
  }

  if (compact) {
    return (
      <div className="flex w-full min-w-0 flex-col gap-1">
        {accessSelect}
        {usersDropdown}
      </div>
    );
  }

  // Notebook modal: stacked access + inline checklist panel
  const userList = accessLevel === "specific" ? (
    <div className="mt-3 max-h-40 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/60 p-2">
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
        Grant access to
      </p>
      {recipients.length === 0 ? (
        <p className="px-1 py-2 text-xs text-zinc-500">No active users found.</p>
      ) : (
        <ul className="space-y-1">
          {recipients.map((user) => {
            const checked = assignedUserIds.includes(user.id);
            return (
              <li key={user.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm text-zinc-200 hover:bg-zinc-800">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggleUser(user.id)}
                    className="rounded border-zinc-600"
                  />
                  <span className="truncate">{recipientLabel(user)}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {assignedUserIds.length === 0 ? (
        <p className="mt-2 px-1 text-[11px] text-amber-300/90">
          Select at least one user to save this access setting.
        </p>
      ) : null}
    </div>
  ) : null;

  return (
    <>
      {accessSelect}
      {userList}
    </>
  );
}
