-- Add contact_persons JSONB array to clients table.
-- Each element: { id: string, name: string, email: string, phone: string, role: string }
-- Run once in Supabase SQL editor.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS contact_persons jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.clients.contact_persons IS 'Array of contact persons for this company: [{id, name, email, phone, role}]';
