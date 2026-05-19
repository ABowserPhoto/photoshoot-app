"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@supabase/supabase-js";

import { getAuthRole } from "@/lib/server/getAuthRole";

export type MetaIgAccountOption = {
  pageName: string;
  igUsername: string | null;
  igAccountId: string;
  pageAccessToken: string;
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

  const supabase = serviceSupabase();
  if (!supabase) {
    return { ok: false, error: "Database is not configured." };
  }

  const { error } = await supabase
    .from("social_profiles")
    .update({
      ig_account_id: ig,
      access_token: token,
    })
    .eq("id", pid);

  if (error) {
    console.error("[saveInstagramConnection]", error);
    return { ok: false, error: error.message };
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

  const supabase = serviceSupabase();
  if (!supabase) {
    return { ok: false, error: "Database is not configured." };
  }

  const { error } = await supabase
    .from("social_profiles")
    .update({
      ig_account_id: null,
      access_token: null,
    })
    .eq("id", pid);

  if (error) {
    console.error("[disconnectInstagram]", error);
    return { ok: false, error: error.message };
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
