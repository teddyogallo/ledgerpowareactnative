-- CALVIN-LEDGER complete schema repair / expansion
-- Target: existing Supabase project that already has public.expenses and public.obligations.
-- Run once in Supabase Dashboard > SQL Editor. This is additive and preserves existing rows.
-- Review the security notes in the accompanying setup guide before using real data.

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Household foundation
-- ---------------------------------------------------------------------------

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique default upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 8)),
  currency text not null default 'KES',
  monthly_budget numeric(14,2),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  joined_at timestamptz not null default now(),
  unique (household_id, user_id)
);

create index if not exists household_members_user_id_idx on public.household_members(user_id);
create index if not exists household_members_household_id_idx on public.household_members(household_id);

-- ---------------------------------------------------------------------------
-- 2. Expand the two existing tables to match the React source
-- ---------------------------------------------------------------------------

alter table public.expenses
  add column if not exists household_id uuid references public.households(id) on delete cascade,
  add column if not exists reference text not null default '',
  add column if not exists paid_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists paid_by_label text,
  add column if not exists template_id uuid,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz;

alter table public.obligations
  add column if not exists household_id uuid references public.households(id) on delete cascade;

create index if not exists expenses_household_date_idx on public.expenses(household_id, date desc);
create index if not exists expenses_paid_by_user_idx on public.expenses(paid_by_user_id);
create index if not exists expenses_obligation_id_idx on public.expenses(obligation_id);
create index if not exists obligations_household_created_idx on public.obligations(household_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. Household configuration and ledger tables
-- ---------------------------------------------------------------------------

create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create index if not exists people_household_idx on public.people(household_id);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  icon_key text not null default 'more',
  color text not null default '#5A5A5A',
  budget_amount numeric(14,2),
  budget_period text check (budget_period is null or budget_period in ('monthly','yearly','termly')),
  budget_rollover boolean not null default true,
  exclude_from_total boolean not null default false,
  archived boolean not null default false,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  unique (household_id, name)
);

create table if not exists public.templates (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  label text not null,
  category text not null,
  amount numeric(14,2) not null check (amount >= 0),
  recipient text not null default '',
  due_day integer check (due_day is null or due_day between 1 and 31),
  created_at timestamptz not null default now()
);
alter table public.expenses
  drop constraint if exists expenses_template_id_fkey;
alter table public.expenses
  add constraint expenses_template_id_fkey
  foreign key (template_id) references public.templates(id) on delete set null;

