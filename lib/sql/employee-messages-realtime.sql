-- Applied remotely as migration: employee_messages_realtime
-- Enables live INSERT notifications for sticky employee messages.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'employee_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.employee_messages;
  END IF;
END $$;
