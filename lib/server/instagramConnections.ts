import { createClient } from "@supabase/supabase-js";

export type InstagramConnectionInput = {
  pageName: string;
  igUsername: string | null;
  igAccountId: string;
  pageAccessToken: string;
};

export type InstagramConnectionRecord = {
  id: string;
  profileId: string;
  igAccountId: string;
  igUsername: string | null;
  pageName: string | null;
  accessToken: string;
};

type Ok<T extends Record<string, unknown> = Record<string, unknown>> = { ok: true } & T;
type Err = { ok: false; error: string };

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

function normalizeConnectionRow(row: Record<string, unknown>): InstagramConnectionRecord {
  return {
    id: String(row.id),
    profileId: String(row.profile_id),
    igAccountId: String(row.ig_account_id),
    igUsername: typeof row.ig_username === "string" ? row.ig_username : null,
    pageName: typeof row.page_name === "string" ? row.page_name : null,
    accessToken: String(row.access_token ?? ""),
  };
}

export async function upsertInstagramConnectionsForProfile(
  profileId: string,
  accounts: InstagramConnectionInput[]
): Promise<Ok<{ count: number }> | Err> {
  const pid = profileId.trim();
  if (!pid) {
    return { ok: false, error: "Missing profile id." };
  }

  const validAccounts = accounts.filter(
    (account) => account.igAccountId.trim() && account.pageAccessToken.trim()
  );
  if (validAccounts.length === 0) {
    return { ok: false, error: "No valid Instagram accounts to save." };
  }

  const supabase = serviceSupabase();
  if (!supabase) {
    return { ok: false, error: "Database is not configured." };
  }

  const now = new Date().toISOString();
  for (const account of validAccounts) {
    const { error } = await supabase.from("instagram_connected_accounts").upsert(
      {
        profile_id: pid,
        ig_account_id: account.igAccountId.trim(),
        ig_username: account.igUsername?.trim() || null,
        page_name: account.pageName?.trim() || null,
        access_token: account.pageAccessToken.trim(),
        updated_at: now,
      },
      { onConflict: "profile_id,ig_account_id" }
    );

    if (error) {
      console.error("[upsertInstagramConnectionsForProfile]", error);
      return { ok: false, error: error.message };
    }
  }

  const { data: profileRow, error: profileReadErr } = await supabase
    .from("social_profiles")
    .select("ig_account_id")
    .eq("id", pid)
    .maybeSingle();

  if (profileReadErr) {
    console.error("[upsertInstagramConnectionsForProfile] profile read", profileReadErr);
    return { ok: false, error: profileReadErr.message };
  }

  const currentActiveId =
    typeof profileRow?.ig_account_id === "string" ? profileRow.ig_account_id.trim() : "";
  const refreshedActive = validAccounts.find((account) => account.igAccountId.trim() === currentActiveId);
  const primary = refreshedActive ?? validAccounts[0];

  const { error: profileUpdateErr } = await supabase
    .from("social_profiles")
    .update({
      ig_account_id: primary.igAccountId.trim(),
      access_token: primary.pageAccessToken.trim(),
    })
    .eq("id", pid);

  if (profileUpdateErr) {
    console.error("[upsertInstagramConnectionsForProfile] profile update", profileUpdateErr);
    return { ok: false, error: profileUpdateErr.message };
  }

  return { ok: true, count: validAccounts.length };
}

export async function listInstagramConnectionsForProfile(
  profileId: string
): Promise<
  Ok<{ accounts: InstagramConnectionRecord[]; activeIgAccountId: string | null }> | Err
> {
  const pid = profileId.trim();
  if (!pid) {
    return { ok: false, error: "Missing profile id." };
  }

  const supabase = serviceSupabase();
  if (!supabase) {
    return { ok: false, error: "Database is not configured." };
  }

  const [{ data, error }, { data: profileRow, error: profileErr }] = await Promise.all([
    supabase
      .from("instagram_connected_accounts")
      .select("id, profile_id, ig_account_id, ig_username, page_name, access_token")
      .eq("profile_id", pid)
      .order("created_at", { ascending: true }),
    supabase.from("social_profiles").select("ig_account_id").eq("id", pid).maybeSingle(),
  ]);

  if (error) {
    console.error("[listInstagramConnectionsForProfile]", error);
    return { ok: false, error: error.message };
  }
  if (profileErr) {
    console.error("[listInstagramConnectionsForProfile] profile", profileErr);
    return { ok: false, error: profileErr.message };
  }

  const activeIgAccountId =
    typeof profileRow?.ig_account_id === "string" && profileRow.ig_account_id.trim()
      ? profileRow.ig_account_id.trim()
      : null;

  return {
    ok: true,
    accounts: (data ?? []).map((row) => normalizeConnectionRow(row as Record<string, unknown>)),
    activeIgAccountId,
  };
}

export async function removeInstagramConnectionForProfile(
  profileId: string,
  igAccountId: string
): Promise<Ok | Err> {
  const pid = profileId.trim();
  const igId = igAccountId.trim();
  if (!pid || !igId) {
    return { ok: false, error: "Missing profile or Instagram account id." };
  }

  const supabase = serviceSupabase();
  if (!supabase) {
    return { ok: false, error: "Database is not configured." };
  }

  const { error: deleteErr } = await supabase
    .from("instagram_connected_accounts")
    .delete()
    .eq("profile_id", pid)
    .eq("ig_account_id", igId);

  if (deleteErr) {
    console.error("[removeInstagramConnectionForProfile]", deleteErr);
    return { ok: false, error: deleteErr.message };
  }

  const { data: profileRow } = await supabase
    .from("social_profiles")
    .select("ig_account_id")
    .eq("id", pid)
    .maybeSingle();

  const activeId =
    typeof profileRow?.ig_account_id === "string" ? profileRow.ig_account_id.trim() : "";
  if (activeId !== igId) {
    return { ok: true };
  }

  const remaining = await listInstagramConnectionsForProfile(pid);
  if (!remaining.ok) {
    return remaining;
  }

  const next = remaining.accounts[0];
  const { error: profileUpdateErr } = await supabase
    .from("social_profiles")
    .update({
      ig_account_id: next?.igAccountId ?? null,
      access_token: next?.accessToken ?? null,
    })
    .eq("id", pid);

  if (profileUpdateErr) {
    console.error("[removeInstagramConnectionForProfile] profile update", profileUpdateErr);
    return { ok: false, error: profileUpdateErr.message };
  }

  return { ok: true };
}

export async function clearInstagramConnectionsForProfile(profileId: string): Promise<Ok | Err> {
  const pid = profileId.trim();
  if (!pid) {
    return { ok: false, error: "Missing profile id." };
  }

  const supabase = serviceSupabase();
  if (!supabase) {
    return { ok: false, error: "Database is not configured." };
  }

  const { error: deleteErr } = await supabase
    .from("instagram_connected_accounts")
    .delete()
    .eq("profile_id", pid);

  if (deleteErr) {
    console.error("[clearInstagramConnectionsForProfile]", deleteErr);
    return { ok: false, error: deleteErr.message };
  }

  const { error: profileUpdateErr } = await supabase
    .from("social_profiles")
    .update({
      ig_account_id: null,
      access_token: null,
    })
    .eq("id", pid);

  if (profileUpdateErr) {
    console.error("[clearInstagramConnectionsForProfile] profile update", profileUpdateErr);
    return { ok: false, error: profileUpdateErr.message };
  }

  return { ok: true };
}
