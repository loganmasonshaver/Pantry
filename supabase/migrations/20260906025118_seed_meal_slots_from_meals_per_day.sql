-- Backfill meal_slots from the answer onboarding already collected.
--
-- The column shipped hours ago with a flat default of '{Breakfast,Lunch,Dinner,Snacks}' for
-- everyone, which ignored meals_per_day. This aligns existing rows with the count the user gave.
--
-- ONLY rows still holding the exact default are touched, so a structure someone has already
-- customised is never overwritten. That makes this safe to re-run: after the first pass those rows
-- no longer match the default and are skipped.
--
-- Must stay in step with slotsForMealsPerDay() in lib/mealSlots.ts. Ordered THROUGH THE DAY rather
-- than appending snacks, and every name distinct — two slots sharing a name would collapse to one
-- slot id and write the same `slot` string onto every meal_logs row.
update public.profiles
set meal_slots = case
  when meals_per_day = 1 then array['Breakfast']
  when meals_per_day = 2 then array['Breakfast','Dinner']
  when meals_per_day = 3 then array['Breakfast','Lunch','Dinner']
  when meals_per_day = 4 then array['Breakfast','Lunch','Dinner','Snack']
  when meals_per_day = 5 then array['Breakfast','Morning snack','Lunch','Dinner','Evening snack']
  when meals_per_day >= 6 then array['Breakfast','Morning snack','Lunch','Afternoon snack','Dinner','Evening snack']
  else meal_slots
end
where meals_per_day is not null
  and meals_per_day between 1 and 6
  and meal_slots = array['Breakfast','Lunch','Dinner','Snacks'];
