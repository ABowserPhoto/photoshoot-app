import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchFacebookPageMetrics } from "@/lib/server/metrics/facebookMetrics";
import { fetchInstagramMetrics } from "@/lib/server/metrics/instagramMetrics";
import {
  fetchLinkedInMetrics,
  fetchLinkedInOrganization,
  listAdministeredOrganizations,
} from "@/lib/server/metrics/linkedinMetrics";
import { fetchTikTokMetrics } from "@/lib/server/metrics/tiktokMetrics";
import {
  refreshLinkedInAccessToken,
  refreshTikTokAccessToken,
  tokenExpiresSoon,
  type RefreshedToken,
} from "@/lib/server/metrics/tokenRefresh";
import { platformEnvNames, socialPlatformCredentials } from "@/lib/server/socialPlatformConfig";
import { createServiceRoleClient } from "@/lib/server/supabaseServer";
import {
  accountKey,
  isIsoDate,
  mergeFollowerSnapshots,
  metricsFromRecord,
  platformLabel,
  rangeLengthDays,
  recordFromMetrics,
  utcToday,
  withDerivedMetrics,
  type ClientSocialMetrics,
  type PlatformSetup,
  type SocialAccountMetrics,
  type SocialPlatform,
  type SocialSeriesPoint,
  type SocialTopPost,
} from "@/lib/socialMetricsModel";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const ERROR_CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_RANGE_DAYS = 366;

type ProfileRow = {
  id: string;
  client_id: string;
  platform: string | null;
  handle: string | null;
  ig_account_id: string | null;
  access_token: string | null;
  tiktok_access_token: string | null;
  tiktok_refresh_token: string | null;
  tiktok_open_id: string | null;
  tiktok_token_expires_at: string | null;
  tiktok_refresh_expires_at: string | null;
  tiktok_scope: string | null;
  tiktok_display_name: string | null;
  tiktok_username: string | null;
  linkedin_access_token: string | null;
  linkedin_refresh_token: string | null;
  linkedin_token_expires_at: string | null;
  linkedin_refresh_expires_at: string | null;
  linkedin_member_id: string | null;
  linkedin_scope: string | null;
};

type IgRow = {
  profile_id: string;
  ig_account_id: string;
  ig_username: string | null;
  page_name: string | null;
  page_id: string | null;
  access_token: string;
};

type OrgRow = {
  profile_id: string;
  organization_id: string;
  organization_name: string | null;
  vanity_name: string | null;
};

type SnapshotRow = {
  metrics: unknown;
  series: unknown;
  top_posts: unknown;
  error: string | null;
  fetched_at: string;
};

