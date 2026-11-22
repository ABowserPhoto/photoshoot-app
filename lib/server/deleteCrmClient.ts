import type { SupabaseClient } from "@supabase/supabase-js";

import {
  collectAccountRoles,
  decideClientLoginDeletion,
  isClientAccountRole,
  type ClientLoginDeletionInput,
  type ClientLoginDecision,
} from "@/lib/crmClientLoginDeletion";

const USER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ClientRow = {
  id: string;
  user_id: string | null;
};

type ProfileRow = {
  id: string;
  email: string | null;
  role: string | null;
  is_archived: boolean | null;
  jibble_employee_id: string | null;
  accessible_modules: unknown;
};

export type DeleteCrmClientResult =
  | {
      ok: true;
      clientDeleted: true;
      login: "removed" | "none" | "kept";
      loginDeleted: boolean;
      loginMessage: string | null;
    }
  | {
      ok: false;
      status: number;
      clientDeleted: boolean;
      loginDeleted: boolean;
      error: string;
    };

function failure(
  status: number,
  error: string,
  flags: { clientDeleted?: boolean; loginDeleted?: boolean } = {}
): DeleteCrmClientResult {
  return {
    ok: false,
    status,
    clientDeleted: flags.clientDeleted === true,
    loginDeleted: flags.loginDeleted === true,
    error,
  };
}

async function exactCount(
  query: PromiseLike<{ count: number | null; error: { message: string } | null }>
): Promise<number> {
  const { count, error } = await query;
  if (error) {
    throw new Error(error.message);
  }
  return count ?? 0;
}

async function loadLoginContext(
  supabase: SupabaseClient,
  clientId: string,
  linkedUserId: string,
  callerUserId: string | null
): Promise<ClientLoginDeletionInput> {
  const [
    profileRes,
    authRes,
    otherClients,
    taskEditor,
    studioColumn,
    studioJson,
    shifts,
    messagesSent,
    messagesReceived,
    notesCreated,
    notesAssigned,
    notebooksCreated,
    notebooksAssigned,
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, email, role, is_archived, jibble_employee_id, accessible_modules")
      .eq("id", linkedUserId)
      .maybeSingle(),
    supabase.auth.admin.getUserById(linkedUserId),
    exactCount(
      supabase
        .from("clients")
        .select("id", { count: "exact", head: true })
        .eq("user_id", linkedUserId)
        .neq("id", clientId)
    ),
    exactCount(supabase.from("tasks").select("id", { count: "exact", head: true }).eq("editor_id", linkedUserId)),
    exactCount(
      supabase
        .from("studio_tasks")
        .select("id", { count: "exact", head: true })
        .or(`editor_id.eq.${linkedUserId},assigned_to.eq.${linkedUserId}`)
    ),
    exactCount(
      supabase
        .from("studio_tasks")
        .select("id", { count: "exact", head: true })
        .contains("assigned_users", [{ id: linkedUserId }])
    ),
    exactCount(supabase.from("user_shifts").select("id", { count: "exact", head: true }).eq("user_id", linkedUserId)),
    exactCount(
      supabase.from("employee_messages").select("id", { count: "exact", head: true }).eq("sender_id", linkedUserId)
    ),
    exactCount(
      supabase.from("employee_messages").select("id", { count: "exact", head: true }).eq("recipient_id", linkedUserId)
    ),
    exactCount(supabase.from("notes").select("id", { count: "exact", head: true }).eq("creator_id", linkedUserId)),
    exactCount(
      supabase.from("notes").select("id", { count: "exact", head: true }).contains("assigned_user_ids", [linkedUserId])
    ),
    exactCount(supabase.from("notebooks").select("id", { count: "exact", head: true }).eq("creator_id", linkedUserId)),
    exactCount(
      supabase
        .from("notebooks")
        .select("id", { count: "exact", head: true })
        .contains("assigned_user_ids", [linkedUserId])
    ),
  ]);

  if (profileRes.error) {
    throw new Error(profileRes.error.message);
  }

  const profile = (profileRes.data as ProfileRow | null) ?? null;
  let authUser: ClientLoginDeletionInput["authUser"] = null;
  if (authRes.error) {
    const missing = /not found/i.test(authRes.error.message);
    if (!missing) {
      throw new Error(authRes.error.message);
    }
  } else if (authRes.data.user) {
    const user = authRes.data.user;
    authUser = {
      id: user.id,
      email: user.email,
      roles: collectAccountRoles(user.app_metadata, user.user_metadata),
    };
  }

  return {
    linkedUserId,
    callerUserId,
    otherClientLinks: otherClients,
    profile: profile
      ? {
          role: profile.role,
          email: profile.email,
          isArchived: profile.is_archived,
          jibbleEmployeeId: profile.jibble_employee_id,
          accessibleModules: profile.accessible_modules,
        }
      : null,
    authUser,
    staffUsage: {
      taskEditor,
      studioAssignment: studioColumn + studioJson,
      shifts,
      messages: messagesSent + messagesReceived,
      notes: notesCreated + notesAssigned + notebooksCreated + notebooksAssigned,
    },
  };
}

