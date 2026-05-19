-- Fix: "new row for relation moodboard_elements violates check constraint moodboard_elements_type_check"
-- Run this in Supabase → SQL Editor (or psql) once.
--
-- The app inserts type = 'arrow'; your table CHECK must list it explicitly.
--
-- If DROP fails ("constraint does not exist"), list CHECK names with:
--   SELECT conname FROM pg_constraint
--   WHERE conrelid = 'moodboard_elements'::regclass AND contype = 'c';

ALTER TABLE moodboard_elements
  DROP CONSTRAINT IF EXISTS moodboard_elements_type_check;

ALTER TABLE moodboard_elements
  ADD CONSTRAINT moodboard_elements_type_check
  CHECK (
    type IN (
      'note',
      'color',
      'image',
      'link',
      'video',
      'line',
      'drawing',
      'arrow'
    )
  );
