-- Social metrics history plus LinkedIn organization links and token metadata.
-- Safe to re-run. Does not delete or rewrite existing rows.
-- Staff access matches social_profiles / social_clients: private.is_staff()
-- (profiles.role in admin|editor, not archived). Client logins are excluded.
-- service_role bypasses RLS. Tokens stay on social_profiles, not in snapshots.

alter table public.social_profiles
  add column if not exists tiktok_token_expires_at timestamptz,
  add column if not exists tiktok_refresh_expires_at timestamptz,
  add column if not exists tiktok_scope text,
  add column if not exists tiktok_display_name text,
  add column if not exists tiktok_username text,
  add column if not exists linkedin_access_token text,
  add column if not exists linkedin_refresh_token text,
  add column if not exists linkedin_token_expires_at timestamptz,
  add column if not exists linkedin_refresh_expires_at timestamptz,
  add column if not exists linkedin_member_id text,
  add column if not exists linkedin_scope text;

alter table public.instagram_connected_accounts
  add column if not exists page_id text;

create table if not exists public.linkedin_connected_organizations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.social_profiles(id) on delete cascade,
  organization_id text not null,
  organization_name text,
  vanity_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, organization_id)
);

create index if not exists linkedin_connected_organizations_profile_id_idx
  on public.linkedin_connected_organizations (profile_id);

create table if not exists public.social_metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.social_clients(id) on delete cascade,
  profile_id uuid references public.social_profiles(id) on delete cascade,
  platform text not null check (platform in ('instagram', 'facebook', 'tiktok', 'linkedin')),
  account_key text not null,
  account_label text,
  kind text not null default 'range' check (kind in ('range', 'daily')),
  snapshot_date date not null,
  range_start date not null,
  range_end date not null,
  metrics jsonb not null default '{}'::jsonb,
  series jsonb not null default '[]'::jsonb,
  top_posts jsonb not null default '[]'::jsonb,
  error text,
  fetched_at timestamptz not null default now(),
  unique (account_key, kind, snapshot_date, range_start, range_end)
);

create index if not exists social_metric_snapshots_client_idx
  on public.social_metric_snapshots (client_id, snapshot_date desc);

create index if not exists social_metric_snapshots_daily_idx
  on public.social_metric_snapshots (account_key, kind, snapshot_date);

alter table public.linkedin_connected_organizations enable row level security;
alter table public.social_metric_snapshots enable row level security;

drop policy if exists "linkedin_connected_organizations_staff_all" on public.linkedin_connected_organizations;
create policy "linkedin_connected_organizations_staff_all"
  on public.linkedin_connected_organizations
  for all
  to public
  using (private.is_staff())
  with check (private.is_staff());

drop policy if exists "social_metric_snapshots_staff_all" on public.social_metric_snapshots;
create policy "social_metric_snapshots_staff_all"
  on public.social_metric_snapshots
  for all
  to public
  using (private.is_staff())
  with check (private.is_staff());

grant select, insert, update, delete on public.linkedin_connected_organizations to anon, authenticated, service_role;
grant select, insert, update, delete on public.social_metric_snapshots to anon, authenticated, service_role;

comment on table public.social_metric_snapshots is
  'Cached social analytics per connected account. RLS: staff via private.is_staff(); service_role bypasses RLS. No tokens.';
comment on table public.linkedin_connected_organizations is
  'LinkedIn organization pages administered by a connected scheduler profile. RLS: staff via private.is_staff().';
