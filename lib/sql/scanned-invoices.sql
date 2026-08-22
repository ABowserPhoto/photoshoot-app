-- Deduplication store for Gmail -> Lexoffice invoice scanner.
-- Run once in the Supabase SQL editor (or via Supabase CLI migration).

create table if not exists public.scanned_invoices (
  id uuid primary key default gen_random_uuid(),
  gmail_message_id text not null,
  processed_at timestamptz not null default timezone('utc'::text, now()),
  file_name text not null,
  lexoffice_file_id text,
  constraint scanned_invoices_gmail_message_id_key unique (gmail_message_id)
);

create index if not exists scanned_invoices_processed_at_idx
  on public.scanned_invoices (processed_at desc);

alter table public.scanned_invoices enable row level security;

comment on table public.scanned_invoices is
  'Gmail message ids already uploaded to Lexoffice by the invoice scanner.';
comment on column public.scanned_invoices.gmail_message_id is
  'Gmail API message id (unique per mailbox).';
comment on column public.scanned_invoices.lexoffice_file_id is
  'Lexoffice POST /v1/files response id.';
