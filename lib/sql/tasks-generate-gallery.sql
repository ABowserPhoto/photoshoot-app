-- Opt-out flag for client gallery preview generation (watermarked JPEG pipeline).
-- Applied remotely as migration tasks_generate_gallery.

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS generate_gallery boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.tasks.generate_gallery IS
  'When false, skip client gallery preview generation (watermarked JPEGs / storage uploads) for this booking.';
