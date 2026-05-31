-- Planner task output locations (multi-link support).
-- Backward-compatible with existing `file_path` single-value column.

ALTER TABLE public.studio_tasks
ADD COLUMN IF NOT EXISTS file_locations jsonb;

-- Backfill: if file_locations is empty and file_path exists, seed array with the legacy value.
UPDATE public.studio_tasks
SET file_locations = jsonb_build_array(file_path)
WHERE (file_locations IS NULL OR file_locations = '[]'::jsonb)
  AND file_path IS NOT NULL
  AND btrim(file_path) <> '';

COMMENT ON COLUMN public.studio_tasks.file_locations IS
'Array of local paths/URLs for working/finished task files (jsonb text array).';
