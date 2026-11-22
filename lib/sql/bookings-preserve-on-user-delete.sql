-- Keep historical bookings, shifts, and staff messages when an Auth user is removed.
-- Applied remotely as migration preserve_bookings_on_client_login_delete.
-- No existing rows are deleted or updated by this script.

ALTER TABLE public.bookings
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_user_id_fkey;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES auth.users(id)
  ON DELETE SET NULL;

COMMENT ON COLUMN public.bookings.user_id IS
  'Portal user that created the booking. Null when that login was removed; the booking row is kept.';

ALTER TABLE public.user_shifts
  DROP CONSTRAINT IF EXISTS user_shifts_user_id_fkey;

ALTER TABLE public.user_shifts
  ADD CONSTRAINT user_shifts_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES auth.users(id)
  ON DELETE RESTRICT;

ALTER TABLE public.employee_messages
  DROP CONSTRAINT IF EXISTS employee_messages_sender_id_fkey;

ALTER TABLE public.employee_messages
  ADD CONSTRAINT employee_messages_sender_id_fkey
  FOREIGN KEY (sender_id)
  REFERENCES public.profiles(id)
  ON DELETE RESTRICT;

ALTER TABLE public.employee_messages
  DROP CONSTRAINT IF EXISTS employee_messages_recipient_id_fkey;

ALTER TABLE public.employee_messages
  ADD CONSTRAINT employee_messages_recipient_id_fkey
  FOREIGN KEY (recipient_id)
  REFERENCES public.profiles(id)
  ON DELETE RESTRICT;
