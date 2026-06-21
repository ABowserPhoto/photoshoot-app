-- Publish / schedule status for social scheduler posts.

alter table public.social_posts
  add column if not exists status text not null default 'pending';

alter table public.social_posts
  add column if not exists publish_error text;
