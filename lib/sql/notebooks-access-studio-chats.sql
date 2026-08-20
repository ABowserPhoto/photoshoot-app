-- Notebook ACL, system notebook, Studio Chats seed
-- Applied remotely as migration: notebooks_access_and_studio_chats

ALTER TABLE public.notebooks
  ADD COLUMN IF NOT EXISTS creator_id uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.notebooks
  ADD COLUMN IF NOT EXISTS access_level text NOT NULL DEFAULT 'all';

ALTER TABLE public.notebooks
  DROP CONSTRAINT IF EXISTS notebooks_access_level_check;

ALTER TABLE public.notebooks
  ADD CONSTRAINT notebooks_access_level_check
  CHECK (access_level IN ('all', 'admin_only', 'specific'));

ALTER TABLE public.notebooks
  ADD COLUMN IF NOT EXISTS assigned_user_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

ALTER TABLE public.notebooks
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS notebooks_creator_id_idx ON public.notebooks (creator_id);
CREATE INDEX IF NOT EXISTS notebooks_access_level_idx ON public.notebooks (access_level);
CREATE UNIQUE INDEX IF NOT EXISTS notebooks_one_system_idx
  ON public.notebooks (is_system)
  WHERE is_system = true;

COMMENT ON COLUMN public.notebooks.creator_id IS 'Profile that created the notebook';
COMMENT ON COLUMN public.notebooks.access_level IS 'all | admin_only | specific';
COMMENT ON COLUMN public.notebooks.assigned_user_ids IS 'When access_level=specific, users granted access';
COMMENT ON COLUMN public.notebooks.is_system IS 'Immutable system notebook (Studio Chats); cannot rename/delete';

-- Promote existing Chats / Studio Chats to the permanent system notebook.
UPDATE public.notebooks
SET
  name = 'Studio Chats',
  is_system = true,
  access_level = 'all',
  assigned_user_ids = '{}'::uuid[],
  updated_at = now()
WHERE is_system = false
  AND lower(trim(name)) IN ('chats', 'studio chats')
  AND NOT EXISTS (SELECT 1 FROM public.notebooks n2 WHERE n2.is_system = true);

INSERT INTO public.notebooks (name, access_level, assigned_user_ids, is_system, created_at, updated_at)
SELECT 'Studio Chats', 'all', '{}'::uuid[], true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM public.notebooks WHERE is_system = true);

-- Tighten RLS: keep authenticated access but block delete/update of system notebooks at DB layer.
DROP POLICY IF EXISTS notebooks_authenticated_all ON public.notebooks;

DROP POLICY IF EXISTS notebooks_select_authenticated ON public.notebooks;
CREATE POLICY notebooks_select_authenticated
  ON public.notebooks
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    OR creator_id = auth.uid()
    OR access_level = 'all'
    OR (
      access_level = 'specific'
      AND auth.uid() = ANY (assigned_user_ids)
    )
    OR is_system = true
  );

DROP POLICY IF EXISTS notebooks_insert_authenticated ON public.notebooks;
CREATE POLICY notebooks_insert_authenticated
  ON public.notebooks
  FOR INSERT
  TO authenticated
  WITH CHECK (
    is_system = false
    AND (creator_id IS NULL OR creator_id = auth.uid())
  );

DROP POLICY IF EXISTS notebooks_update_authenticated ON public.notebooks;
CREATE POLICY notebooks_update_authenticated
  ON public.notebooks
  FOR UPDATE
  TO authenticated
  USING (
    is_system = false
    AND (
      EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
      OR creator_id = auth.uid()
    )
  )
  WITH CHECK (is_system = false);

DROP POLICY IF EXISTS notebooks_delete_authenticated ON public.notebooks;
CREATE POLICY notebooks_delete_authenticated
  ON public.notebooks
  FOR DELETE
  TO authenticated
  USING (
    is_system = false
    AND (
      EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
      OR (
        creator_id = auth.uid()
        AND NOT EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = notebooks.creator_id AND p.role = 'admin'
        )
      )
    )
  );
