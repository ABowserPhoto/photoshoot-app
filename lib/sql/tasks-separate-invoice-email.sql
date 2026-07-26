-- Separate invoice email override per photoshoot (task).
-- Applied remotely as migration: tasks_separate_invoice_email

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS has_separate_invoice_email boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS invoice_email_address text NULL;

COMMENT ON COLUMN public.tasks.has_separate_invoice_email IS 'When true, gallery delivery and invoice emails are drafted separately';
COMMENT ON COLUMN public.tasks.invoice_email_address IS 'Invoice-only recipient email when has_separate_invoice_email is true';
