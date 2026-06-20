-- CRM client profile fields (extends existing clients table).
-- Run once in Supabase SQL editor.

ALTER TABLE public.clients
ADD COLUMN IF NOT EXISTS contact_name text,
ADD COLUMN IF NOT EXISTS email text,
ADD COLUMN IF NOT EXISTS phone text,
ADD COLUMN IF NOT EXISTS billing_address text,
ADD COLUMN IF NOT EXISTS lexoffice_id text;

COMMENT ON COLUMN public.clients.contact_name IS 'Primary contact person for CRM';
COMMENT ON COLUMN public.clients.billing_address IS 'Full billing address text for CRM';
COMMENT ON COLUMN public.clients.lexoffice_id IS 'Lexoffice contact UUID for CRM';
