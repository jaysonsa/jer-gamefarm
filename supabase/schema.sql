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
  period_start date,  -- para sa Rent: simula ng saklaw na binayaran
  period_end   date,  -- para sa Rent: katapusan ng saklaw
  constraint expenses_period_check check (period_start is null or period_end is null or period_end >= period_start),
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
-- 4b. Culled at Wingband
-- ---------------------------------------------------------------------
-- Mga culled: markings at ilan
create table if not exists public.culls (
  id          uuid primary key default gen_random_uuid(),
  batch_id    uuid not null references public.batches(id) on delete cascade,
  cull_date   date not null default current_date,
  markings    text not null,
  quantity    integer not null check (quantity > 0),
  notes       text,
  created_by  text default (auth.jwt() ->> 'email'),
  created_at  timestamptz not null default now()
);
create index if not exists culls_batch_id_idx on public.culls (batch_id);

-- Mga wingband: number at markings ng bawat manok
create table if not exists public.wingbands (
  id           uuid primary key default gen_random_uuid(),
  batch_id     uuid not null references public.batches(id) on delete cascade,
  wingband_no  text not null,
  markings     text,
  notes        text,
  created_by   text default (auth.jwt() ->> 'email'),
  created_at   timestamptz not null default now(),
  unique (batch_id, wingband_no)
);
create index if not exists wingbands_batch_id_idx on public.wingbands (batch_id);

-- Security: kayong dalawa lang (nasa allowed_emails)
alter table public.culls     enable row level security;
alter table public.wingbands enable row level security;

drop policy if exists "allowed users only" on public.culls;
create policy "allowed users only" on public.culls
  for all to authenticated
  using (public.is_allowed())
  with check (public.is_allowed());

drop policy if exists "allowed users only" on public.wingbands;
create policy "allowed users only" on public.wingbands
  for all to authenticated
  using (public.is_allowed())
  with check (public.is_allowed());

-- ---------------------------------------------------------------------
-- 4c. Editor at Viewer
-- ---------------------------------------------------------------------
-- Role ng bawat email (default: viewer, para ligtas ang bagong idadagdag)
alter table public.allowed_emails
  add column if not exists role text not null default 'viewer'
  check (role in ('editor', 'viewer'));

-- 3. Tinitingnan kung editor ang naka-login
create or replace function public.is_editor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.allowed_emails
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and role = 'editor'
  );
$$;

-- 4. Para malaman ng website kung editor o viewer ang naka-login
create or replace function public.my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.allowed_emails
  where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1;
$$;

grant execute on function public.my_role() to authenticated;

-- Security rules: lahat ng allowed ay puwedeng tumingin, editor lang ang puwedeng magbago
do $$
declare t text;
begin
  foreach t in array array['batches', 'expenses', 'culls', 'wingbands'] loop
    execute format('drop policy if exists "allowed users only" on public.%I', t);
    execute format('drop policy if exists "allowed can view" on public.%I', t);
    execute format('drop policy if exists "editor can insert" on public.%I', t);
    execute format('drop policy if exists "editor can update" on public.%I', t);
    execute format('drop policy if exists "editor can delete" on public.%I', t);

    execute format('create policy "allowed can view" on public.%I for select to authenticated using (public.is_allowed())', t);
    execute format('create policy "editor can insert" on public.%I for insert to authenticated with check (public.is_editor())', t);
    execute format('create policy "editor can update" on public.%I for update to authenticated using (public.is_editor()) with check (public.is_editor())', t);
    execute format('create policy "editor can delete" on public.%I for delete to authenticated using (public.is_editor())', t);
  end loop;
end $$;


-- ---------------------------------------------------------------------
-- 5. ILAGAY DITO ANG EMAIL NINYONG DALAWA (palitan bago i-Run)
-- ---------------------------------------------------------------------
-- 'editor' = puwedeng mag-edit, 'viewer' = tingin lang
insert into public.allowed_emails (email, role) values
  ('ikaw@example.com', 'editor'),
  ('partner@example.com', 'viewer')
on conflict do nothing;

-- Optional: mga sample batch (puwedeng burahin ang mga linyang ito)
-- insert into public.batches (name, batch_type, start_date, chick_count)
-- values ('Early Bird - Batch 1', 'Early Bird', current_date, 500),
--        ('National - Batch 1', 'National', current_date, 500);