export async function loadClientSocialMetrics(input: {
  clientId: string;
  rangeStart: string;
  rangeEnd: string;
  refresh: boolean;
}): Promise<{ ok: true; data: ClientSocialMetrics } | { ok: false; error: string }> {
  if (!isIsoDate(input.rangeStart) || !isIsoDate(input.rangeEnd) || input.rangeStart > input.rangeEnd) {
    return { ok: false, error: "Choose a valid date range." };
  }
  if (rangeLengthDays(input.rangeStart, input.rangeEnd) > MAX_RANGE_DAYS) {
    return { ok: false, error: "Date range cannot be longer than a year." };
  }

  const supabase = createServiceRoleClient();
  if (!supabase) {
    return { ok: false, error: "Database is not configured." };
  }

  const { data: client, error: clientError } = await supabase
    .from("social_clients")
    .select("id, name")
    .eq("id", input.clientId)
    .maybeSingle();
  if (clientError) return { ok: false, error: clientError.message };
  if (!client) return { ok: false, error: "Client not found." };

  const { data: profileData, error: profileError } = await supabase
    .from("social_profiles")
    .select(
      "id, client_id, platform, handle, ig_account_id, access_token, tiktok_access_token, tiktok_refresh_token, tiktok_open_id, tiktok_token_expires_at, tiktok_refresh_expires_at, tiktok_scope, tiktok_display_name, tiktok_username, linkedin_access_token, linkedin_refresh_token, linkedin_token_expires_at, linkedin_refresh_expires_at, linkedin_member_id, linkedin_scope"
    )
    .eq("client_id", input.clientId);
  if (profileError) return { ok: false, error: profileError.message };

  const profiles = (profileData ?? []) as ProfileRow[];
  const profileIds = profiles.map((profile) => profile.id);
  const igRows = await loadInstagramRows(supabase, profiles, profileIds);
  const orgRows = await loadOrganizationRows(supabase, profileIds);

  const credentials = socialPlatformCredentials();
  const envNames = platformEnvNames();
  let historyAvailable = true;
  const accounts: SocialAccountMetrics[] = [];

  for (const ig of igRows) {
    const igKey = accountKey("instagram", ig.profile_id, ig.ig_account_id);
    const cachedIg = await readFreshSnapshot(supabase, igKey, input);
    if (cachedIg.missingTable) historyAvailable = false;
    if (cachedIg.account) {
      accounts.push(await withDailyHistory(supabase, cachedIg.account, input));
    } else {
      const live = await fetchInstagramMetrics({
        profileId: ig.profile_id,
        igAccountId: ig.ig_account_id,
        accessToken: ig.access_token,
        username: ig.ig_username,
        pageName: ig.page_name,
        rangeStart: input.rangeStart,
        rangeEnd: input.rangeEnd,
      });
      historyAvailable = (await persistSnapshot(supabase, input.clientId, live, input)) && historyAvailable;
      accounts.push(await withDailyHistory(supabase, live, input));
    }

    const fbKey = accountKey("facebook", ig.profile_id, ig.ig_account_id);
    const cachedFb = await readFreshSnapshot(supabase, fbKey, input);
    if (cachedFb.missingTable) historyAvailable = false;
    if (cachedFb.account) {
      accounts.push(await withDailyHistory(supabase, cachedFb.account, input));
      continue;
    }
    const facebook = await fetchFacebookPageMetrics({
      profileId: ig.profile_id,
      accountExternalId: ig.ig_account_id,
      pageId: ig.page_id,
      pageName: ig.page_name,
      accessToken: ig.access_token,
      rangeStart: input.rangeStart,
      rangeEnd: input.rangeEnd,
    });
    historyAvailable = (await persistSnapshot(supabase, input.clientId, facebook.account, input)) && historyAvailable;
    accounts.push(await withDailyHistory(supabase, facebook.account, input));
    if (facebook.pageId && facebook.pageId !== ig.page_id) {
      await supabase
        .from("instagram_connected_accounts")
        .update({ page_id: facebook.pageId })
        .eq("profile_id", ig.profile_id)
        .eq("ig_account_id", ig.ig_account_id);
    }
  }

  for (const profile of profiles) {
    if (!profile.tiktok_access_token?.trim()) continue;
    const openId = profile.tiktok_open_id?.trim() || profile.id;
    const ttKey = accountKey("tiktok", profile.id, openId);
    const cached = await readFreshSnapshot(supabase, ttKey, input);
    if (cached.missingTable) historyAvailable = false;
    if (cached.account) {
      accounts.push(await withDailyHistory(supabase, cached.account, input));
      continue;
    }
    const token = await ensureTikTokToken(supabase, profile);
    const live = await fetchTikTokMetrics({
      profileId: profile.id,
      openId: token.openId ?? profile.tiktok_open_id,
      handle: profile.tiktok_username ? `@${profile.tiktok_username.replace(/^@/, "")}` : profile.handle,
      accessToken: token.accessToken,
      scope: token.scope ?? profile.tiktok_scope,
      rangeStart: input.rangeStart,
      rangeEnd: input.rangeEnd,
    });
    if (live.authFailed && profile.tiktok_refresh_token?.trim() && token.accessToken === profile.tiktok_access_token) {
      const refreshed = await refreshTikTokAccessToken(profile.tiktok_refresh_token.trim());
      if (refreshed.ok) {
        await saveTikTokToken(supabase, profile.id, refreshed.token);
        const retry = await fetchTikTokMetrics({
          profileId: profile.id,
          openId: refreshed.token.openId ?? profile.tiktok_open_id,
          handle: profile.handle,
          accessToken: refreshed.token.accessToken,
          scope: refreshed.token.scope ?? profile.tiktok_scope,
          rangeStart: input.rangeStart,
          rangeEnd: input.rangeEnd,
        });
        historyAvailable = (await persistSnapshot(supabase, input.clientId, retry.account, input)) && historyAvailable;
        accounts.push(await withDailyHistory(supabase, retry.account, input));
        await saveTikTokIdentity(supabase, profile.id, retry.displayName, retry.username);
        continue;
      }
    }
    historyAvailable = (await persistSnapshot(supabase, input.clientId, live.account, input)) && historyAvailable;
    accounts.push(await withDailyHistory(supabase, live.account, input));
    await saveTikTokIdentity(supabase, profile.id, live.displayName, live.username);
  }

  for (const profile of profiles) {
    if (!profile.linkedin_access_token?.trim()) continue;
    const token = await ensureLinkedInToken(supabase, profile);
    const organizations = orgRows.filter((org) => org.profile_id === profile.id);
    if (organizations.length === 0) {
      let listed = await listAdministeredOrganizations(token.accessToken);
      if (listed.authFailed && profile.linkedin_refresh_token?.trim()) {
        const refreshed = await refreshLinkedInAccessToken(profile.linkedin_refresh_token.trim());
        if (refreshed.ok) {
          await saveLinkedInToken(supabase, profile.id, refreshed.token);
          token.accessToken = refreshed.token.accessToken;
          listed = await listAdministeredOrganizations(token.accessToken);
        }
      }
      const again = listed;
      for (const organizationId of again.ids) {
        const details = await fetchLinkedInOrganization(token.accessToken, organizationId);
        const row: OrgRow = {
          profile_id: profile.id,
          organization_id: organizationId,
          organization_name: details.name,
          vanity_name: details.vanity,
        };
        organizations.push(row);
        await supabase.from("linkedin_connected_organizations").upsert(
          {
            profile_id: profile.id,
            organization_id: organizationId,
            organization_name: details.name,
            vanity_name: details.vanity,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "profile_id,organization_id" }
        );
      }
      if (organizations.length === 0) {
        accounts.push({
          accountKey: accountKey("linkedin", profile.id, "none"),
          platform: "linkedin",
          profileId: profile.id,
          label: "LinkedIn",
          handle: profile.handle,
          status: "error",
          statusMessage:
            again.error ??
            "LinkedIn is connected, but no administered organization page was found. Personal profile analytics are not available.",
          metrics: [],
          series: [],
          topPosts: [],
          capturedAt: new Date().toISOString(),
          fromCache: false,
        });
      }
    }

    for (const org of organizations) {
      const liKey = accountKey("linkedin", profile.id, org.organization_id);
      const cached = await readFreshSnapshot(supabase, liKey, input);
      if (cached.missingTable) historyAvailable = false;
      if (cached.account) {
        accounts.push(await withDailyHistory(supabase, cached.account, input));
        continue;
      }
      const live = await fetchLinkedInMetrics({
        profileId: profile.id,
        organizationId: org.organization_id,
        organizationName: org.organization_name,
        vanityName: org.vanity_name,
        accessToken: token.accessToken,
        rangeStart: input.rangeStart,
        rangeEnd: input.rangeEnd,
      });
      historyAvailable = (await persistSnapshot(supabase, input.clientId, live, input)) && historyAvailable;
      accounts.push(await withDailyHistory(supabase, live, input));
    }
  }

  const connected = {
    instagram: igRows.length > 0,
    facebook: igRows.length > 0,
    tiktok: profiles.some((profile) => Boolean(profile.tiktok_access_token?.trim())),
    linkedin: profiles.some((profile) => Boolean(profile.linkedin_access_token?.trim())),
  };

  return {
    ok: true,
    data: {
      clientId: input.clientId,
      clientName: String(client.name ?? "Client"),
      rangeStart: input.rangeStart,
      rangeEnd: input.rangeEnd,
      generatedAt: new Date().toISOString(),
      historyAvailable,
      platforms: [
        setup("instagram", credentials.meta, connected.instagram, envNames.meta),
        setup("facebook", credentials.meta, connected.facebook, envNames.meta),
        setup("tiktok", credentials.tiktok, connected.tiktok, envNames.tiktok),
        setup("linkedin", credentials.linkedin, connected.linkedin, envNames.linkedin),
      ],
      accounts,
    },
  };
}