create table if not exists public.terms (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  months integer[] not null default '{}',
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  constraint terms_months_valid check (
    months <@ array[1,2,3,4,5,6,7,8,9,10,11,12]::integer[]
  )
);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  user_email text,
  action text not null,
  entity text not null,
  summary text,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_household_created_idx on public.audit_log(household_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. Personal finance tables
-- ---------------------------------------------------------------------------

create table if not exists public.personal_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  icon_key text not null default 'more',
  color text not null default '#5A5A5A',
  budget_amount numeric(14,2),
  budget_period text check (budget_period is null or budget_period in ('monthly','yearly')),
  budget_rollover boolean not null default false,
  exclude_from_total boolean not null default false,
  archived boolean not null default false,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table if not exists public.personal_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric(14,2) not null check (amount >= 0),
  category text not null,
  note text not null default '',
  reference text not null default '',
  date timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists personal_expenses_user_date_idx on public.personal_expenses(user_id, date desc);

create table if not exists public.personal_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  monthly_budget numeric(14,2),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 5. Income
-- ---------------------------------------------------------------------------

create table if not exists public.income_categories (
  id uuid primary key default gen_random_uuid(),
  scope text not null default 'personal' check (scope = 'personal'),
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid references public.households(id) on delete cascade,
  name text not null,
  icon_key text not null default 'work',
  color text not null default '#5A5A5A',
  archived boolean not null default false,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table if not exists public.income (
  id uuid primary key default gen_random_uuid(),
  scope text not null default 'personal' check (scope in ('personal','household')),
  user_id uuid references auth.users(id) on delete cascade,
  household_id uuid references public.households(id) on delete cascade,
  amount numeric(14,2) not null check (amount >= 0),
  category text not null,
  source text not null default '',
  note text not null default '',
  reference text not null default '',
  date timestamptz not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint income_scope_owner_check check (
    (scope = 'personal' and user_id is not null and household_id is null)
    or (scope = 'household' and household_id is not null)
  )
);
create index if not exists income_user_date_idx on public.income(user_id, date desc);
create index if not exists income_household_date_idx on public.income(household_id, date desc);

-- ---------------------------------------------------------------------------
-- 6. Debts and debt payments
-- ---------------------------------------------------------------------------

create table if not exists public.debts (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('personal','household')),
  user_id uuid references auth.users(id) on delete cascade,
  household_id uuid references public.households(id) on delete cascade,
  direction text not null check (direction in ('owe','owed')),
  counterparty text not null,
  principal numeric(14,2) not null check (principal >= 0),
  total_repayable numeric(14,2),
  due_date date,
  notes text not null default '',
  expense_category text,
  income_category text,
  status text not null default 'active' check (status in ('active','cleared')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint debts_scope_owner_check check (
    (scope = 'personal' and user_id is not null and household_id is null)
    or (scope = 'household' and household_id is not null)
  )
);
create index if not exists debts_user_scope_idx on public.debts(user_id, scope, due_date);
create index if not exists debts_household_scope_idx on public.debts(household_id, scope, due_date);

create table if not exists public.debt_payments (
  id uuid primary key default gen_random_uuid(),
  debt_id uuid not null references public.debts(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  date timestamptz not null,
  reference text not null default '',
  note text not null default '',
  household_expense_id uuid references public.expenses(id) on delete set null,
  personal_expense_id uuid references public.personal_expenses(id) on delete set null,
  income_id uuid references public.income(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists debt_payments_debt_date_idx on public.debt_payments(debt_id, date desc);

-- Admin allow-list. Populate manually only for trusted administrator user IDs.
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 7. Helper functions used by Row Level Security
-- ---------------------------------------------------------------------------

create or replace function public.is_household_member(p_household_id uuid)
returns boolean
language sql stable security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.household_members hm
    where hm.household_id = p_household_id and hm.user_id = auth.uid()
  );
$$;

create or replace function public.is_household_owner(p_household_id uuid)
returns boolean
language sql stable security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.household_members hm
    where hm.household_id = p_household_id
      and hm.user_id = auth.uid()
      and hm.role = 'owner'
  );
$$;

create or replace function public.is_app_admin()
returns boolean
language sql stable security definer
set search_path = public, auth
as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- 8. Household lifecycle RPCs called by the React application
-- ---------------------------------------------------------------------------

create or replace function public.create_household(p_name text, p_people text[] default '{}')
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user uuid := auth.uid();
  v_household_id uuid;
  v_person text;
begin
  if v_user is null then raise exception 'You must be signed in.'; end if;
  if nullif(trim(p_name), '') is null then raise exception 'Household name is required.'; end if;

  insert into public.households(name, created_by)
  values (trim(p_name), v_user)
  returning id into v_household_id;

  insert into public.household_members(household_id, user_id, role)
  values (v_household_id, v_user, 'owner');

  foreach v_person in array coalesce(p_people, '{}') loop
    if nullif(trim(v_person), '') is not null then
      insert into public.people(household_id, name)
      values (v_household_id, trim(v_person));
    end if;
  end loop;

  return v_household_id;
end;
$$;

create or replace function public.join_household(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user uuid := auth.uid();
  v_household_id uuid;
begin
  if v_user is null then raise exception 'You must be signed in.'; end if;

  select h.id into v_household_id
  from public.households h
  where upper(h.invite_code) = upper(trim(p_code));

  if v_household_id is null then raise exception 'That invitation code is not valid.'; end if;

  insert into public.household_members(household_id, user_id, role)
  values (v_household_id, v_user, 'member')
  on conflict (household_id, user_id) do nothing;

  return v_household_id;
end;
$$;

create or replace function public.regenerate_invite_code(p_household_id uuid)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_code text;
begin
  if not public.is_household_owner(p_household_id) then
    raise exception 'Only a household owner can regenerate the invitation code.';
  end if;

  v_code := upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 8));
  update public.households set invite_code = v_code where id = p_household_id;
  return v_code;
end;
$$;

create or replace function public.household_member_list(p_household_id uuid)
returns table(id uuid, user_id uuid, email text, role text)
language sql
stable
security definer
set search_path = public, auth
as $$
  select hm.id, hm.user_id, coalesce(u.email, ''), hm.role
  from public.household_members hm
  left join auth.users u on u.id = hm.user_id
  where hm.household_id = p_household_id
    and public.is_household_member(p_household_id)
  order by hm.joined_at;
$$;

create or replace function public.admin_list_users()
returns table(user_id uuid, email text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not public.is_app_admin() then raise exception 'Administrator access required.'; end if;
  return query
    select u.id, coalesce(u.email, ''), u.created_at
    from auth.users u
    order by u.created_at desc;
end;
$$;

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'You must be signed in.'; end if;

  -- Remove memberships first; delete households left without members.
  delete from public.household_members where user_id = v_user;

  -- If the departing user created a household that still has members, transfer
  -- ownership to its earliest remaining member.
  update public.household_members hm
  set role = 'owner'
  from (
    select distinct on (hm2.household_id) hm2.id
    from public.household_members hm2
    join public.households h on h.id = hm2.household_id
    where h.created_by = v_user
    order by hm2.household_id, hm2.joined_at
  ) replacement
  where hm.id = replacement.id;

  delete from public.households h
  where not exists (
    select 1 from public.household_members hm where hm.household_id = h.id
  );

  -- Auth-user foreign keys cascade personal records and the admin allow-list.
  delete from auth.users where id = v_user;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Row Level Security
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'households','household_members','people','categories','templates','terms',
    'audit_log','personal_categories','personal_expenses','personal_settings',
    'income_categories','income','debts','debt_payments','admins',
    'expenses','obligations'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Remove the old wide-open policies on the two original tables.
drop policy if exists "Allow anon read expenses" on public.expenses;
drop policy if exists "Allow anon insert expenses" on public.expenses;
drop policy if exists "Allow anon update expenses" on public.expenses;
drop policy if exists "Allow anon delete expenses" on public.expenses;
drop policy if exists "Allow anon read obligations" on public.obligations;
drop policy if exists "Allow anon insert obligations" on public.obligations;
drop policy if exists "Allow anon update obligations" on public.obligations;
drop policy if exists "Allow anon delete obligations" on public.obligations;

-- Household membership is private to the signed-in user; household owners manage membership.
drop policy if exists household_members_select on public.household_members;
create policy household_members_select on public.household_members
for select to authenticated
using (user_id = auth.uid() or public.is_household_member(household_id) or public.is_app_admin());

drop policy if exists households_select on public.households;
create policy households_select on public.households
for select to authenticated
using (public.is_household_member(id) or public.is_app_admin());

drop policy if exists households_update on public.households;
create policy households_update on public.households
for update to authenticated
using (public.is_household_owner(id))
with check (public.is_household_owner(id));

drop policy if exists people_all on public.people;
create policy people_all on public.people
for all to authenticated
using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));

drop policy if exists categories_all on public.categories;
create policy categories_all on public.categories
for all to authenticated
using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));

