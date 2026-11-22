import { NextResponse } from "next/server";

import {
  isPricingUnit,
  parsePriceNetCents,
  parsePricingLabel,
  parsePricingTier,
  type PricingPriceRecord,
} from "@/lib/pricingTiers";
import { assertModuleAccess } from "@/lib/server/assertModuleAccess";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PriceRow = {
  id: string;
  tier: string;
  item_key: string;
  label_de: string | null;
  label_en: string | null;
  unit: string;
  price_net_cents: number | null;
  sort_order: number | null;
  active: boolean;
  updated_at: string;
};

function mapPriceRow(row: PriceRow): PricingPriceRecord | null {
  const tier = parsePricingTier(row.tier);
  if (!tier || !isPricingUnit(row.unit)) {
    return null;
  }
  return {
    id: row.id,
    tier,
    itemKey: row.item_key,
    labelDe: row.label_de?.trim() ?? "",
    labelEn: row.label_en?.trim() ?? "",
    unit: row.unit,
    priceNetCents: row.price_net_cents,
    sortOrder: row.sort_order ?? 0,
    active: row.active !== false,
    updatedAt: row.updated_at,
  };
}

export async function GET() {
  const access = await assertModuleAccess("crm");
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase admin client is not configured. Set SUPABASE_SERVICE_ROLE_KEY." },
      { status: 503 }
    );
  }

  const { data, error } = await supabase
    .from("pricing_tier_prices")
    .select("id, tier, item_key, label_de, label_en, unit, price_net_cents, sort_order, active, updated_at")
    .order("sort_order", { ascending: true })
    .order("item_key", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const prices = ((data ?? []) as PriceRow[])
    .map(mapPriceRow)
    .filter((row): row is PricingPriceRecord => row !== null);

  return NextResponse.json({ ok: true, prices });
}

type PriceUpdate = {
  id?: unknown;
  label_de?: unknown;
  label_en?: unknown;
  price_net_cents?: unknown;
  active?: unknown;
};

export async function PUT(request: Request) {
  const access = await assertModuleAccess("crm");
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  let body: { prices?: unknown };
  try {
    body = (await request.json()) as { prices?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!Array.isArray(body.prices) || body.prices.length === 0) {
    return NextResponse.json({ error: "prices must be a non-empty list." }, { status: 400 });
  }
  if (body.prices.length > 200) {
    return NextResponse.json({ error: "Too many price rows." }, { status: 400 });
  }

  const parsed: {
    id: string;
    labelDe: string | null;
    labelEn: string | null;
    priceNetCents: number | null;
    active: boolean;
  }[] = [];
  const seen = new Set<string>();

  for (const item of body.prices) {
    if (!item || typeof item !== "object") {
      return NextResponse.json({ error: "Each price row must be an object." }, { status: 400 });
    }
    const row = item as PriceUpdate;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    if (!id) {
      return NextResponse.json({ error: "Each price row needs an id." }, { status: 400 });
    }
    if (seen.has(id)) {
      return NextResponse.json({ error: "Duplicate price row." }, { status: 400 });
    }
    seen.add(id);

    const labelDe = parsePricingLabel(row.label_de);
    if (!labelDe.ok) {
      return NextResponse.json({ error: labelDe.error }, { status: 400 });
    }
    const labelEn = parsePricingLabel(row.label_en);
    if (!labelEn.ok) {
      return NextResponse.json({ error: labelEn.error }, { status: 400 });
    }
    const cents = parsePriceNetCents(row.price_net_cents);
    if (!cents.ok) {
      return NextResponse.json({ error: cents.error }, { status: 400 });
    }
    if (typeof row.active !== "boolean") {
      return NextResponse.json({ error: "active must be true or false." }, { status: 400 });
    }

    parsed.push({
      id,
      labelDe: labelDe.label,
      labelEn: labelEn.label,
      priceNetCents: cents.cents,
      active: row.active,
    });
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase admin client is not configured. Set SUPABASE_SERVICE_ROLE_KEY." },
      { status: 503 }
    );
  }

  const { data: existing, error: existingError } = await supabase
    .from("pricing_tier_prices")
    .select("id")
    .in(
      "id",
      parsed.map((row) => row.id)
    );

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 400 });
  }

  const existingIds = new Set((existing ?? []).map((row) => (row as { id: string }).id));
  if (existingIds.size !== parsed.length) {
    return NextResponse.json({ error: "One or more price rows were not found." }, { status: 400 });
  }

  for (const row of parsed) {
    const { error } = await supabase
      .from("pricing_tier_prices")
      .update({
        label_de: row.labelDe,
        label_en: row.labelEn,
        price_net_cents: row.priceNetCents,
        active: row.active,
      })
      .eq("id", row.id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
  }

  const { data, error } = await supabase
    .from("pricing_tier_prices")
    .select("id, tier, item_key, label_de, label_en, unit, price_net_cents, sort_order, active, updated_at")
    .order("sort_order", { ascending: true })
    .order("item_key", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const prices = ((data ?? []) as PriceRow[])
    .map(mapPriceRow)
    .filter((row): row is PricingPriceRecord => row !== null);

  return NextResponse.json({ ok: true, prices });
}
