-- Screenwriting Studio: Fountain scripts linked to CRM photoshoot tasks

create table if not exists public.scripts (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Untitled Script',
  content text not null default '',
  project_id uuid null references public.tasks (id) on delete set null,
  status text not null default 'Idea',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scripts_status_check
    check (status = any (array[
      'Idea'::text,
      'Drafting'::text,
      'Ready'::text,
      'In Production'::text
    ]))
);

create index if not exists scripts_updated_at_idx on public.scripts (updated_at desc);
create index if not exists scripts_project_id_idx on public.scripts (project_id);
create index if not exists scripts_status_idx on public.scripts (status);

comment on table public.scripts is
  'Screenwriting Studio Fountain scripts; optional project_id links to public.tasks (CRM photoshoots)';
comment on column public.scripts.content is 'Fountain plain-text source';
comment on column public.scripts.project_id is 'Nullable FK to public.tasks (CRM project / photoshoot)';
comment on column public.scripts.status is 'Idea | Drafting | Ready | In Production';

create or replace function public.set_scripts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists scripts_set_updated_at on public.scripts;
create trigger scripts_set_updated_at
  before update on public.scripts
  for each row
  execute function public.set_scripts_updated_at();

alter table public.scripts enable row level security;

drop policy if exists "scripts_select_authenticated" on public.scripts;
create policy "scripts_select_authenticated"
  on public.scripts for select
  to authenticated
  using (true);

drop policy if exists "scripts_insert_authenticated" on public.scripts;
create policy "scripts_insert_authenticated"
  on public.scripts for insert
  to authenticated
  with check (true);

drop policy if exists "scripts_update_authenticated" on public.scripts;
create policy "scripts_update_authenticated"
  on public.scripts for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "scripts_delete_authenticated" on public.scripts;
create policy "scripts_delete_authenticated"
  on public.scripts for delete
  to authenticated
  using (true);

grant select, insert, update, delete on public.scripts to authenticated;
grant all on public.scripts to service_role;
