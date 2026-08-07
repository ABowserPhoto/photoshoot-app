-- Post format + Meta native scheduling fields for Social Planner

alter table public.social_posts
  add column if not exists post_type text not null default 'FEED';

alter table public.social_posts
  add column if not exists meta_creation_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'social_posts_post_type_check'
  ) then
    alter table public.social_posts
      add constraint social_posts_post_type_check
      check (post_type = any (array['FEED'::text, 'REEL'::text, 'STORY'::text]));
  end if;
end $$;

comment on column public.social_posts.post_type is
  'Instagram publish format: FEED | REEL | STORY';

comment on column public.social_posts.meta_creation_id is
  'Instagram Graph API media container id when scheduled via Meta (status=scheduled_with_meta)';

-- Status values used by Social Planner:
--   pending | scheduled | scheduled_with_meta | published | failed
-- `scheduled`            → local worker / cron publishes when due
-- `scheduled_with_meta`  → Meta owns publish; local worker must ignore
