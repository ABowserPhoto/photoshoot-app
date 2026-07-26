-- Credit note paid flag + uploaded document URL
-- Applied remotely as migration: tasks_credit_note_paid_and_file

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS credit_note_paid boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS credit_note_file_url text NULL;

COMMENT ON COLUMN public.tasks.credit_note_paid IS 'True when a credit-note shoot has been marked paid and the credit note PDF was uploaded to Lexoffice';
COMMENT ON COLUMN public.tasks.credit_note_file_url IS 'Supabase Storage public URL for the uploaded credit note PDF';

UPDATE public.tasks
SET credit_note_paid = true
WHERE is_credit_note = true
  AND is_paid = true
  AND credit_note_paid = false;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'credit-notes',
  'credit-notes',
  true,
  5242880,
  ARRAY['application/pdf']::text[]
)
ON CONFLICT (id) DO NOTHING;
