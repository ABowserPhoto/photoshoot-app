-- Evernote-style notebooks + notes
-- Applied remotely as migration: create_notebooks_and_notes

CREATE TABLE IF NOT EXISTS public.notebooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notebook_id uuid NOT NULL REFERENCES public.notebooks(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Untitled',
  content text NOT NULL DEFAULT '',
  visibility text NOT NULL DEFAULT 'user'
    CHECK (visibility IN ('public', 'user', 'admin_only')),
  moodboard_id uuid NULL REFERENCES public.moodboards(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notes_notebook_id_idx ON public.notes (notebook_id);
CREATE INDEX IF NOT EXISTS notes_updated_at_idx ON public.notes (updated_at DESC);
CREATE INDEX IF NOT EXISTS notes_moodboard_id_idx ON public.notes (moodboard_id);
CREATE INDEX IF NOT EXISTS notes_visibility_idx ON public.notes (visibility);
CREATE UNIQUE INDEX IF NOT EXISTS notes_moodboard_id_unique
  ON public.notes (moodboard_id)
  WHERE moodboard_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS notebooks_updated_at_idx ON public.notebooks (updated_at DESC);

COMMENT ON TABLE public.notebooks IS 'Evernote-style notebooks grouping notes';
COMMENT ON TABLE public.notes IS 'Rich-text notes (HTML content) belonging to a notebook';
COMMENT ON COLUMN public.notes.content IS 'Rich text HTML from Tiptap editor';

ALTER TABLE public.notebooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notebooks_authenticated_all ON public.notebooks;
CREATE POLICY notebooks_authenticated_all
  ON public.notebooks
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS notes_authenticated_all ON public.notes;
CREATE POLICY notes_authenticated_all
  ON public.notes
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