async function detachBookings(supabase: SupabaseClient, userId: string): Promise<string[] | { error: string }> {
  const { data, error } = await supabase.from("bookings").select("id").eq("user_id", userId);
  if (error) {
    return { error: error.message };
  }
  const ids = ((data ?? []) as Array<{ id: string }>).map((row) => row.id).filter(Boolean);
  if (ids.length === 0) {
    return [];
  }
  const { error: updateError } = await supabase.from("bookings").update({ user_id: null }).in("id", ids);
  if (updateError) {
    return { error: updateError.message };
  }
  return ids;
}

async function restoreBookings(supabase: SupabaseClient, userId: string, bookingIds: string[]): Promise<string | null> {
  if (bookingIds.length === 0) {
    return null;
  }
  const { error } = await supabase.from("bookings").update({ user_id: userId }).in("id", bookingIds);
  if (error) {
    return error.message;
  }
  return null;
}

function userIsGone(
  error: { message: string; status?: number } | null,
  user: { id: string } | null | undefined
): boolean {
  if (user) {
    return false;
  }
  if (!error) {
    return true;
  }
  return error.status === 404 || /not found/i.test(error.message);
}

async function removeLinkedLogin(
  supabase: SupabaseClient,
  userId: string
): Promise<{ ok: true } | { ok: false; loginDeleted: boolean; error: string }> {
  const detached = await detachBookings(supabase, userId);
  if (!Array.isArray(detached)) {
    return {
      ok: false,
      loginDeleted: false,
      error: `Bookings could not be detached, so the login was not removed: ${detached.error}`,
    };
  }

  let deleteError: { message: string } | null = null;
  try {
    const deleted = await supabase.auth.admin.deleteUser(userId, false);
    deleteError = deleted.error;
  } catch (err) {
    deleteError = { message: err instanceof Error ? err.message : "Auth deletion failed." };
  }
  if (deleteError) {
    const restoreError = await restoreBookings(supabase, userId, detached);
    const restoreNote = restoreError ? ` Booking links could not be restored: ${restoreError}` : "";
    return {
      ok: false,
      loginDeleted: false,
      error: `The Auth user could not be deleted: ${deleteError.message}.${restoreNote}`,
    };
  }

  let verified: { error: { message: string; status?: number } | null; data: { user: { id: string } | null } };
  try {
    verified = await supabase.auth.admin.getUserById(userId);
  } catch (err) {
    return {
      ok: false,
      loginDeleted: false,
      error: `Auth deletion could not be verified: ${err instanceof Error ? err.message : "Auth lookup failed."}`,
    };
  }
  if (!userIsGone(verified.error, verified.data?.user)) {
    return {
      ok: false,
      loginDeleted: false,
      error: verified.error
        ? `Auth deletion could not be verified: ${verified.error.message}`
        : "Auth deletion could not be verified: the user is still present.",
    };
  }

  const leftover = await supabase.from("profiles").select("id, role").eq("id", userId).maybeSingle();
  if (leftover.error) {
    return {
      ok: false,
      loginDeleted: true,
      error: `The Auth user was removed, but the profile could not be checked: ${leftover.error.message}`,
    };
  }
  if (leftover.data) {
    if (!isClientAccountRole((leftover.data as { role?: unknown }).role)) {
      return {
        ok: false,
        loginDeleted: true,
        error: "The Auth user was removed, but a non-client profile row is still present and was left in place.",
      };
    }
    const { data: removed, error: profileError } = await supabase
      .from("profiles")
      .delete()
      .eq("id", userId)
      .eq("role", "client")
      .select("id");
    if (profileError) {
      return {
        ok: false,
        loginDeleted: true,
        error: `The Auth user was removed, but the profile row could not be deleted: ${profileError.message}`,
      };
    }
    if (!removed || removed.length === 0) {
      return {
        ok: false,
        loginDeleted: true,
        error: "The Auth user was removed, but the client profile row is still present.",
      };
    }
  }

  return { ok: true };
}

