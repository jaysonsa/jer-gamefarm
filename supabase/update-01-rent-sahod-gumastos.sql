-- =====================================================================
-- Update #1: dagdag na category (Rent, Sahod) at "Sino ang gumastos"
-- Para sa database na na-setup na. I-paste sa Supabase > SQL Editor > Run.
-- Ligtas itong i-run kahit ilang beses.
-- =====================================================================

alter table public.expenses add column if not exists paid_by text;

alter table public.expenses drop constraint if exists expenses_category_check;
alter table public.expenses add constraint expenses_category_check
  check (category in ('Feeds', 'Bakuna', 'Gamot', 'Vitamins', 'Rent', 'Sahod', 'Iba pa'));
