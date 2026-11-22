-- Client pricing tiers for the website booking form.
-- Additive: existing clients keep pricing_tier NULL until staff assign one.
-- A NULL tier means that client sees no prices.
-- Applied remotely as migration pricing_tier_prices.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS pricing_tier text;

ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_pricing_tier_check;

ALTER TABLE public.clients
  ADD CONSTRAINT clients_pricing_tier_check
  CHECK (pricing_tier IN ('standard', 'legacy', 'corporate'));

COMMENT ON COLUMN public.clients.pricing_tier IS
  'Booking price tier: standard, legacy, or corporate. NULL shows no prices. Staff-assigned only.';

-- Portal users cannot change is_approved or pricing_tier.
-- Staff JWTs and the server service role can.
CREATE OR REPLACE FUNCTION private.preserve_client_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.role() = 'service_role' or private.is_staff() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.pricing_tier := null;
    return new;
  end if;

  new.is_approved := old.is_approved;
  new.pricing_tier := old.pricing_tier;
  return new;
end;
$function$;

DROP TRIGGER IF EXISTS preserve_client_approval ON public.clients;

CREATE TRIGGER preserve_client_approval
  BEFORE INSERT OR UPDATE ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION private.preserve_client_approval();

-- Client self-inserts stay unapproved and cannot choose a tier.
-- Staff inserts still pass clients_insert_staff (private.is_staff()).
DROP POLICY IF EXISTS "Clients can insert own client record" ON public.clients;

CREATE POLICY "Clients can insert own client record"
  ON public.clients
  FOR INSERT
  TO public
  WITH CHECK (
    user_id = auth.uid()
    AND is_approved = false
    AND pricing_tier IS NULL
  );

CREATE TABLE IF NOT EXISTS public.pricing_tier_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tier text NOT NULL,
  item_key text NOT NULL,
  label_de text,
  label_en text,
  unit text NOT NULL DEFAULT 'flat',
  price_net_cents integer,
  sort_order integer,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pricing_tier_prices_tier_check
    CHECK (tier IN ('standard', 'legacy', 'corporate')),
  CONSTRAINT pricing_tier_prices_unit_check
    CHECK (unit IN ('flat', 'per_photo')),
  CONSTRAINT pricing_tier_prices_price_net_cents_check
    CHECK (price_net_cents IS NULL OR price_net_cents >= 0),
  CONSTRAINT pricing_tier_prices_tier_item_key_key
    UNIQUE (tier, item_key)
);

COMMENT ON TABLE public.pricing_tier_prices IS
  'Net prices (cents, excl. VAT) per pricing tier and booking item. NULL price_net_cents means Preis auf Anfrage. RLS: staff via private.is_staff() have full access; an authenticated approved client may select active rows for their own clients.pricing_tier only; anon has no grant and no policy.';

COMMENT ON COLUMN public.pricing_tier_prices.price_net_cents IS
  'Net price in euro cents, excluding VAT. NULL means Preis auf Anfrage.';

COMMENT ON COLUMN public.pricing_tier_prices.unit IS
  'flat or per_photo.';

CREATE INDEX IF NOT EXISTS pricing_tier_prices_tier_active_sort_idx
  ON public.pricing_tier_prices (tier, active, sort_order);

CREATE OR REPLACE FUNCTION public.set_pricing_tier_prices_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;

DROP TRIGGER IF EXISTS pricing_tier_prices_set_updated_at ON public.pricing_tier_prices;

CREATE TRIGGER pricing_tier_prices_set_updated_at
  BEFORE UPDATE ON public.pricing_tier_prices
  FOR EACH ROW
  EXECUTE FUNCTION public.set_pricing_tier_prices_updated_at();

ALTER TABLE public.pricing_tier_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pricing_tier_prices_staff_all ON public.pricing_tier_prices;
CREATE POLICY pricing_tier_prices_staff_all
  ON public.pricing_tier_prices
  FOR ALL
  TO authenticated
  USING (private.is_staff())
  WITH CHECK (private.is_staff());

