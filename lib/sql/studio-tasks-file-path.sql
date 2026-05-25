-- Planner task output path (already used by the app as `file_path`).
-- Run only if the column is missing in your Supabase project.

ALTER TABLE public.studio_tasks
ADD COLUMN IF NOT EXISTS file_path text;

COMMENT ON COLUMN public.studio_tasks.file_path IS 'Local folder or file path for finished deliverables';
