-- Credit note / self-billing tracking at the photoshoot (task) level.
-- Run in Supabase SQL editor.

ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS is_credit_note boolean NOT NULL DEFAULT false;

ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS expected_revenue numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.tasks.is_credit_note IS 'When true, expected_revenue is tracked for B2B self-billing / credit note clients';
COMMENT ON COLUMN public.tasks.expected_revenue IS 'Expected fee (EUR) for credit-note shoots';
