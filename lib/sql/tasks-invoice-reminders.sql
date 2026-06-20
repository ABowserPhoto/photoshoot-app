-- Invoice reminder tracking for Lexoffice + Gmail workflow.
-- Run once in the Supabase SQL editor.

ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS invoice_date timestamptz,
ADD COLUMN IF NOT EXISTS invoice_paid boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS lexoffice_document_file_id text,
ADD COLUMN IF NOT EXISTS invoice_reminder_drafted_at timestamptz;

COMMENT ON COLUMN public.tasks.invoice_date IS 'When the Lexoffice invoice was created/finalized';
COMMENT ON COLUMN public.tasks.invoice_paid IS 'True when Lexoffice reports the invoice as paid';
COMMENT ON COLUMN public.tasks.lexoffice_document_file_id IS 'Lexoffice documentFileId for PDF download/attachments';
COMMENT ON COLUMN public.tasks.invoice_reminder_drafted_at IS 'Last time an AI payment reminder Gmail draft was created';
