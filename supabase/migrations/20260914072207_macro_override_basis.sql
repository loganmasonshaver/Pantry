-- A nutrition correction stores the portion it was made on, so the app can scale it to any other
-- portion. Without this the correction's absolute numbers were applied as the per-unit value of
-- every serving: a 1-cup fix for whole milk, logged as 240 g, logged 150 kcal x 240 = 36,000 kcal.
--
-- basis_amount / basis_unit: that portion's weight or volume (scales by weight onto any portion
-- with a weight in the same unit). serving_id: the serving it was made on (the only way to apply a
-- fix to a food FatSecret gives no weight for). All nullable: rows saved before this carry none,
-- and the app assigns them the food's default serving on first read, which is the serving the old
-- screen always opened on.
alter table macro_overrides add column if not exists basis_amount float4;
alter table macro_overrides add column if not exists basis_unit text;
alter table macro_overrides add column if not exists serving_id text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'macro_overrides_basis_unit_check') then
    alter table macro_overrides add constraint macro_overrides_basis_unit_check
      check (basis_unit is null or basis_unit in ('g', 'ml'));
  end if;
end $$;
