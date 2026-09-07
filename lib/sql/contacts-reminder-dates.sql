-- Track each AI payment-reminder draft on the CRM contact.
-- Safe to re-run.

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS reminder_dates timestamptz[] NOT NULL DEFAULT '{}'::timestamptz[];

COMMENT ON COLUMN public.contacts.reminder_dates IS
  'Timestamps when AI payment reminder emails were drafted for this contact';
