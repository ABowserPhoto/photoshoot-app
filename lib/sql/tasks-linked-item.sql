-- Add linked_item_id to tasks for linking a task to another task/photoshoot.
-- Self-referencing FK: SET NULL on delete so linked tasks are not cascaded.
-- Run once in Supabase SQL editor.

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS linked_item_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS tasks_linked_item_id_idx ON public.tasks (linked_item_id);

COMMENT ON COLUMN public.tasks.linked_item_id IS 'Optional FK to another tasks.id (e.g. link an editing task to its photoshoot booking)';
