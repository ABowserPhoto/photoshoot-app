"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@supabase/supabase-js";

import { getAuthRole } from "@/lib/server/getAuthRole";
import {
  clearInstagramConnectionsForProfile,
  listInstagramConnectionsForProfile,
  removeInstagramConnectionForProfile,
  upsertInstagramConnectionsForProfile,
  type InstagramConnectionInput,
  type InstagramConnectionRecord,
} from "@/lib/server/instagramConnections";

export type MetaIgAccountOption = InstagramConnectionInput;

export type InstagramConnectedAccount = InstagramConnectionRecord & {
  isActive: boolean;
};

type ActionOk<T = void> = T extends void ? { ok: true } : { ok: true } & T;
type ActionErr = { ok: false; error: string };

function serviceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const key = serviceKey || anonKey;
  if (!url || !key) {
    return null;
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function getInstagramConnections(
  profileId: string
): Promise<ActionOk<{ accounts: InstagramConnectedAccount[] }> | ActionErr> {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return { ok: false, error: "Unauthorized" };
  }

  const pid = profileId.trim();
  if (!pid) {
    return { ok: false, error: "Missing profile id." };
  }

  const listed = await listInstagramConnectionsForProfile(pid);
  if (!listed.ok) {
    return listed;
  }

  if (listed.accounts.length === 0) {
    const supabase = serviceSupabase();
    if (supabase) {
      const { data: profileRow } = await supabase
        .from("social_profiles")
        .select("ig_account_id, access_token, handle")
        .eq("id", pid)
        .maybeSingle();

      const legacyIgId =
        typeof profileRow?.ig_account_id === "string" ? profileRow.ig_account_id.trim() : "";
      const legacyToken =
        typeof profileRow?.access_token === "string" ? profileRow.access_token.trim() : "";
      if (legacyIgId && legacyToken) {
        return {
          ok: true,
          accounts: [
            {
              id: legacyIgId,
              profileId: pid,
              igAccountId: legacyIgId,
              igUsername:
                typeof profileRow?.handle === "string" ? profileRow.handle.replace(/^@/, "") : null,
              pageName: null,
              accessToken: legacyToken,
              isActive: true,
            },
          ],
        };
      }
    }
  }

  return {
    ok: true,
    accounts: listed.accounts.map((account) => ({
      ...account,
      isActive: account.igAccountId === listed.activeIgAccountId,
    })),
  };
}

export async function saveInstagramConnection(
  profileId: string,
  igAccountId: string,
  accessToken: string
): Promise<ActionOk | ActionErr> {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return { ok: false, error: "Unauthorized" };
  }

  const pid = profileId.trim();
  const ig = igAccountId.trim();
  const token = accessToken.trim();
  if (!pid || !ig || !token) {
    return { ok: false, error: "Missing profile, Instagram account, or token." };
  }

  const result = await upsertInstagramConnectionsForProfile(pid, [
    {
      pageName: "Instagram",
      igUsername: null,
      igAccountId: ig,
      pageAccessToken: token,
    },
  ]);
  if (!result.ok) {
    return result;
  }

  revalidatePath("/scheduler");
  return { ok: true };
}

export async function saveAllInstagramConnections(
  profileId: string,
  accounts: MetaIgAccountOption[]
): Promise<ActionOk<{ count: number }> | ActionErr> {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return { ok: false, error: "Unauthorized" };
  }

  const pid = profileId.trim();
  if (!pid) {
    return { ok: false, error: "Missing profile id." };
  }

  const result = await upsertInstagramConnectionsForProfile(pid, accounts);
  if (!result.ok) {
    return result;
  }

  revalidatePath("/scheduler");
  return { ok: true, count: result.count };
}

export async function disconnectInstagramAccount(
  profileId: string,
  igAccountId: string
): Promise<ActionOk | ActionErr> {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return { ok: false, error: "Unauthorized" };
  }

  const pid = profileId.trim();
  const ig = igAccountId.trim();
  if (!pid || !ig) {
    return { ok: false, error: "Missing profile or Instagram account id." };
  }

  const result = await removeInstagramConnectionForProfile(pid, ig);
  if (!result.ok) {
    return result;
  }

  revalidatePath("/scheduler");
  return { ok: true };
}

export async function disconnectInstagram(profileId: string): Promise<ActionOk | ActionErr> {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return { ok: false, error: "Unauthorized" };
  }

  const pid = profileId.trim();
  if (!pid) {
    return { ok: false, error: "Missing profile id." };
  }

  const result = await clearInstagramConnectionsForProfile(pid);
  if (!result.ok) {
    return result;
  }

  revalidatePath("/scheduler");
  return { ok: true };
}

export async function disconnectTikTok(profileId: string): Promise<ActionOk | ActionErr> {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return { ok: false, error: "Unauthorized" };
  }

  const pid = profileId.trim();
  if (!pid) {
    return { ok: false, error: "Missing profile id." };
  }

  const supabase = serviceSupabase();
  if (!supabase) {
    return { ok: false, error: "Database is not configured." };
  }

  const { error } = await supabase
    .from("social_profiles")
    .update({
      tiktok_access_token: null,
      tiktok_refresh_token: null,
      tiktok_open_id: null,
    })
    .eq("id", pid);

  if (error) {
    console.error("[disconnectTikTok]", error);
    return { ok: false, error: error.message };
  }

  revalidatePath("/scheduler");
  return { ok: true };
}

export async function deleteClientProfile(profileId: string): Promise<ActionOk | ActionErr> {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return { ok: false, error: "Unauthorized" };
  }

  const pid = profileId.trim();
  if (!pid) {
    return { ok: false, error: "Missing profile id." };
  }

  const supabase = serviceSupabase();
  if (!supabase) {
    return { ok: false, error: "Database is not configured." };
  }

  const { error: postsErr } = await supabase.from("social_posts").delete().eq("profile_id", pid);
  if (postsErr) {
    console.error("[deleteClientProfile] social_posts", postsErr);
    return { ok: false, error: postsErr.message };
  }

  const { error: rulesErr } = await supabase.from("social_rules").delete().eq("profile_id", pid);
  if (rulesErr) {
    console.error("[deleteClientProfile] social_rules", rulesErr);
    return { ok: false, error: rulesErr.message };
  }

  const { error: profileErr } = await supabase.from("social_profiles").delete().eq("id", pid);
  if (profileErr) {
    console.error("[deleteClientProfile] social_profiles", profileErr);
    return { ok: false, error: profileErr.message };
  }

  revalidatePath("/scheduler");
  return { ok: true };
}
