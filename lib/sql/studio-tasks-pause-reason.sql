-- Pause details for studio tasks (notes + working file/link path).
-- Run in Supabase if columns are missing.

ALTER TABLE public.studio_tasks
ADD COLUMN IF NOT EXISTS pause_reason text;

ALTER TABLE public.studio_tasks
ADD COLUMN IF NOT EXISTS file_path text;

COMMENT ON COLUMN public.studio_tasks.pause_reason IS 'Notes captured when a processing task is paused';
COMMENT ON COLUMN public.studio_tasks.file_path IS 'Local path or URL for working/finished files';
