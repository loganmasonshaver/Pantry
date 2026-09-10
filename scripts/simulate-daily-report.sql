-- Simulate a busy day of dislikes and see the REAL daily report, without saving anything.
--
-- Inserts ~53 thumbs-downs from the existing accounts (meal_ratings.user_id must reference a real
-- auth user) across 18 recent Discover meals — 3 meals x 8 users, 7 x 3, 8 x 1, all five reasons
-- plus "no reason" — calls public.ops_report_data(), then RAISES, which aborts the DO block and
-- rolls every insert back. The report comes out in the error message. meal_ratings has no triggers.
--
--   npx supabase db query --linked --file scripts/simulate-daily-report.sql
--
-- Afterwards `select count(*) from meal_ratings` must be unchanged.
do $$
declare r jsonb; n int;
begin
  with u as (select id, row_number() over (order by id) as rn from auth.users where id in (select id from profiles)),
  m as (select name, row_number() over (order by name) as rn
          from (select distinct name from trending_meals where generated_at >= current_date - 7) x),
  -- 13 is coprime to 20, so for each meal exactly `threshold` of the 20 users land on it.
  pairs as (
    select u.id as uid, u.rn as urn, m.name, m.rn as mrn from u cross join m
     where m.rn <= 18
       and (u.rn * 13 + m.rn * 7) % 20 < case when m.rn <= 3 then 8 when m.rn <= 10 then 3 else 1 end
  ),
  p as (
    select uid, name, mrn,
           (array['too_often','too_often','too_often','photo_mismatch','recipe_wrong','macros_fit','taste','taste',null])[1 + ((urn * 3 + mrn) % 9)] as reason
      from pairs
  )
  insert into meal_ratings (user_id, meal_name, rating, reason, reason_ingredients, reason_flavours, created_at)
  select uid, name, -1, reason,
         -- mrn % 4 = 3 names no ingredient at all, only a flavour — the case the flavour row exists for.
         case when reason = 'taste' then (case mrn % 4 when 0 then array['dill'] when 1 then array['cilantro','red onion']
                                                     when 2 then array['tahini'] else null end) end,
         case when reason = 'taste' then (case mrn % 3 when 0 then array['too_bland'] when 1 then array['too_spicy','texture_off']
                                                     else null end) end,
         now() - interval '3 hours'
    from p
  on conflict (user_id, meal_name) do nothing;
  get diagnostics n = row_count;
  r := public.ops_report_data();
  -- Raising aborts the DO block, so every inserted row is rolled back. The report rides out in the message.
  raise exception 'SIMULATION(% rows inserted, rolled back): %', n, r::text;
end $$;
