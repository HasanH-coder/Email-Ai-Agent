alter table public.accounts drop constraint if exists accounts_user_id_fkey;

alter table public.accounts
  add constraint accounts_user_id_fkey
  foreign key (user_id) references auth.users(id)
  on delete cascade;