function setup(platform: SocialPlatform, configured: boolean, connected: boolean, envVars: string[]): PlatformSetup {
  let message: string | null = null;
  if (!connected) {
    message = configured
      ? `${platformLabel(platform)} is not connected for this client.`
      : `${platformLabel(platform)} is not configured yet. Set ${envVars.join(" and ")}.`;
  }
  return {
    platform,
    label: platformLabel(platform),
    configured,
    connected,
    envVars,
    message,
  };
}

async function loadInstagramRows(
  supabase: SupabaseClient,
  profiles: ProfileRow[],
  profileIds: string[]
): Promise<IgRow[]> {
  if (profileIds.length === 0) return [];
  const { data, error } = await supabase
    .from("instagram_connected_accounts")
    .select("profile_id, ig_account_id, ig_username, page_name, page_id, access_token")
    .in("profile_id", profileIds);
  const rows = error ? [] : ((data ?? []) as IgRow[]);
  const seen = new Set(rows.map((row) => `${row.profile_id}:${row.ig_account_id}`));
  for (const profile of profiles) {
    const igAccountId = profile.ig_account_id?.trim();
    const accessToken = profile.access_token?.trim();
    if (!igAccountId || !accessToken) continue;
    const key = `${profile.id}:${igAccountId}`;
    if (seen.has(key)) continue;
    rows.push({
      profile_id: profile.id,
      ig_account_id: igAccountId,
      ig_username: profile.handle?.replace(/^@/, "") ?? null,
      page_name: null,
      page_id: null,
      access_token: accessToken,
    });
  }
  return rows.filter((row) => row.access_token?.trim() && row.ig_account_id?.trim());
}

