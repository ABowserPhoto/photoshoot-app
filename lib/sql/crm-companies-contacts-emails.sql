-- Company-centric CRM: companies view, contacts, contact_emails, task gallery/CC fields.
-- Applied remotely as migration crm_companies_contacts_emails_gallery (20260717112416).
-- Safe to re-run (IF NOT EXISTS / IF EXISTS guards).

-- Billing columns on clients (companies root table)
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS billing_street text,
  ADD COLUMN IF NOT EXISTS billing_city text,
  ADD COLUMN IF NOT EXISTS billing_postal_code text,
  ADD COLUMN IF NOT EXISTS billing_country text;

COMMENT ON COLUMN public.clients.billing_street IS 'Invoice billing street (falls back to street when null)';
COMMENT ON COLUMN public.clients.billing_city IS 'Invoice billing city';
COMMENT ON COLUMN public.clients.billing_postal_code IS 'Invoice billing postal code';
COMMENT ON COLUMN public.clients.billing_country IS 'Invoice billing country code/name (dynamic; no hardcoded DE)';

-- companies view: thin alias over clients with coalesced billing fields
CREATE OR REPLACE VIEW public.companies AS
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
  email,
  phone,
  lexoffice_id,
  lexoffice_contact_id,
  contact_persons,
  created_at
FROM public.clients;

-- contacts: multiple people per company
CREATE TABLE IF NOT EXISTS public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  first_name text NOT NULL DEFAULT '',
  last_name text NOT NULL DEFAULT '',
  phone text,
  role text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contacts_company_id_idx ON public.contacts (company_id);
CREATE INDEX IF NOT EXISTS contacts_name_idx ON public.contacts (last_name, first_name);

COMMENT ON TABLE public.contacts IS 'Contact persons belonging to a company (clients/companies)';

-- contact_emails: multiple emails per contact, with CC flag
CREATE TABLE IF NOT EXISTS public.contact_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  email text NOT NULL,
  is_cc boolean NOT NULL DEFAULT false,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contact_emails_contact_id_idx ON public.contact_emails (contact_id);
CREATE UNIQUE INDEX IF NOT EXISTS contact_emails_contact_email_uidx
  ON public.contact_emails (contact_id, lower(email));

COMMENT ON TABLE public.contact_emails IS 'Email addresses for a contact; is_cc marks secondary/CC recipients';

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_emails ENABLE ROW LEVEL SECURITY;

-- Task fields for CRM linking + gallery on invoice
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS gallery_link text,
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS email_cc text;

CREATE INDEX IF NOT EXISTS tasks_contact_id_idx ON public.tasks (contact_id);

COMMENT ON COLUMN public.tasks.gallery_link IS 'Client-facing photo gallery URL rendered on the Lexoffice invoice';
COMMENT ON COLUMN public.tasks.contact_id IS 'Selected CRM contact for this booking';
COMMENT ON COLUMN public.tasks.email_cc IS 'Comma-separated CC email addresses for delivery drafts';
