-- Spare Cook Now meals, held back from the deck they were ranked with.
--
-- generate-meals asks for 10 candidates and shows 3; the next-best survivors used to be discarded.
-- Kept here (replaced on every generation) so a meal built on an item a scan got wrong can be swapped
-- for one of them without spending a generation, and so swap-meal can record a swap only for a meal
-- the server actually issued: generated_meals is history the client cannot write, and a swap must not
-- become a way to forge it.
--
-- No client access at all. RLS is on with no policies, and the table grants are revoked on top: only
-- the service role (generate-meals, swap-meal) reads or writes it.
create table if not exists public.meal_spares (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  mode        text not null,
  meal_id     text not null,
  name        text not null,
  meal_data   jsonb not null,
  created_at  timestamptz not null default now(),
  swapped_at  timestamptz
);

create index if not exists meal_spares_user_mode_idx on public.meal_spares (user_id, mode);

alter table public.meal_spares enable row level security;
revoke all on table public.meal_spares from anon, authenticated;