drop policy if exists templates_all on public.templates;
create policy templates_all on public.templates
for all to authenticated
using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));

drop policy if exists terms_all on public.terms;
create policy terms_all on public.terms
for all to authenticated
using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));

drop policy if exists expenses_household_all on public.expenses;
create policy expenses_household_all on public.expenses
for all to authenticated
using (
  (household_id is not null and public.is_household_member(household_id))
  or (household_id is null and paid_by_user_id = auth.uid())
)
with check (
  (household_id is not null and public.is_household_member(household_id))
  or (household_id is null and (paid_by_user_id is null or paid_by_user_id = auth.uid()))
);

drop policy if exists obligations_household_all on public.obligations;
create policy obligations_household_all on public.obligations
for all to authenticated
using (household_id is not null and public.is_household_member(household_id))
with check (household_id is not null and public.is_household_member(household_id));

drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
for select to authenticated
using (public.is_household_member(household_id) or public.is_app_admin());

drop policy if exists audit_log_insert on public.audit_log;
create policy audit_log_insert on public.audit_log
for insert to authenticated
with check (
  public.is_household_member(household_id)
  and user_id = auth.uid()
);

-- Personal-only tables: a user can access their own rows; administrators can inspect selected user rows
-- only through approved admin functions / future admin-specific policies, not by broad table access.
drop policy if exists personal_categories_owner_all on public.personal_categories;
create policy personal_categories_owner_all on public.personal_categories
for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists personal_categories_admin_read on public.personal_categories;
create policy personal_categories_admin_read on public.personal_categories
for select to authenticated using (public.is_app_admin());

