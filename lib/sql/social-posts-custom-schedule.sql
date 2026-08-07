-- Marks posts whose scheduled_at was set manually in the Social Planner modal.
-- Auto "Calculate Schedule" skips these rows so custom times are preserved.

alter table public.social_posts
  add column if not exists is_custom_schedule boolean not null default false;

comment on column public.social_posts.is_custom_schedule is
  'When true, scheduled_at was set manually and should not be overwritten by auto-schedule.';
