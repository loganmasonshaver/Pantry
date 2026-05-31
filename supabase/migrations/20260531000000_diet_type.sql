-- Dedicated column for the user's chosen diet TYPE (Classic / Pescatarian /
-- Vegetarian / Vegan). Previously this choice was only folded into the
-- dietary_restrictions array at onboarding, so it wasn't cleanly queryable and
-- was tangled up with the hard-restriction tags (Dairy-free, Gluten-free, etc.).
alter table profiles add column if not exists diet_type text default 'Classic';

-- Backfill from dietary_restrictions, where onboarding previously merged the
-- diet-style tag. Most specific first (Vegan implies no meat AND no dairy).
update profiles set diet_type = case
  when 'Vegan'        = any(dietary_restrictions) then 'Vegan'
  when 'Vegetarian'   = any(dietary_restrictions) then 'Vegetarian'
  when 'Pescatarian'  = any(dietary_restrictions) then 'Pescatarian'
  else 'Classic'
end
where diet_type is null or diet_type = 'Classic';
