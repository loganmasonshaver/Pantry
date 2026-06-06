-- Explicit onboarding-completion flag. Routing previously inferred "finished
-- onboarding" from calorie_goal being non-null, but the goal steps are skippable —
-- so a user could finish onboarding with null goals and get wrongly bounced back
-- into it (and their dashboard would have no calorie ring). This is the authoritative
-- signal, set at the end of the onboarding flow.
alter table profiles add column if not exists onboarding_completed boolean not null default false;

-- Backfill existing users. Anyone who already has goals or the core onboarding
-- outputs clearly finished — mark them complete so they aren't sent back through it.
update profiles set onboarding_completed = true
where calorie_goal is not null
   or meals_per_day is not null
   or cooking_skill is not null;
