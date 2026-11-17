-- =====================================================================
-- Update #2: saklaw (start at end) ng binayarang Rent
-- I-paste sa Supabase > SQL Editor > Run. Ligtas i-run kahit ilang beses.
-- =====================================================================

alter table public.expenses add column if not exists period_start date;
alter table public.expenses add column if not exists period_end date;

alter table public.expenses drop constraint if exists expenses_period_check;
alter table public.expenses add constraint expenses_period_check
  check (period_start is null or period_end is null or period_end >= period_start);
