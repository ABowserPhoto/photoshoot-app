-- Invoice workflow fields for native Lexoffice + Google Drive integration.
-- Run once in the Supabase SQL editor.

ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS lexoffice_invoice_id text,
ADD COLUMN IF NOT EXISTS google_drive_link text;

COMMENT ON COLUMN public.tasks.lexoffice_invoice_id IS 'Lexoffice invoice UUID created by finalize-shoot workflow';
COMMENT ON COLUMN public.tasks.google_drive_link IS 'Google Drive folder webViewLink for the shoot deliverables';
