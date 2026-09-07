-- Per-note access control (mirrors notebooks.access_level + assigned_user_ids)
-- Applied remotely as migration: notes_access_level

ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS creator_id uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS access_level text NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS assigned_user_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

ALTER TABLE public.notes
  DROP CONSTRAINT IF EXISTS notes_access_level_check;
ALTER TABLE public.notes
  ADD CONSTRAINT notes_access_level_check
  CHECK (access_level IN ('all', 'admin_only', 'specific'));

-- Map legacy visibility enum into access_level
UPDATE public.notes
SET access_level = 'admin_only'
WHERE access_level = 'all' AND visibility = 'admin_only';

CREATE INDEX IF NOT EXISTS notes_access_level_idx ON public.notes (access_level);
CREATE INDEX IF NOT EXISTS notes_assigned_user_ids_gin ON public.notes USING gin (assigned_user_ids);
CREATE INDEX IF NOT EXISTS notes_creator_id_idx ON public.notes (creator_id);

COMMENT ON COLUMN public.notes.access_level IS 'all | admin_only | specific — same semantics as notebooks.access_level';
COMMENT ON COLUMN public.notes.assigned_user_ids IS 'When access_level = specific, only these profile ids (plus admins/creator) may view the note';
