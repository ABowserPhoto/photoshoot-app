-- Enable RLS on public.tasks and public.catalog with employee-wide CRUD.
--
-- Design:
-- - authenticated (logged-in Supabase users) may SELECT/INSERT/UPDATE/DELETE all rows.
-- - anon has no policies → PostgREST Data API as anon is denied (empty / RLS reject).
-- - service_role bypasses RLS by default in Supabase (workers, Server Actions, trusted API routes).
-- - Do NOT set FORCE ROW LEVEL SECURITY — table owners / service_role must keep bypass.

-- ---------------------------------------------------------------------------
-- public.tasks
-- ---------------------------------------------------------------------------
alter table public.tasks enable row level security;

drop policy if exists "tasks_select_authenticated" on public.tasks;
create policy "tasks_select_authenticated"
  on public.tasks
  for select
  to authenticated
  using (true);

drop policy if exists "tasks_insert_authenticated" on public.tasks;
create policy "tasks_insert_authenticated"
  on public.tasks
  for insert
  to authenticated
  with check (true);

drop policy if exists "tasks_update_authenticated" on public.tasks;
create policy "tasks_update_authenticated"
  on public.tasks
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "tasks_delete_authenticated" on public.tasks;
create policy "tasks_delete_authenticated"
  on public.tasks
  for delete
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- public.catalog
-- ---------------------------------------------------------------------------
alter table public.catalog enable row level security;

drop policy if exists "catalog_select_authenticated" on public.catalog;
create policy "catalog_select_authenticated"
  on public.catalog
  for select
  to authenticated
  using (true);

drop policy if exists "catalog_insert_authenticated" on public.catalog;
create policy "catalog_insert_authenticated"
  on public.catalog
  for insert
  to authenticated
  with check (true);

drop policy if exists "catalog_update_authenticated" on public.catalog;
create policy "catalog_update_authenticated"
  on public.catalog
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "catalog_delete_authenticated" on public.catalog;
create policy "catalog_delete_authenticated"
  on public.catalog
  for delete
  to authenticated
  using (true);

-- Ensure roles keep table privileges (RLS still filters row access).
grant select, insert, update, delete on public.tasks to authenticated;
grant select, insert, update, delete on public.catalog to authenticated;
grant all on public.tasks to service_role;
grant all on public.catalog to service_role;

comment on table public.tasks is
  'Kanban / CRM photoshoot tasks. RLS: authenticated full CRUD; service_role bypasses RLS.';
comment on table public.catalog is
  'Booking catalog items. RLS: authenticated full CRUD; service_role bypasses RLS.';