DROP POLICY IF EXISTS pricing_tier_prices_select_own_tier ON public.pricing_tier_prices;
CREATE POLICY pricing_tier_prices_select_own_tier
  ON public.pricing_tier_prices
  FOR SELECT
  TO authenticated
  USING (
    active IS TRUE
    AND EXISTS (
      SELECT 1
      FROM public.clients AS client_profile
      WHERE client_profile.user_id = auth.uid()
        AND client_profile.is_approved IS TRUE
        AND client_profile.pricing_tier IS NOT NULL
        AND client_profile.pricing_tier = pricing_tier_prices.tier
    )
  );

-- Anon gets nothing. Authenticated writes stay behind RLS (staff only).
-- TRUNCATE is not covered by RLS, so it is not granted.
REVOKE ALL ON TABLE public.pricing_tier_prices FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pricing_tier_prices TO authenticated;
GRANT ALL ON TABLE public.pricing_tier_prices TO service_role;

-- Seed every item for all three tiers. Standard prices are net cents from Aaron's list.
-- Every other Standard item, and all Legacy and Corporate items, stay NULL (auf Anfrage).
-- Re-running does not overwrite prices staff have edited.
INSERT INTO public.pricing_tier_prices (
  tier,
  item_key,
  label_de,
  label_en,
  unit,
  price_net_cents,
  sort_order
)
SELECT
  tiers.tier,
  items.item_key,
  items.label_de,
  items.label_en,
  items.unit,
  CASE
    WHEN tiers.tier = 'standard' THEN items.standard_price_net_cents
    ELSE NULL
  END,
  items.sort_order
FROM (
  VALUES
    ('standard'::text),
    ('legacy'),
    ('corporate')
) AS tiers(tier)
CROSS JOIN (
  VALUES
    ('photo_package_10'::text, '10 Fotos', '10 photos', 'flat'::text, 12900::integer, 10),
    ('photo_package_15', '15 Fotos', '15 photos', 'flat', 18900, 20),
    ('photo_package_25', '25 Fotos', '25 photos', 'flat', 22900, 30),
    ('photo_package_30', '30 Fotos', '30 photos', 'flat', NULL::integer, 40),
    ('photo_package_40', '40 Fotos', '40 photos', 'flat', NULL::integer, 50),
    ('photo_package_50', '50 Fotos', '50 photos', 'flat', NULL::integer, 60),
    ('individual_photo', 'Einzelfoto', 'Individual photo', 'per_photo', NULL::integer, 70),
    ('booking_fee', 'Buchungsgebühr', 'Booking fee', 'flat', 1900, 80),
    ('drone_photos', 'Drohnenfotos', 'Drone photos', 'flat', 4900, 90),
    ('drone_video', 'Drohnenvideo', 'Drone video', 'flat', 19000, 100),
    ('highlight_video', 'Highlight-Video', 'Highlight video', 'flat', 29000, 110),
    ('walk_thru_video', 'Walk-Through-Video', 'Walk-through video', 'flat', NULL::integer, 120),
    ('agent_branding_video', 'Makler-Branding-Video', 'Agent branding video', 'flat', NULL::integer, 130),
    ('premium_home_package', 'Premium-Home-Paket', 'Premium home package', 'flat', NULL::integer, 140),
    ('luxury_makler_package', 'Luxury-Makler-Paket', 'Luxury agent package', 'flat', NULL::integer, 150),
    ('tour_360', '360°-Tour', '360° tour', 'flat', NULL::integer, 160),
    ('homestaging', 'Homestaging', 'Home staging', 'per_photo', 3500, 170)
) AS items(item_key, label_de, label_en, unit, standard_price_net_cents, sort_order)
ON CONFLICT (tier, item_key) DO NOTHING;
