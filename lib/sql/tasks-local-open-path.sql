-- Add local_open_path for manually-set full filesystem paths used to open a shoot
-- folder/file directly in Photoshop, Lightroom Classic, or Capture One.
-- Run once in Supabase SQL editor.

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS local_open_path text;

COMMENT ON COLUMN public.tasks.local_open_path IS 'Full local/network path used to open this shoot in external software (e.g. Z:\Shoots\Smith_Apartment)';
