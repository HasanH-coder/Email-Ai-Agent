-- Cleanup and hardening for connected_accounts OAuth token persistence.
-- Apply this in Supabase SQL editor before deploying the app changes.

begin;

update public.connected_accounts
set email = ''
where provider in ('gmail', 'outlook')
  and email is null;

do $$
declare
  order_expr text :=
    'CASE WHEN provider_access_token IS NOT NULL THEN 1 ELSE 0 END DESC, ' ||
    'CASE WHEN provider_refresh_token IS NOT NULL THEN 1 ELSE 0 END DESC';
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'connected_accounts'
      and column_name = 'updated_at'
  ) then
    order_expr := order_expr || ', updated_at DESC NULLS LAST';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'connected_accounts'
      and column_name = 'created_at'
  ) then
    order_expr := order_expr || ', created_at DESC NULLS LAST';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'connected_accounts'
      and column_name = 'id'
  ) then
    order_expr := order_expr || ', id DESC NULLS LAST';
  end if;

  execute format(
    $sql$
      with ranked as (
        select
          ctid,
          row_number() over (
            partition by user_id, provider, email
            order by %s
          ) as row_num
        from public.connected_accounts
        where provider in ('gmail', 'outlook')
      )
      delete from public.connected_accounts target
      using ranked
      where target.ctid = ranked.ctid
        and ranked.row_num > 1
    $sql$,
    order_expr
  );
end $$;

create unique index if not exists connected_accounts_user_provider_email_uidx
  on public.connected_accounts (user_id, provider, email);

create or replace function public.guard_connected_account_token_clears()
returns trigger
language plpgsql
as $$
declare
  allow_token_clear boolean := coalesce(
    current_setting('app.connected_accounts_allow_token_clear', true) in ('on', 'true', '1'),
    false
  );
begin
  if new.provider not in ('gmail', 'outlook') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.provider_access_token is null and not allow_token_clear then
      raise exception 'connected_accounts token guard rejected % insert with null access token', new.provider;
    end if;
    return new;
  end if;

  if old.provider_access_token is not null
     and new.provider_access_token is null
     and not allow_token_clear then
    raise exception 'connected_accounts token guard rejected % access token clear without explicit disconnect', new.provider;
  end if;

  if old.provider_refresh_token is not null
     and new.provider_refresh_token is null
     and not allow_token_clear then
    raise exception 'connected_accounts token guard rejected % refresh token clear without explicit disconnect', new.provider;
  end if;

  return new;
end;
$$;

drop trigger if exists connected_accounts_token_clear_guard on public.connected_accounts;

create trigger connected_accounts_token_clear_guard
before insert or update on public.connected_accounts
for each row
execute function public.guard_connected_account_token_clears();

commit;
