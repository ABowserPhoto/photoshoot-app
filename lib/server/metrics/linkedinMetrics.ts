import { fetchWithTimeout } from "@/lib/server/fetchWithTimeout";
import {
  accountKey,
  addUtcDays,
  emptyAccount,
  mergeSeries,
  metricsFromRecord,
  parseLinkedInFollowerStatistics,
  parseLinkedInNetworkSize,
  parseLinkedInOrganizationName,
  parseLinkedInOrganizations,
  parseLinkedInPageStatistics,
  parseLinkedInShareStatistics,
  sanitizeProviderError,
  withDerivedMetrics,
  type SocialAccountMetrics,
  type SocialSeriesPoint,
} from "@/lib/socialMetricsModel";

const TIMEOUT_MS = 20000;

function linkedInVersion(): string {
  return process.env.LINKEDIN_API_VERSION?.trim() || "202610";
}

function headers(accessToken: string): HeadersInit {
  return {
    Authorization: `Bearer ${accessToken}`,
    "LinkedIn-Version": linkedInVersion(),
    "X-Restli-Protocol-Version": "2.0.0",
  };
}

async function linkedInGet(
  url: string,
  accessToken: string
): Promise<{ ok: boolean; json: unknown; error: string | null; status: number }> {
  let response: Response;
  try {
    response = await fetchWithTimeout(url, { headers: headers(accessToken), cache: "no-store" }, TIMEOUT_MS);
  } catch (error) {
    const message = error instanceof Error ? error.message : "network_error";
    return { ok: false, json: null, error: sanitizeProviderError(message), status: 0 };
  }
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      (json as { message?: string } | null)?.message ||
      (json as { error_description?: string } | null)?.error_description ||
      `LinkedIn request failed (${response.status})`;
    return { ok: false, json, error: sanitizeProviderError(message), status: response.status };
  }
  return { ok: true, json, error: null, status: response.status };
}

export async function listAdministeredOrganizations(accessToken: string): Promise<{
  ids: string[];
  error: string | null;
  authFailed: boolean;
}> {
  const url =
    "https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED";
  const result = await linkedInGet(url, accessToken);
  if (!result.ok) {
    return { ids: [], error: result.error, authFailed: result.status === 401 || result.status === 403 };
  }
  return { ids: parseLinkedInOrganizations(result.json), error: null, authFailed: false };
}

export async function fetchLinkedInOrganization(accessToken: string, organizationId: string): Promise<{
  name: string | null;
  vanity: string | null;
}> {
  const result = await linkedInGet(`https://api.linkedin.com/rest/organizations/${organizationId}`, accessToken);
  if (!result.ok) return { name: null, vanity: null };
  return parseLinkedInOrganizationName(result.json);
}

export async function fetchLinkedInMetrics(input: {
  profileId: string;
  organizationId: string;
  organizationName: string | null;
  vanityName: string | null;
  accessToken: string;
  rangeStart: string;
  rangeEnd: string;
}): Promise<SocialAccountMetrics> {
  const key = accountKey("linkedin", input.profileId, input.organizationId);
  const label = input.organizationName?.trim() || `Organization ${input.organizationId}`;
  const handle = input.vanityName ? `@${input.vanityName.replace(/^@/, "")}` : null;
  const base = {
    accountKey: key,
    platform: "linkedin" as const,
    profileId: input.profileId,
    label,
    handle,
  };

  const urn = encodeURIComponent(`urn:li:organization:${input.organizationId}`);
  const interval = timeInterval(input.rangeStart, input.rangeEnd);
  const [shares, followers, pages, network] = await Promise.all([
    linkedInGet(
      `https://api.linkedin.com/rest/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${urn}&timeIntervals=${encodeURIComponent(interval)}`,
      input.accessToken
    ),
    linkedInGet(
      `https://api.linkedin.com/rest/organizationalEntityFollowerStatistics?q=organizationalEntity&organizationalEntity=${urn}&timeIntervals=${encodeURIComponent(interval)}`,
      input.accessToken
    ),
    linkedInGet(
      `https://api.linkedin.com/rest/organizationPageStatistics?q=organization&organization=${urn}&timeIntervals=${encodeURIComponent(interval)}`,
      input.accessToken
    ),
    linkedInGet(
      `https://api.linkedin.com/rest/networkSizes/${urn}?edgeType=COMPANY_FOLLOWED_BY_MEMBER`,
      input.accessToken
    ),
  ]);

  const lifetimeFollowers = followers.ok
    ? null
    : await linkedInGet(
        `https://api.linkedin.com/rest/organizationalEntityFollowerStatistics?q=organizationalEntity&organizationalEntity=${urn}`,
        input.accessToken
      );

  const authFailed = [shares, followers, pages, network].some((result) => result.status === 401);
  if (authFailed) {
    return emptyAccount({
      ...base,
      status: "error",
      statusMessage: "LinkedIn rejected the saved token. Reconnect the account.",
    });
  }

  const shareParsed = shares.ok ? parseLinkedInShareStatistics(shares.json) : { totals: {}, series: [] as SocialSeriesPoint[] };
  const followerParsed = parseLinkedInFollowerStatistics(followers.ok ? followers.json : lifetimeFollowers?.json);
  const pageTotals = pages.ok ? parseLinkedInPageStatistics(pages.json) : {};
  const networkSize = network.ok ? parseLinkedInNetworkSize(network.json) : null;

  const totals: Record<string, number> = { ...shareParsed.totals, ...pageTotals };
  if (followerParsed.followers !== null) totals.followers = followerParsed.followers;
  else if (networkSize !== null) totals.followers = networkSize;
  if (followerParsed.organicFollowers !== null) totals.organic_followers = followerParsed.organicFollowers;
  if (followerParsed.paidFollowers !== null) totals.paid_followers = followerParsed.paidFollowers;
  if (followerParsed.organicGain !== null || followerParsed.paidGain !== null) {
    totals.follower_growth = (followerParsed.organicGain ?? 0) + (followerParsed.paidGain ?? 0);
  }

  const series = mergeSeries([shareParsed.series]);
  const metrics = withDerivedMetrics(metricsFromRecord(totals), series);
  const errors = [shares, followers, pages, network]
    .map((result) => result.error)
    .filter((error): error is string => Boolean(error));
  const permission = errors.find((error) => /permission|scope|access denied|not enough/i.test(error));
  const note =
    metrics.length > 0
      ? permission
        ? "Some LinkedIn statistics need Community Management API access (rw_organization_admin and r_organization_social)."
        : null
      : permission || errors[0] || "No LinkedIn organization statistics were returned.";

  return {
    ...base,
    status: metrics.length > 0 ? "ok" : "error",
    statusMessage: note,
    metrics,
    series,
    topPosts: [],
    capturedAt: new Date().toISOString(),
    fromCache: false,
  };
}

function timeInterval(start: string, end: string): string {
  const startMs = Date.parse(`${start}T00:00:00.000Z`);
  const endMs = Date.parse(`${addUtcDays(end, 1)}T00:00:00.000Z`);
  return `(timeRange:(start:${startMs},end:${endMs}),timeGranularityType:DAY)`;
}
