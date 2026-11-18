-- =====================================================================
-- Update #3: Culled at Wingband na tab
-- I-paste sa Supabase > SQL Editor > Run. Ligtas i-run kahit ilang beses.
-- =====================================================================

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