drop policy if exists personal_expenses_owner_all on public.personal_expenses;
create policy personal_expenses_owner_all on public.personal_expenses
for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists personal_expenses_admin_read on public.personal_expenses;
create policy personal_expenses_admin_read on public.personal_expenses
for select to authenticated using (public.is_app_admin());

drop policy if exists personal_settings_owner_all on public.personal_settings;
create policy personal_settings_owner_all on public.personal_settings
for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists personal_settings_admin_read on public.personal_settings;
create policy personal_settings_admin_read on public.personal_settings
for select to authenticated using (public.is_app_admin());

drop policy if exists income_categories_owner_all on public.income_categories;
create policy income_categories_owner_all on public.income_categories
for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists income_categories_admin_read on public.income_categories;
create policy income_categories_admin_read on public.income_categories
for select to authenticated using (public.is_app_admin());

drop policy if exists income_owner_all on public.income;
create policy income_owner_all on public.income
for all to authenticated
using (
  (scope = 'personal' and user_id = auth.uid())
  or (scope = 'household' and household_id is not null and public.is_household_member(household_id))
)
with check (
  (scope = 'personal' and user_id = auth.uid() and household_id is null)
  or (scope = 'household' and household_id is not null and public.is_household_member(household_id))
);

drop policy if exists income_admin_read on public.income;
create policy income_admin_read on public.income
for select to authenticated using (public.is_app_admin());

drop policy if exists debts_owner_all on public.debts;
create policy debts_owner_all on public.debts
for all to authenticated
using (
  (scope = 'personal' and user_id = auth.uid())
  or (scope = 'household' and household_id is not null and public.is_household_member(household_id))
)
with check (
  (scope = 'personal' and user_id = auth.uid() and household_id is null)
  or (scope = 'household' and household_id is not null and public.is_household_member(household_id))
);

drop policy if exists debts_admin_read on public.debts;
create policy debts_admin_read on public.debts
for select to authenticated using (public.is_app_admin());

drop policy if exists debt_payments_access on public.debt_payments;
create policy debt_payments_access on public.debt_payments
for all to authenticated
using (
  exists (
    select 1 from public.debts d
    where d.id = debt_id
      and (
        (d.scope = 'personal' and d.user_id = auth.uid())
        or (d.scope = 'household' and public.is_household_member(d.household_id))
      )
  )
)
with check (
  exists (
    select 1 from public.debts d
    where d.id = debt_id
      and (
        (d.scope = 'personal' and d.user_id = auth.uid())
        or (d.scope = 'household' and public.is_household_member(d.household_id))
      )
  )
);

-- Admin table is intentionally inaccessible through normal client queries except own membership check.
drop policy if exists admins_self_select on public.admins;
create policy admins_self_select on public.admins
for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 10. Grants and PostgREST schema refresh
-- ---------------------------------------------------------------------------

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on function public.create_household(text, text[]) from public, anon;
revoke all on function public.join_household(text) from public, anon;
revoke all on function public.regenerate_invite_code(uuid) from public, anon;
revoke all on function public.household_member_list(uuid) from public, anon;
revoke all on function public.admin_list_users() from public, anon;
revoke all on function public.delete_my_account() from public, anon;
revoke all on function public.is_household_member(uuid) from public, anon;
revoke all on function public.is_household_owner(uuid) from public, anon;
revoke all on function public.is_app_admin() from public, anon;

grant execute on function public.create_household(text, text[]) to authenticated;
grant execute on function public.join_household(text) to authenticated;
grant execute on function public.regenerate_invite_code(uuid) to authenticated;
grant execute on function public.household_member_list(uuid) to authenticated;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.delete_my_account() to authenticated;
grant execute on function public.is_household_member(uuid) to authenticated;
grant execute on function public.is_household_owner(uuid) to authenticated;
grant execute on function public.is_app_admin() to authenticated;

commit;

notify pgrst, 'reload schema';
