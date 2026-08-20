-- Enable Realtime for studio_tasks so per-user planner / timer widgets can subscribe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'studio_tasks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.studio_tasks;
  END IF;
END $$;
