import assert from "node:assert/strict";
import { test } from "node:test";

import {
  aggregateAccounts,
  eachDateWindow,
  engagementRate,
  followerDelta,
  mapInsightTotals,
  mergeFollowerSnapshots,
  parseGraphInsights,
  parseLinkedInFollowerStatistics,
  parseLinkedInOrganizations,
  parseLinkedInShareStatistics,
  parseTikTokUserInfo,
  sanitizeProviderError,
  tiktokVideosInRange,
  withDerivedMetrics,
  metric,
  type SocialAccountMetrics,
} from "./socialMetricsModel.ts";

test("date windows stay inside the requested range", () => {
  const windows = eachDateWindow("2026-01-01", "2026-02-15", 28);
  assert.deepEqual(windows, [
    { start: "2026-01-01", end: "2026-01-28" },
    { start: "2026-01-29", end: "2026-02-15" },
  ]);
  assert.deepEqual(eachDateWindow("2026-02-02", "2026-02-01", 7), []);
});

test("graph insights keep totals and daily series", () => {
  const parsed = parseGraphInsights({
    data: [
      {
        name: "reach",
        total_value: { value: 30 },
        values: [
          { value: 10, end_time: "2026-11-01T07:00:00+0000" },
          { value: 20, end_time: "2026-11-02T07:00:00+0000" },
        ],
      },
      { name: "likes", values: [{ value: 4, end_time: "2026-11-01T07:00:00+0000" }] },
    ],
  });
  assert.equal(parsed.totals.reach, 30);
  assert.equal(parsed.totals.likes, 4);
  assert.equal(parsed.series[0]?.values.reach, 10);
  assert.deepEqual(mapInsightTotals({ total_interactions: 8, views: 40 }), {
    interactions: 8,
    views: 40,
    impressions: 40,
  });
});

test("engagement rate prefers reach, then views, then followers", () => {
  assert.equal(engagementRate({ interactions: 10, reach: 100, views: 50 }), 10);
  assert.equal(engagementRate({ likes: 2, comments: 3, views: 50 }), 10);
  assert.equal(engagementRate({ likes: 5, followers: 0 }), null);
});

test("follower growth uses the first and last snapshot in the series", () => {
  assert.equal(
    followerDelta([
      { date: "2026-11-02", values: { followers: 120 } },
      { date: "2026-11-01", values: { followers: 100 } },
    ]),
    20
  );
  assert.equal(followerDelta([{ date: "2026-11-01", values: { followers: 100 } }]), null);
});

test("daily follower snapshots fill gaps without replacing API points", () => {
  const merged = mergeFollowerSnapshots(
    [{ date: "2026-11-02", values: { followers: 50, reach: 4 } }],
    [
      { date: "2026-11-01", followers: 40 },
      { date: "2026-11-02", followers: 99 },
    ]
  );
  assert.equal(merged[0]?.values.followers, 40);
  assert.equal(merged[1]?.values.followers, 50);
  assert.equal(merged[1]?.values.reach, 4);
});

test("all-accounts aggregation sums counts and recomputes rate", () => {
  const left = account("instagram:a:1", {
    followers: 100,
    reach: 40,
    likes: 4,
  });
  const right = account("tiktok:a:2", {
    followers: 50,
    reach: 10,
    likes: 1,
    comments: 1,
  });
  const aggregated = aggregateAccounts([left, right]);
  const byKey = new Map(aggregated.metrics.map((item) => [item.key, item.value]));
  assert.equal(byKey.get("followers"), 150);
  assert.equal(byKey.get("reach"), 50);
  assert.equal(byKey.get("likes"), 5);
  assert.equal(byKey.get("interactions"), 6);
  assert.equal(byKey.get("engagement_rate"), 12);
});

test("tiktok and linkedin payloads become numbers without throwing on errors", () => {
  assert.equal(parseTikTokUserInfo({ error: { code: "scope_not_authorized", message: "missing stats" } }).error, "missing stats");
  assert.equal(
    parseTikTokUserInfo({ data: { user: { follower_count: 9 } }, error: { code: "ok" } }).user?.follower_count,
    9
  );
  const ranged = tiktokVideosInRange(
    [
      { id: "old", create_time: Math.floor(Date.parse("2026-01-01T00:00:00.000Z") / 1000) },
      { id: "new", create_time: Math.floor(Date.parse("2026-11-15T12:00:00.000Z") / 1000) },
    ],
    "2026-11-01",
    "2026-11-22"
  );
  assert.deepEqual(ranged.map((video) => video.id), ["new"]);

  const shares = parseLinkedInShareStatistics({
    elements: [
      {
        totalShareStatistics: { impressionCount: 20, uniqueImpressionsCount: 11, likeCount: 3, clickCount: 2 },
        timeRange: { end: Date.parse("2026-11-02T00:00:00.000Z") },
      },
    ],
  });
  assert.equal(shares.totals.impressions, 20);
  assert.equal(shares.totals.reach, 11);
  assert.equal(shares.totals.interactions, 5);

  const followers = parseLinkedInFollowerStatistics({
    elements: [
      {
        followerCountsByAssociationType: [{ followerCounts: { organicFollowerCount: 8, paidFollowerCount: 2 } }],
        followerGains: { organicFollowerGain: 1, paidFollowerGain: 0 },
      },
    ],
  });
  assert.equal(followers.followers, 10);
  assert.equal(followers.organicGain, 1);
  assert.deepEqual(parseLinkedInOrganizations({ elements: [{ organization: "urn:li:organization:42" }] }), ["42"]);
});

test("provider errors never keep access tokens", () => {
  const cleaned = sanitizeProviderError("OAuth failed access_token=super-secret&other=1 Bearer abc.def");
  assert.equal(cleaned.includes("super-secret"), false);
  assert.equal(cleaned.includes("abc.def"), false);
  assert.match(cleaned, /redacted/);
});

test("derived metrics add engagement when only likes are present", () => {
  const derived = withDerivedMetrics(
    [metric("likes", 5), metric("followers", 50)],
    [
      { date: "2026-11-01", values: { followers: 40 } },
      { date: "2026-11-02", values: { followers: 50 } },
    ]
  );
  const byKey = new Map(derived.map((item) => [item.key, item.value]));
  assert.equal(byKey.get("interactions"), 5);
  assert.equal(byKey.get("follower_growth"), 10);
  assert.equal(byKey.get("engagement_rate"), 10);
});

function account(key: string, values: Record<string, number>): SocialAccountMetrics {
  return {
    accountKey: key,
    platform: key.startsWith("tiktok") ? "tiktok" : "instagram",
    profileId: "profile",
    label: key,
    handle: null,
    status: "ok",
    statusMessage: null,
    metrics: Object.entries(values).map(([metricKey, value]) => metric(metricKey, value)),
    series: [],
    topPosts: [],
    capturedAt: null,
    fromCache: false,
  };
}
