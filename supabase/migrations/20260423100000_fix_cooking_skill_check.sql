-- Drop the existing check constraint and replace it with one that matches
-- the values the onboarding actually sends: minimal, moderate, adventurous, culinary.
alter table profiles drop constraint if exists profiles_cooking_skill_check;

alter table profiles add constraint profiles_cooking_skill_check
  check (cooking_skill in ('minimal', 'moderate', 'adventurous', 'culinary'));
