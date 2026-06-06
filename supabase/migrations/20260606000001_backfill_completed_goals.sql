-- Consistency follow-up: any profile now marked onboarding_completed must have
-- non-null goals, or the dashboard's calorie ring / macro math breaks. Backfill the
-- same sensible defaults finish() now applies to skipped-through users.
update profiles set calorie_goal = 2000
  where onboarding_completed = true and calorie_goal is null;
update profiles set protein_goal = 150
  where onboarding_completed = true and protein_goal is null;
