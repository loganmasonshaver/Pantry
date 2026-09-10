-- The push must be the WHOLE report. The first version listed 8 meals and then "+N more — select *
-- from ops_dislike_report": a SQL command, printed on a phone, in a notification whose tap goes
-- nowhere. Logan asked what happens at 10-15 meals; the honest answer was "you can't see them".
--
-- Now: up to 10 meals, the FIXABLE ones first (photo / recipe reports — things Logan can act on),
-- then by how many users disliked it. Anything past 10 collapses into one line of counts per reason
-- ("+3 more meals: 2 seen too often, 1 no reason"), so every thumbs-down is counted somewhere in the
-- push itself. Repeats of one meal were never a problem: rows are grouped per meal already.
--
-- Labels moved into a VALUES table so the tail line and the per-meal lines cannot drift.
-- Grouping verified on 13 synthetic meals before this was written.

create or replace function public.daily_ops_report(p_send boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- trending_meals.generated_at is the pipeline's UTC date; at 14:00 UTC it equals Chicago's date.
  v_today date := (now() at time zone 'utc')::date;
  v_meals int;
  v_no_image int;
  v_discover text;
  v_users int;
  v_meal_count int;
  v_lines text[];
  v_tail text;
  v_title text;
  v_body text;
  v_ops_user uuid;
  v_token text;
  v_req bigint;
  v_push text := 'not sent (preview)';
begin
  select count(*), count(*) filter (where image is null or image not like 'http%')
    into v_meals, v_no_image
    from trending_meals
   where generated_at = v_today and trend_source = 'YouTube trending';

  -- 12 matches trending-health-check's TRENDING_MIN_EXPECTED default.
  v_discover := case
    when v_meals = 0 then 'Discover: NO new recipes today'
    when v_no_image > 0 then format('Discover: %s new recipes, %s missing photos', v_meals, v_no_image)
    when v_meals < 12 then format('Discover: only %s new recipes (expected 12+), all have photos', v_meals)
    else format('Discover: %s new recipes, all have photos', v_meals)
  end;

  -- One row per user per meal (unique user_id, meal_name), so counts are counts of USERS.
  with d as (
    select meal_name, coalesce(reason, 'none') as reason, user_id, reason_ingredients
      from meal_ratings
     where rating = -1 and created_at >= now() - interval '24 hours'
  ),
  -- Mirrors lib/dislikeReasons.ts. An unknown key prints raw rather than vanishing.
  labels(reason, label) as (values
    ('photo_mismatch', 'photo didn''t match'), ('recipe_wrong', 'recipe didn''t make sense'),
    ('macros_fit', 'didn''t fit macros'), ('too_often', 'seen too often'),
    ('taste', 'not to my taste'), ('none', 'no reason')
  ),
  per_reason as (
    select d.meal_name, d.reason, count(distinct d.user_id) as n,
           -- Only "not to my taste" carries ingredients: which ones they named, deduped.
           (select string_agg(distinct i, ', ')
              from d d2, unnest(d2.reason_ingredients) as i
             where d2.meal_name = d.meal_name and d2.reason = d.reason) as ings
      from d
     group by d.meal_name, d.reason
  ),
  per_meal as (
    select pr.meal_name, sum(pr.n) as total,
           bool_or(pr.reason in ('photo_mismatch', 'recipe_wrong')) as fixable,
           string_agg(pr.n || ' ' || coalesce(l.label, pr.reason) || coalesce(' (' || pr.ings || ')', ''),
                      ', ' order by pr.n desc, pr.reason) as detail
      from per_reason pr left join labels l using (reason)
     group by pr.meal_name
  ),
  ranked as (
    select *, row_number() over (order by fixable desc, total desc, meal_name) as rn from per_meal
  ),
  tail as (
    select pr.reason, sum(pr.n) as n
      from per_reason pr join ranked r using (meal_name)
     where r.rn > 10
     group by pr.reason
  )
  select (select count(distinct user_id) from d),
         (select count(*) from per_meal),
         (select array_agg(meal_name || ': ' || detail order by rn) from ranked where rn <= 10),
         (select string_agg(t.n || ' ' || coalesce(l.label, t.reason), ', ' order by t.n desc, t.reason)
            from tail t left join labels l using (reason))
    into v_users, v_meal_count, v_lines, v_tail;

  v_title := 'Pantry daily · ' || to_char(now() at time zone 'America/Chicago', 'Dy Mon FMDD');
  if coalesce(v_meal_count, 0) = 0 then
    v_body := v_discover || E'\nNo dislikes yesterday.';
  else
    v_body := v_discover || E'\n'
      || format('Dislikes: %s %s, %s %s', v_users, case when v_users = 1 then 'user' else 'users' end,
                v_meal_count, case when v_meal_count = 1 then 'meal' else 'meals' end)
      || E'\n' || array_to_string(v_lines, E'\n')
      || case when v_meal_count > 10
              then format(E'\n+%s more %s: %s', v_meal_count - 10,
                          case when v_meal_count - 10 = 1 then 'meal' else 'meals' end, v_tail)
              else '' end;
  end if;

  if p_send then
    select decrypted_secret::uuid into v_ops_user from vault.decrypted_secrets where name = 'ops_user_id';
    select expo_push_token into v_token from profiles where id = v_ops_user;
    if v_token is null then
      -- Recorded, not raised: the run log is where "why didn't it arrive" gets answered.
      v_push := case when v_ops_user is null then 'FAILED: vault ops_user_id missing'
                     else 'FAILED: ops user has no expo_push_token' end;
    else
      -- pg_net only QUEUES this. Expo answers HTTP 200 even when it rejects the push, so the real
      -- verdict is data.status in net._http_response under request_id — "queued" is not "delivered".
      v_req := net.http_post(
        url := 'https://exp.host/--/api/v2/push/send',
        body := jsonb_build_object('to', v_token, 'title', v_title, 'body', v_body,
                                   'sound', 'default', 'priority', 'high'),
        timeout_milliseconds := 15000
      );
      v_push := 'queued';
    end if;
  end if;

  insert into pipeline_runs (dry_run, provider, stored, funnel)
  values (not p_send, 'daily-report', v_meals,
          jsonb_build_object('title', v_title, 'body', v_body, 'push', v_push, 'request_id', v_req,
                             'dislike_users', coalesce(v_users, 0), 'dislike_meals', coalesce(v_meal_count, 0)));

  return jsonb_build_object('title', v_title, 'body', v_body, 'push', v_push, 'request_id', v_req);
end;
$$;

-- CREATE OR REPLACE keeps existing grants, but restating the revoke costs nothing and survives a
-- future DROP + CREATE. Without it the bundled anon key could push to Logan's phone at will.
revoke execute on function public.daily_ops_report(boolean) from public, anon, authenticated;
