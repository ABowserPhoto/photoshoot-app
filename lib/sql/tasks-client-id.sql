-- Link Kanban tasks to CRM client profiles (used by client merge/delete).
-- Run once in Supabase SQL editor.

ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS tasks_client_id_idx ON public.tasks (client_id);

COMMENT ON COLUMN public.tasks.client_id IS 'FK to clients.id for CRM client manager merge/delete';
