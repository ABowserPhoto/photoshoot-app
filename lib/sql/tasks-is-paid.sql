-- Manual paid flag for CRM / billing dashboard.
-- Run once in Supabase SQL editor if not already applied.

ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS is_paid boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tasks.is_paid IS 'Manually or automatically marked when invoice is paid';
