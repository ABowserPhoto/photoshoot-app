-- Notes visibility + moodboard bidirectional link
-- Applied remotely as migration: notes_visibility_and_moodboard_link

ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS moodboard_id uuid NULL;

ALTER TABLE public.notes
  DROP CONSTRAINT IF EXISTS notes_visibility_check;
ALTER TABLE public.notes
  ADD CONSTRAINT notes_visibility_check
  CHECK (visibility IN ('public', 'user', 'admin_only'));

ALTER TABLE public.notes
  DROP CONSTRAINT IF EXISTS notes_moodboard_id_fkey;
ALTER TABLE public.notes
  ADD CONSTRAINT notes_moodboard_id_fkey
  FOREIGN KEY (moodboard_id) REFERENCES public.moodboards(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS notes_moodboard_id_idx ON public.notes (moodboard_id);
CREATE INDEX IF NOT EXISTS notes_visibility_idx ON public.notes (visibility);

CREATE UNIQUE INDEX IF NOT EXISTS notes_moodboard_id_unique
  ON public.notes (moodboard_id)
  WHERE moodboard_id IS NOT NULL;

COMMENT ON COLUMN public.notes.visibility IS 'Access level: public | user | admin_only';
COMMENT ON COLUMN public.notes.moodboard_id IS 'Optional linked moodboard for bidirectional navigation';
