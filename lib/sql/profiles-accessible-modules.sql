-- Module-level permissions for Staff (non-admin) users.
alter table public.profiles
  add column if not exists accessible_modules text[] not null default '{}';

comment on column public.profiles.accessible_modules is
  'App module keys Staff may access (planner, workflow, social_scheduler, ai_studio, moodboard, notes, scripts, booking, statistics, crm). Admins ignore this and always have full access.';

-- Preserve prior Staff access for existing editor profiles (empty = no modules for new Staff until granted).
update public.profiles
set accessible_modules = array[
  'planner',
  'workflow',
  'social_scheduler',
  'ai_studio',
  'moodboard',
  'notes',
  'scripts',
  'booking'
]::text[]
where coalesce(role, '') <> 'admin'
  and (accessible_modules is null or cardinality(accessible_modules) = 0);
