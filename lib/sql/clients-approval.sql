-- Portal signups insert their own clients row with is_approved = false.
-- Staff-created and Lexoffice-synced clients are approved. Historical CRM rows
-- had no user_id, so they are not waiting on the Client Manager approval queue.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS company_address text,
  ADD COLUMN IF NOT EXISTS phone_number text,
  ADD COLUMN IF NOT EXISTS is_approved boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.clients.is_approved IS 'False for portal signups waiting on Client Manager approval';

-- Portal users cannot change is_approved. Staff JWTs and the server service role can.
CREATE OR REPLACE FUNCTION private.preserve_client_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.role() = 'service_role' or private.is_staff() then
    return new;
  end if;
  new.is_approved := old.is_approved;
  return new;
end;
$function$;

UPDATE public.clients
SET is_approved = true
WHERE user_id IS NULL
  AND is_approved = false;
