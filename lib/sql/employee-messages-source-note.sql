-- Applied remotely as migration: employee_messages_source_note_id
-- Links sticky messages back to the Notes module note they were sent from.

ALTER TABLE public.employee_messages
  ADD COLUMN IF NOT EXISTS source_note_id uuid NULL REFERENCES public.notes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS employee_messages_source_note_id_idx
  ON public.employee_messages (source_note_id);

COMMENT ON COLUMN public.employee_messages.source_note_id IS
  'Optional link back to the Notes module note this sticky message was sent from';
