-- Productivity stats: track which auth user completed each task type.
-- Run once in Supabase SQL editor if columns are missing.

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS editor_id uuid REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS tasks_editor_id_idx ON public.tasks (editor_id);
CREATE INDEX IF NOT EXISTS tasks_completed_at_idx ON public.tasks (completed_at);

ALTER TABLE public.studio_tasks
  ADD COLUMN IF NOT EXISTS editor_id uuid REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS studio_tasks_editor_id_idx ON public.studio_tasks (editor_id);
CREATE INDEX IF NOT EXISTS studio_tasks_completed_at_idx ON public.studio_tasks (completed_at);

-- Optional backfill for studio_tasks from legacy assignee field (profiles.id may differ from auth.users.id):
-- UPDATE public.studio_tasks SET editor_id = assigned_to::uuid WHERE editor_id IS NULL AND assigned_to IS NOT NULL;
