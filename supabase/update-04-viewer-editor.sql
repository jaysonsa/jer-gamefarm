-- =====================================================================
-- Update #4: Editor at Viewer
--   editor = puwedeng mag-dagdag, mag-edit at mag-bura
--   viewer = puwedeng tumingin lang
-- I-paste sa Supabase > SQL Editor > Run. Ligtas i-run kahit ilang beses.
-- =====================================================================

-- 1. Role ng bawat email (default: viewer, para ligtas ang bagong idadagdag)
alter table public.allowed_emails
  add column if not exists role text not null default 'viewer'
  check (role in ('editor', 'viewer'));

-- 2. Gawing editor ang IYONG Gmail (palitan bago i-Run)
update public.allowed_emails set role = 'editor'
where lower(email) = lower('IYONG-GMAIL@gmail.com');

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

-- 5. Security rules: lahat ng allowed ay puwedeng tumingin, editor lang ang puwedeng magbago
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

-- Tingnan ang resulta:
select email, role from public.allowed_emails order by role, email;
