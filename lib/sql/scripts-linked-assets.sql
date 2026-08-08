-- Deep CRM links for Screenwriting Studio
-- shoot_id  → workflow photoshoots (public.tasks)
-- project_id → planner tasks (public.studio_tasks)  [retargeted from tasks]
-- moodboard_id → public.moodboards

alter table public.scripts
  add column if not exists shoot_id uuid null,
  add column if not exists moodboard_id uuid null;

-- Preserve any existing project_id values that pointed at workflow tasks.
update public.scripts
set shoot_id = project_id
where project_id is not null
  and shoot_id is null;

-- Clear project_id before retargeting FK to studio_tasks.
update public.scripts
set project_id = null
where project_id is not null;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'scripts_project_id_fkey'
      and conrelid = 'public.scripts'::regclass
  ) then
    alter table public.scripts drop constraint scripts_project_id_fkey;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'scripts_shoot_id_fkey'
      and conrelid = 'public.scripts'::regclass
  ) then
    alter table public.scripts
      add constraint scripts_shoot_id_fkey
      foreign key (shoot_id) references public.tasks (id) on delete set null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'scripts_moodboard_id_fkey'
      and conrelid = 'public.scripts'::regclass
  ) then
    alter table public.scripts
      add constraint scripts_moodboard_id_fkey
      foreign key (moodboard_id) references public.moodboards (id) on delete set null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'scripts_project_id_fkey'
      and conrelid = 'public.scripts'::regclass
  ) then
    alter table public.scripts
      add constraint scripts_project_id_fkey
      foreign key (project_id) references public.studio_tasks (id) on delete set null;
  end if;
end $$;

create index if not exists scripts_shoot_id_idx on public.scripts (shoot_id);
create index if not exists scripts_moodboard_id_idx on public.scripts (moodboard_id);
create index if not exists scripts_project_id_idx on public.scripts (project_id);

comment on column public.scripts.shoot_id is 'Nullable FK to public.tasks (Workflow / Kanban photoshoot)';
comment on column public.scripts.project_id is 'Nullable FK to public.studio_tasks (Planner task)';
comment on column public.scripts.moodboard_id is 'Nullable FK to public.moodboards';