async function loadOrganizationRows(supabase: SupabaseClient, profileIds: string[]): Promise<OrgRow[]> {
  if (profileIds.length === 0) return [];
  const { data } = await supabase
    .from("linkedin_connected_organizations")
    .select("profile_id, organization_id, organization_name, vanity_name")
    .in("profile_id", profileIds);
  return (data ?? []) as OrgRow[];
}

async function readFreshSnapshot(
  supabase: SupabaseClient,
  accountKeyValue: string,
  input: { rangeStart: string; rangeEnd: string; refresh: boolean }
): Promise<{ account: SocialAccountMetrics | null; missingTable: boolean }> {
  if (input.refresh) return { account: null, missingTable: false };
  const today = utcToday();
  const { data, error } = await supabase
    .from("social_metric_snapshots")
    .select("metrics, series, top_posts, error, fetched_at, platform, profile_id, account_label")
    .eq("account_key", accountKeyValue)
    .eq("kind", "range")
    .eq("snapshot_date", today)
    .eq("range_start", input.rangeStart)
    .eq("range_end", input.rangeEnd)
    .maybeSingle();

  if (error) {
    return { account: null, missingTable: isMissingRelation(error.message) };
  }
  if (!data) return { account: null, missingTable: false };
  const row = data as SnapshotRow & {
    platform: SocialPlatform;
    profile_id: string;
    account_label: string | null;
  };
  const age = Date.now() - Date.parse(row.fetched_at);
  const ttl = row.error ? ERROR_CACHE_TTL_MS : CACHE_TTL_MS;
  if (!Number.isFinite(age) || age > ttl) return { account: null, missingTable: false };

  const metrics = withDerivedMetrics(metricsFromRecord(asNumberRecord(row.metrics)), asSeries(row.series));
  return {
    missingTable: false,
    account: {
      accountKey: accountKeyValue,
      platform: row.platform,
      profileId: row.profile_id,
      label: row.account_label?.trim() || platformLabel(row.platform),
      handle: null,
      status: metrics.length === 0 && row.error ? "error" : "ok",
      statusMessage: row.error,
      metrics,
      series: asSeries(row.series),
      topPosts: asPosts(row.top_posts),
      capturedAt: row.fetched_at,
      fromCache: true,
    },
  };
}

async function withDailyHistory(
  supabase: SupabaseClient,
  account: SocialAccountMetrics,
  input: { rangeStart: string; rangeEnd: string }
): Promise<SocialAccountMetrics> {
  const dailies = await readDailyFollowers(supabase, account.accountKey, input.rangeStart, input.rangeEnd);
  const series = mergeFollowerSnapshots(account.series, dailies);
  return {
    ...account,
    series,
    metrics: withDerivedMetrics(account.metrics, series),
  };
}

async function readDailyFollowers(
  supabase: SupabaseClient,
  accountKeyValue: string,
  rangeStart: string,
  rangeEnd: string
): Promise<Array<{ date: string; followers: number | null }>> {
  const { data, error } = await supabase
    .from("social_metric_snapshots")
    .select("snapshot_date, metrics")
    .eq("account_key", accountKeyValue)
    .eq("kind", "daily")
    .gte("snapshot_date", rangeStart)
    .lte("snapshot_date", rangeEnd);
  if (error || !data) return [];
  return (data as Array<{ snapshot_date: string; metrics: unknown }>).map((row) => ({
    date: row.snapshot_date,
    followers: asNumberRecord(row.metrics).followers ?? null,
  }));
}

