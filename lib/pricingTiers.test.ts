import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  PRICING_ITEM_KEYS,
  PRICING_TIERS,
  STANDARD_SEED_PRICE_NET_CENTS,
  formatCentsForInput,
  parseEuroInputToCents,
  parsePriceNetCents,
  parsePricingLabel,
  parsePricingTier,
  pricingItemUnit,
  readPricingTierField,
  resolveClientPricingTier,
} from "./pricingTiers.ts";

test("pricing tiers are the three website contract values", () => {
  assert.deepEqual(PRICING_TIERS, ["standard", "legacy", "corporate"]);
  assert.equal(parsePricingTier(" Standard "), "standard");
  assert.equal(parsePricingTier("legacy"), "legacy");
  assert.equal(parsePricingTier("CORPORATE"), "corporate");
  assert.equal(parsePricingTier("vip"), null);
  assert.equal(parsePricingTier(null), null);
  assert.equal(parsePricingTier(""), null);
});

test("approval requires a tier only when a pending client becomes approved", () => {
  const missing = resolveClientPricingTier({
    requiresTier: true,
    field: { status: "absent" },
    existing: null,
  });
  assert.equal(missing.ok, false);

  const chosen = resolveClientPricingTier({
    requiresTier: true,
    field: { status: "tier", tier: "legacy" },
    existing: null,
  });
  assert.deepEqual(chosen, { ok: true, tier: "legacy" });

  const staffCreated = resolveClientPricingTier({
    requiresTier: false,
    field: { status: "absent" },
    existing: null,
  });
  assert.deepEqual(staffCreated, { ok: true, tier: null });

  const kept = resolveClientPricingTier({
    requiresTier: false,
    field: { status: "absent" },
    existing: "corporate",
  });
  assert.deepEqual(kept, { ok: true, tier: "corporate" });

  const cleared = resolveClientPricingTier({
    requiresTier: false,
    field: { status: "null" },
    existing: "standard",
  });
  assert.deepEqual(cleared, { ok: true, tier: null });
});

test("tier field distinguishes absent, empty, and invalid", () => {
  assert.deepEqual(readPricingTierField({}), { status: "absent" });
  assert.deepEqual(readPricingTierField({ pricing_tier: null }), { status: "null" });
  assert.deepEqual(readPricingTierField({ pricing_tier: "" }), { status: "null" });
  assert.deepEqual(readPricingTierField({ pricing_tier: "corporate" }), {
    status: "tier",
    tier: "corporate",
  });
  assert.deepEqual(readPricingTierField({ pricing_tier: "gold" }), { status: "invalid" });
});

test("euro input converts to net cents and treats empty as auf Anfrage", () => {
  assert.deepEqual(parseEuroInputToCents(""), { ok: true, cents: null });
  assert.deepEqual(parseEuroInputToCents("  "), { ok: true, cents: null });
  assert.deepEqual(parseEuroInputToCents("auf Anfrage"), { ok: true, cents: null });
  assert.deepEqual(parseEuroInputToCents("129"), { ok: true, cents: 12900 });
  assert.deepEqual(parseEuroInputToCents("129.00"), { ok: true, cents: 12900 });
  assert.deepEqual(parseEuroInputToCents("19,5"), { ok: true, cents: 1950 });
  assert.deepEqual(parseEuroInputToCents("€ 35.00"), { ok: true, cents: 3500 });
  assert.equal(parseEuroInputToCents("-1").ok, false);
  assert.equal(parseEuroInputToCents("12.999").ok, false);
  assert.equal(parseEuroInputToCents("abc").ok, false);
  assert.equal(formatCentsForInput(null), "");
  assert.equal(formatCentsForInput(1900), "19.00");
  assert.equal(formatCentsForInput(3500), "35.00");
  assert.deepEqual(parsePriceNetCents(12900), { ok: true, cents: 12900 });
  assert.deepEqual(parsePriceNetCents(null), { ok: true, cents: null });
  assert.equal(parsePriceNetCents(12.5).ok, false);
  assert.equal(parsePriceNetCents(-1).ok, false);
});

test("labels trim to null and reject oversized text", () => {
  assert.deepEqual(parsePricingLabel("  10 Fotos  "), { ok: true, label: "10 Fotos" });
  assert.deepEqual(parsePricingLabel("   "), { ok: true, label: null });
  assert.deepEqual(parsePricingLabel(null), { ok: true, label: null });
  assert.equal(parsePricingLabel("x".repeat(161)).ok, false);
  assert.equal(parsePricingLabel(12).ok, false);
});

test("seed covers every item key for all three tiers and the Standard price list", () => {
  const sql = readFileSync(new URL("./sql/pricing-tier-prices.sql", import.meta.url), "utf8");
  for (const tier of PRICING_TIERS) {
    assert.match(sql, new RegExp(`'${tier}'`));
  }
  for (const itemKey of PRICING_ITEM_KEYS) {
    assert.match(sql, new RegExp(`'${itemKey}'`));
  }
  assert.match(sql, /individual_photo', 'Einzelfoto', 'Individual photo', 'per_photo'/);
  assert.match(sql, /homestaging', 'Homestaging', 'Home staging', 'per_photo'/);
  assert.equal(pricingItemUnit("individual_photo"), "per_photo");
  assert.equal(pricingItemUnit("homestaging"), "per_photo");
  assert.equal(pricingItemUnit("booking_fee"), "flat");

  for (const [itemKey, cents] of Object.entries(STANDARD_SEED_PRICE_NET_CENTS)) {
    assert.match(sql, new RegExp(`'${itemKey}'[\\s\\S]*?${cents}`));
  }
  assert.match(sql, /WHEN tiers\.tier = 'standard' THEN items\.standard_price_net_cents/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.pricing_tier_prices FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /pricing_tier_prices_select_own_tier/);
  assert.match(sql, /pricing_tier_prices_staff_all/);
  assert.match(sql, /new\.pricing_tier := old\.pricing_tier/);
});