async function removeClientProfile(
  supabase: SupabaseClient,
  userId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("profiles")
    .delete()
    .eq("id", userId)
    .eq("role", "client")
    .select("id");
  if (error) {
    return { ok: false, error: `The client profile could not be deleted: ${error.message}` };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "The client profile could not be deleted." };
  }
  return { ok: true };
}

async function deleteClientRow(
  supabase: SupabaseClient,
  clientId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from("clients").delete().eq("id", clientId);
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

function keptMessage(decision: Extract<ClientLoginDecision, { action: "keep" }>): string {
  return decision.reason;
}

/**
 * Deletes a CRM client. When the linked Auth user is that client's own login,
 * deletes the Auth user with the service-role admin API and the profiles row.
 * Historical tasks stay; their client_id is cleared by the existing foreign key.
 * Bookings are detached before the Auth user is removed.
 */
export async function deleteCrmClient(
  supabase: SupabaseClient,
  clientId: string,
  callerUserId: string | null
): Promise<DeleteCrmClientResult> {
  const id = clientId.trim();
  if (!USER_ID_RE.test(id)) {
    return failure(400, "id is required.");
  }

  const { data, error } = await supabase
    .from("clients")
    .select("id, user_id")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    return failure(400, error.message);
  }
  if (!data) {
    return failure(404, "Client not found.");
  }

  const client = data as ClientRow;
  const linkedUserId = client.user_id?.trim() ?? "";

  let decision: ClientLoginDecision = { action: "none" };
  if (linkedUserId) {
    if (!USER_ID_RE.test(linkedUserId)) {
      return failure(400, "This client is linked to an invalid user id, so nothing was deleted.");
    }
    try {
      decision = decideClientLoginDeletion(
        await loadLoginContext(supabase, id, linkedUserId, callerUserId)
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not verify the linked login.";
      return failure(400, `The client was not deleted because the linked login could not be verified: ${message}`);
    }
  }

  if (decision.action === "delete-login" || decision.action === "delete-profile-only") {
    try {
      decision = decideClientLoginDeletion(await loadLoginContext(supabase, id, linkedUserId, callerUserId));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not verify the linked login.";
      return failure(400, `The client was not deleted because the linked login could not be verified: ${message}`);
    }
  }

  let loginDeleted = false;
  let loginCleanupError: string | null = null;

  if (decision.action === "delete-login") {
    const removed = await removeLinkedLogin(supabase, linkedUserId);
    if (!removed.ok) {
      if (!removed.loginDeleted) {
        return failure(500, `The client was not deleted. ${removed.error}`);
      }
      loginDeleted = true;
      loginCleanupError = removed.error;
    } else {
      loginDeleted = true;
    }
  } else if (decision.action === "delete-profile-only") {
    const removed = await removeClientProfile(supabase, linkedUserId);
    if (!removed.ok) {
      return failure(500, `The client was not deleted. ${removed.error}`);
    }
    loginDeleted = true;
  }

  const clientDeleted = await deleteClientRow(supabase, id);
  if (!clientDeleted.ok) {
    return failure(
      500,
      loginDeleted
        ? `The website login was removed, but the client record could not be deleted: ${clientDeleted.error}`
        : clientDeleted.error,
      { loginDeleted }
    );
  }

  if (loginCleanupError) {
    return failure(500, `The client was deleted, but the login removal did not finish. ${loginCleanupError}`, {
      clientDeleted: true,
      loginDeleted: true,
    });
  }

  if (decision.action === "delete-login" || decision.action === "delete-profile-only") {
    return {
      ok: true,
      clientDeleted: true,
      login: "removed",
      loginDeleted: true,
      loginMessage: "Their website login and profile were removed.",
    };
  }
  if (decision.action === "keep") {
    return {
      ok: true,
      clientDeleted: true,
      login: "kept",
      loginDeleted: false,
      loginMessage: keptMessage(decision),
    };
  }
  return {
    ok: true,
    clientDeleted: true,
    login: "none",
    loginDeleted: false,
    loginMessage: null,
  };
}
