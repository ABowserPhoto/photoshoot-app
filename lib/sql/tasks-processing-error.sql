-- Persist merge/worker failure details so the Kanban board can show why a task
-- landed in "Selection Failed" instead of quietly returning to Selection Available.
-- Run once in Supabase SQL editor (also applied via MCP migration).

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS processing_error text;

COMMENT ON COLUMN public.tasks.processing_error IS
  'Last worker/merge failure message shown on the Kanban board when status is Selection Failed.';
