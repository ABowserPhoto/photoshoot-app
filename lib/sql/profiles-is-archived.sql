-- Soft-delete / archive flag for team members who left the company.
-- Profile row is kept so historical assignments and stats still resolve names.

alter table public.profiles
  add column if not exists is_archived boolean not null default false;

comment on column public.profiles.is_archived is
  'When true, user is soft-deleted: no login, hidden from active assignee lists; profile row kept for history.';

create index if not exists profiles_is_archived_idx
  on public.profiles (is_archived)
  where is_archived = false;
