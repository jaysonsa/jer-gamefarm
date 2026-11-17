-- =====================================================================
-- Ex-Monitoring: Database setup para sa Supabase
-- I-paste ang buong file na ito sa Supabase > SQL Editor > New query > Run
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Listahan ng mga email na pinapayagang gumamit ng system
--    (ikaw at ang partner mo lang)
-- ---------------------------------------------------------------------
create table if not exists public.allowed_emails (
  email text primary key
);

alter table public.allowed_emails enable row level security;
-- Walang policy dito sinadya: hindi ito mababasa o mababago mula sa website.
-- Sa Supabase dashboard lang ito puwedeng i-edit.

-- Tinitingnan kung ang naka-login na user ay nasa allowed_emails
create or replace function public.is_allowed()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.allowed_emails
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- ---------------------------------------------------------------------
-- 2. Mga batch (hal. Early Bird, National)
-- ---------------------------------------------------------------------
create table if not exists public.batches (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  batch_type  text not null default 'Early Bird',
  start_date  date,
  chick_count integer check (chick_count is null or chick_count >= 0),
  status      text not null default 'active' check (status in ('active', 'closed')),
  notes       text,
  created_by  text default (auth.jwt() ->> 'email'),
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3. Mga gastos (expenses) per batch
-- ---------------------------------------------------------------------
create table if not exists public.expenses (
  id           uuid primary key default gen_random_uuid(),
  batch_id     uuid not null references public.batches(id) on delete cascade,
  expense_date date not null default current_date,
  category     text not null check (category in ('Feeds', 'Bakuna', 'Gamot', 'Vitamins', 'Rent', 'Sahod', 'Iba pa')),
  item         text not null,
  quantity     numeric check (quantity is null or quantity >= 0),
  unit         text,
  amount       numeric(12, 2) not null check (amount >= 0),
  notes        text,
  paid_by      text,  -- kung sino ang gumastos / nagbayad
  created_by   text default (auth.jwt() ->> 'email'),
  created_at   timestamptz not null default now()
);

create index if not exists expenses_batch_id_idx on public.expenses (batch_id);
create index if not exists expenses_date_idx on public.expenses (expense_date);

-- ---------------------------------------------------------------------
-- 4. Security: mga naka-login na user na nasa allowed_emails lang
--    ang puwedeng magbasa/mag-add/mag-edit/mag-delete
-- ---------------------------------------------------------------------
alter table public.batches  enable row level security;
alter table public.expenses enable row level security;

drop policy if exists "allowed users only" on public.batches;
create policy "allowed users only" on public.batches
  for all to authenticated
  using (public.is_allowed())
  with check (public.is_allowed());

drop policy if exists "allowed users only" on public.expenses;
create policy "allowed users only" on public.expenses
  for all to authenticated
  using (public.is_allowed())
  with check (public.is_allowed());

-- ---------------------------------------------------------------------
-- 5. ILAGAY DITO ANG EMAIL NINYONG DALAWA (palitan bago i-Run)
-- ---------------------------------------------------------------------
insert into public.allowed_emails (email) values
  ('ikaw@example.com'),
  ('partner@example.com')
on conflict do nothing;

-- Optional: mga sample batch (puwedeng burahin ang mga linyang ito)
-- insert into public.batches (name, batch_type, start_date, chick_count)
-- values ('Early Bird - Batch 1', 'Early Bird', current_date, 500),
--        ('National - Batch 1', 'National', current_date, 500);
