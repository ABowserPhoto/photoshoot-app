"use server";

import { revalidatePath } from "next/cache";

import { getAdminAreaAuth } from "@/lib/server/getAdminAreaAuth";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";

type ArchiveActionResult =
  | { ok: true; userId: string; isArchived: boolean }
  | { ok: false; error: string };

/**
 * Long-lived Auth ban (~100 years). Used instead of deleting `auth.users`,
 * which could cascade into public historical rows (profiles, tasks, etc.).
 */
const ARCHIVE_BAN_DURATION = "876000h";

/**
 * Suspend or restore Email/Password login via Supabase Auth Admin API.
 *
 * Safety rules:
 * - Client is always created with `SUPABASE_SERVICE_ROLE_KEY` (admin privileges).
 * - Never call `auth.admin.deleteUser` — only ban / unban.
 * - Always leave `auth.users` and `public.profiles` rows intact.
 */
async function setAuthLoginSuspended(
  supabaseAdmin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  userId: string,
  suspend: boolean
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Explicitly refuse deletion paths — suspend only.
  const { data, error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    ban_duration: suspend ? ARCHIVE_BAN_DURATION : "none",
  });

  if (error) {
    console.error("[archiveUser] Auth Admin ban_duration update failed:", error.message, {
      userId,
      suspend,
    });
    return { ok: false, error: error.message };
  }

  if (!data.user) {
    return { ok: false, error: "Auth user not found while updating ban status." };
  }

  return { ok: true };
}

async function setUserArchivedState(
  userId: string,
  isArchived: boolean
): Promise<ArchiveActionResult> {
  const auth = await getAdminAreaAuth();
  if (!auth.authenticated || !auth.isAdmin) {
    return { ok: false, error: "Forbidden" };
  }

  const id = userId.trim();
  if (!id) {
    return { ok: false, error: "userId is required." };
  }

  if (auth.userId && auth.userId === id) {
    return { ok: false, error: "You cannot archive your own account." };
  }

  // Admin client: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY only.
  const supabaseAdmin = createSupabaseAdminClient();
  if (!supabaseAdmin) {
    return {
      ok: false,
      error: "Supabase admin client is not configured. Set SUPABASE_SERVICE_ROLE_KEY.",
    };
  }

  const { data: authLookup, error: authLookupError } =
    await supabaseAdmin.auth.admin.getUserById(id);
  if (authLookupError) {
    return { ok: false, error: authLookupError.message };
  }
  if (!authLookup.user) {
    return { ok: false, error: "User not found in Auth." };
  }

  // 1) Suspend / restore login first (ban only — never delete auth.users).
  const authSuspend = await setAuthLoginSuspended(supabaseAdmin, id, isArchived);
  if (!authSuspend.ok) {
    return {
      ok: false,
      error: `Could not ${isArchived ? "suspend" : "restore"} Auth login: ${authSuspend.error}`,
    };
  }

  // 2) Soft-flag the public profile (row kept for historical assignments / stats).
  const { data: existingProfile, error: profileLookupError } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (profileLookupError) {
    return { ok: false, error: profileLookupError.message };
  }

  if (!existingProfile) {
    const meta = (authLookup.user.user_metadata ?? {}) as Record<string, unknown>;
    const name = typeof meta.name === "string" ? meta.name.trim() : "";
    const role =
      typeof meta.role === "string" && meta.role.trim() ? meta.role.trim() : "editor";

    const { error: insertError } = await supabaseAdmin.from("profiles").upsert(
      {
        id,
        email: authLookup.user.email ?? null,
        full_name: name || null,
        role,
        is_archived: isArchived,
      },
      { onConflict: "id" }
    );
    if (insertError) {
      return { ok: false, error: insertError.message };
    }
  } else {
    const { error: updateError } = await supabaseAdmin
      .from("profiles")
      .update({ is_archived: isArchived })
      .eq("id", id);

    if (updateError) {
      return { ok: false, error: updateError.message };
    }
  }

  // 3) Best-effort: drop existing sessions after a successful ban.
  if (isArchived) {
    try {
      const adminAuth = supabaseAdmin.auth.admin as {
        signOut?: (
          uid: string,
          scope?: "global" | "local" | "others"
        ) => Promise<{ error: { message: string } | null }>;
      };
      if (typeof adminAuth.signOut === "function") {
        const { error: signOutError } = await adminAuth.signOut(id, "global");
        if (signOutError) {
          console.warn(
            "[archiveUser] Auth Admin signOut failed (ban still applied):",
            signOutError.message
          );
        }
      }
    } catch (e) {
      console.warn("[archiveUser] Auth Admin signOut threw (ban still applied):", e);
    }
  }

  revalidatePath("/admin/crm");
  revalidatePath("/planner");
  return { ok: true, userId: id, isArchived };
}

/**
 * Soft-delete an employee:
 * - Bans Email/Password login via Auth Admin `ban_duration` (service role).
 * - Sets `profiles.is_archived = true`.
 * - Does **not** delete `auth.users` or `public.profiles`.
 */
export async function archiveUser(userId: string): Promise<ArchiveActionResult> {
  return setUserArchivedState(userId, true);
}

/**
 * Restore a previously archived employee:
 * - Clears Auth ban (`ban_duration: 'none'`).
 * - Sets `profiles.is_archived = false`.
 */
export async function unarchiveUser(userId: string): Promise<ArchiveActionResult> {
  return setUserArchivedState(userId, false);
}
