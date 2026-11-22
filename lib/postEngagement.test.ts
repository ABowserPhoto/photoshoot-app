import assert from "node:assert/strict";
import { test } from "node:test";

import { metric } from "./socialMetricsModel.ts";
import {
  captionMatchKey,
  hasPostEngagement,
  indexEngagementByCaption,
  lookupEngagementByCaption,
  postEngagementFromMetrics,
} from "./postEngagement.ts";

test("engagement keeps likes, comments, and the extra per-post counts", () => {
  const counts = postEngagementFromMetrics([
    metric("likes", 12),
    metric("comments", 3),
    metric("views", 90),
    metric("shares", 1),
    metric("saves", 4),
    metric("engagement_rate", 8),
  ]);
  assert.deepEqual(counts, { likes: 12, comments: 3, shares: 1, saves: 4, views: 90 });
  assert.equal(hasPostEngagement(counts), true);
  assert.equal(postEngagementFromMetrics([metric("followers", 10)]), null);
});

test("caption lookup matches the first line and ignores generic titles", () => {
  const posts = [
    { title: "Sunset on the dock", counts: { likes: 4, comments: 1, shares: null, saves: null, views: null } },
    { title: "Instagram post", counts: { likes: 9, comments: 9, shares: null, saves: null, views: null } },
    { title: "Hi", counts: { likes: 1, comments: 0, shares: null, saves: null, views: null } },
  ];
  const index = indexEngagementByCaption(posts);
  assert.equal(lookupEngagementByCaption(index, "Sunset on the dock\n#brand")?.counts.likes, 4);
  assert.equal(lookupEngagementByCaption(index, "Instagram post"), null);
  assert.equal(lookupEngagementByCaption(index, "Hi"), null);
  assert.equal(captionMatchKey("  Sunset   on the dock  "), "sunset on the dock");
});
