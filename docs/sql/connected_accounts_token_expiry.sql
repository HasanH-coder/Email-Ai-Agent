-- Add token expiry tracking for Gmail and Outlook connected accounts.
-- Apply this in Supabase SQL editor before deploying the resilience changes.

begin;

alter table public.connected_accounts
  add column if not exists provider_token_expires_at timestamptz;

create index if not exists connected_accounts_provider_token_expires_at_idx
  on public.connected_accounts (provider, provider_token_expires_at);

commit;
