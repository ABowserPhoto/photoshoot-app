-- Optional billing address line 2 (Addresszusatz) for Lexoffice contacts/invoices.
-- Run once in the Supabase SQL editor.

ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS address_supplement text;

COMMENT ON COLUMN public.tasks.address_supplement IS 'Optional address supplement / line 2 (Addresszusatz)';
