-- Ensure authenticated employees can read/write CRM contacts under RLS.
-- Safe to re-run.

alter table public.contacts enable row level security;
alter table public.contact_emails enable row level security;
alter table public.clients enable row level security;

drop policy if exists "contacts_authenticated_all" on public.contacts;
create policy "contacts_authenticated_all"
  on public.contacts
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "contact_emails_authenticated_all" on public.contact_emails;
create policy "contact_emails_authenticated_all"
  on public.contact_emails
  for all
  to authenticated
  using (true)
  with check (true);

-- clients policies may already exist under older names; ensure SELECT at minimum.
drop policy if exists "clients_select_authenticated" on public.clients;
create policy "clients_select_authenticated"
  on public.clients
  for select
  to authenticated
  using (true);

grant select, insert, update, delete on public.contacts to authenticated;
grant select, insert, update, delete on public.contact_emails to authenticated;
grant select, insert, update, delete on public.clients to authenticated;
grant all on public.contacts to service_role;
grant all on public.contact_emails to service_role;
grant all on public.clients to service_role;
