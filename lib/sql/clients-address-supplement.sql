-- Optional billing address line 2 (Addresszusatz) on CRM clients for Booking Modal autofill.
-- Applied remotely as migration clients_address_supplement.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS address_supplement text;

COMMENT ON COLUMN public.clients.address_supplement IS 'Optional address supplement / line 2 (Addresszusatz)';

DROP VIEW IF EXISTS public.companies;

CREATE VIEW public.companies AS
SELECT
  id,
  company_name AS name,
  company_name,
  COALESCE(billing_street, street) AS billing_street,
  COALESCE(billing_city, city) AS billing_city,
  COALESCE(billing_postal_code, zip_code) AS billing_postal_code,
  COALESCE(billing_country, country) AS billing_country,
  street,
  zip_code,
  city,
  country,
  address_supplement,
  email,
  phone,
  lexoffice_id,
  lexoffice_contact_id,
  contact_persons,
  created_at
FROM public.clients;
