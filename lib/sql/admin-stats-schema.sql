-- Business statistics schema additions for Supabase
-- Run this once in Supabase SQL editor.

alter table public.tasks
add column if not exists net_revenue numeric(12, 2),
add column if not exists tax_amount numeric(12, 2);

-- Optional explicit lifecycle timestamps used by admin statistics
-- (API also falls back to existing created_at / updated_at when these are not populated)
alter table public.tasks
add column if not exists completed_at timestamptz,
add column if not exists ready_for_review_at timestamptz;
