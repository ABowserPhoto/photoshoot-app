-- Sticky-note style messages from Notes → employees
-- Applied remotely as migration: create_employee_messages

CREATE TABLE IF NOT EXISTS public.employee_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content text NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  source_note_id uuid NULL REFERENCES public.notes(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS employee_messages_recipient_unread_idx
  ON public.employee_messages (recipient_id, is_read, created_at ASC);

CREATE INDEX IF NOT EXISTS employee_messages_sender_id_idx
  ON public.employee_messages (sender_id);

CREATE INDEX IF NOT EXISTS employee_messages_source_note_id_idx
  ON public.employee_messages (source_note_id);

COMMENT ON COLUMN public.employee_messages.source_note_id IS
  'Optional link back to the Notes module note this sticky message was sent from';

-- If the table already existed without source_note_id:
ALTER TABLE public.employee_messages
  ADD COLUMN IF NOT EXISTS source_note_id uuid NULL REFERENCES public.notes(id) ON DELETE SET NULL;

COMMENT ON TABLE public.employee_messages IS
  'Async sticky-note messages between admins/employees (shown as moodboard-style popups)';

ALTER TABLE public.employee_messages ENABLE ROW LEVEL SECURITY;

-- Recipients can read their own messages; admins can read all.
DROP POLICY IF EXISTS employee_messages_select ON public.employee_messages;
CREATE POLICY employee_messages_select
  ON public.employee_messages
  FOR SELECT
  TO authenticated
  USING (
    recipient_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- Authenticated users may send as themselves; admins may send as any sender.
DROP POLICY IF EXISTS employee_messages_insert ON public.employee_messages;
CREATE POLICY employee_messages_insert
  ON public.employee_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- Recipients (and admins) can mark messages read / update.
DROP POLICY IF EXISTS employee_messages_update ON public.employee_messages;
CREATE POLICY employee_messages_update
  ON public.employee_messages
  FOR UPDATE
  TO authenticated
  USING (
    recipient_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  )
  WITH CHECK (
    recipient_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

GRANT SELECT, INSERT, UPDATE ON public.employee_messages TO authenticated;
GRANT ALL ON public.employee_messages TO service_role;
