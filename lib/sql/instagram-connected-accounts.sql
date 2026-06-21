-- Stores every Instagram Business account linked via Meta OAuth for a scheduler profile.
-- Run in Supabase SQL editor (or your migration pipeline).

create table if not exists public.instagram_connected_accounts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.social_profiles(id) on delete cascade,
  ig_account_id text not null,
  ig_username text,
  page_name text,
  access_token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, ig_account_id)
);

create index if not exists instagram_connected_accounts_profile_id_idx
  on public.instagram_connected_accounts (profile_id);