async function persistSnapshot(
  supabase: SupabaseClient,
  clientId: string,
  account: SocialAccountMetrics,
  input: { rangeStart: string; rangeEnd: string }
): Promise<boolean> {
  const today = utcToday();
  const metrics = recordFromMetrics(account.metrics);
  const { error } = await supabase.from("social_metric_snapshots").upsert(
    {
      client_id: clientId,
      profile_id: account.profileId,
      platform: account.platform,
      account_key: account.accountKey,
      account_label: account.label,
      kind: "range",
      snapshot_date: today,
      range_start: input.rangeStart,
      range_end: input.rangeEnd,
      metrics,
      series: account.series,
      top_posts: account.topPosts,
      error: account.statusMessage,
      fetched_at: new Date().toISOString(),
    },
    { onConflict: "account_key,kind,snapshot_date,range_start,range_end" }
  );
  if (error) {
    console.error("[social metrics] snapshot write", error.message);
    return !isMissingRelation(error.message);
  }

  const followers = metrics.followers;
  if (typeof followers === "number") {
    await supabase.from("social_metric_snapshots").upsert(
      {
        client_id: clientId,
        profile_id: account.profileId,
        platform: account.platform,
        account_key: account.accountKey,
        account_label: account.label,
        kind: "daily",
        snapshot_date: today,
        range_start: today,
        range_end: today,
        metrics: { followers },
        series: [],
        top_posts: [],
        error: null,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: "account_key,kind,snapshot_date,range_start,range_end" }
    );
  }
  return true;
}

async function ensureTikTokToken(
  supabase: SupabaseClient,
  profile: ProfileRow
): Promise<{ accessToken: string; openId: string | null; scope: string | null }> {
  const current = profile.tiktok_access_token?.trim() ?? "";
  const refresh = profile.tiktok_refresh_token?.trim() ?? "";
  if (refresh && tokenExpiresSoon(profile.tiktok_token_expires_at)) {
    const refreshed = await refreshTikTokAccessToken(refresh);
    if (refreshed.ok) {
      await saveTikTokToken(supabase, profile.id, refreshed.token);
      return {
        accessToken: refreshed.token.accessToken,
        openId: refreshed.token.openId ?? profile.tiktok_open_id,
        scope: refreshed.token.scope ?? profile.tiktok_scope,
      };
    }
  }
  return { accessToken: current, openId: profile.tiktok_open_id, scope: profile.tiktok_scope };
}

async function ensureLinkedInToken(
  supabase: SupabaseClient,
  profile: ProfileRow
): Promise<{ accessToken: string }> {
  const current = profile.linkedin_access_token?.trim() ?? "";
  const refresh = profile.linkedin_refresh_token?.trim() ?? "";
  if (refresh && tokenExpiresSoon(profile.linkedin_token_expires_at)) {
    const refreshed = await refreshLinkedInAccessToken(refresh);
    if (refreshed.ok) {
      await saveLinkedInToken(supabase, profile.id, refreshed.token);
      return { accessToken: refreshed.token.accessToken };
    }
  }
  return { accessToken: current };
}

async function saveTikTokToken(supabase: SupabaseClient, profileId: string, token: RefreshedToken) {
  const patch: Record<string, string | null> = {
    tiktok_access_token: token.accessToken,
    tiktok_token_expires_at: token.expiresAt,
    tiktok_refresh_expires_at: token.refreshExpiresAt,
  };
  if (token.refreshToken) patch.tiktok_refresh_token = token.refreshToken;
  if (token.openId) patch.tiktok_open_id = token.openId;
  if (token.scope) patch.tiktok_scope = token.scope;
  await supabase.from("social_profiles").update(patch).eq("id", profileId);
}

async function saveTikTokIdentity(
  supabase: SupabaseClient,
  profileId: string,
  displayName: string | null,
  username: string | null
) {
  if (!displayName && !username) return;
  await supabase
    .from("social_profiles")
    .update({
      tiktok_display_name: displayName,
      tiktok_username: username,
    })
    .eq("id", profileId);
}

async function saveLinkedInToken(supabase: SupabaseClient, profileId: string, token: RefreshedToken) {
  const patch: Record<string, string | null> = {
    linkedin_access_token: token.accessToken,
    linkedin_token_expires_at: token.expiresAt,
    linkedin_refresh_expires_at: token.refreshExpiresAt,
  };
  if (token.refreshToken) patch.linkedin_refresh_token = token.refreshToken;
  if (token.scope) patch.linkedin_scope = token.scope;
  await supabase.from("social_profiles").update(patch).eq("id", profileId);
}

function asNumberRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "number" && Number.isFinite(entry)) record[key] = entry;
  }
  return record;
}

function asSeries(value: unknown): SocialSeriesPoint[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const date = (entry as { date?: unknown }).date;
    const values = asNumberRecord((entry as { values?: unknown }).values);
    if (typeof date !== "string") return [];
    return [{ date, values }];
  });
}

function asPosts(value: unknown): SocialTopPost[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is SocialTopPost => {
    if (!entry || typeof entry !== "object") return false;
    const post = entry as SocialTopPost;
    return typeof post.id === "string" && typeof post.accountKey === "string";
  });
}

function isMissingRelation(message: string): boolean {
  return /does not exist|schema cache|social_metric_snapshots/i.test(message);
}
