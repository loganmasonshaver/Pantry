-- Daily ops report: ONE push to Logan every morning with Discover's health and every thumbs-down of
-- the last 24 hours, grouped by meal with a count per reason ("Cheesecake: 2 photo didn't match").
--
-- Sent EVERY day, including "No dislikes yesterday", so a missing push is itself the alarm — the
-- trending-health-check only pushes on failure, and when its credential broke nobody noticed for
-- three days because silence looked like health.
--
-- SQL-only on purpose: it reads the tables and posts to Expo straight from Postgres. No edge
-- function, no CRON_SECRET, no service-role key — nothing the pipeline's auth can break.
--
-- The recipient is the Vault secret 'ops_user_id', set out-of-band so no user id enters this public
-- repo. Reason labels mirror lib/dislikeReasons.ts; an unknown key prints raw rather than vanishing.

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

  -- One row per user per meal (unique user_id, meal_name), so count(*) is a count of USERS.
  with d as (
    select meal_name, coalesce(reason, 'none') as reason, user_id, reason_ingredients
      from meal_ratings
     where rating = -1 and created_at >= now() - interval '24 hours'
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
    select meal_name, sum(n) as total,
           string_agg(
             n || ' ' || case reason
               when 'photo_mismatch' then 'photo didn''t match'
               when 'recipe_wrong'   then 'recipe didn''t make sense'
               when 'macros_fit'     then 'didn''t fit macros'
               when 'too_often'      then 'seen too often'
               when 'taste'          then 'not to my taste'
               when 'none'           then 'no reason'
               else reason
             end || coalesce(' (' || ings || ')', ''),
             ', ' order by n desc, reason) as detail
      from per_reason
     group by meal_name
  )
  select (select count(distinct user_id) from d),
         (select count(*) from per_meal),
         (select array_agg(meal_name || ': ' || detail order by total desc, meal_name) from per_meal)
    into v_users, v_meal_count, v_lines;

  v_title := 'Pantry daily · ' || to_char(now() at time zone 'America/Chicago', 'Dy Mon FMDD');
  if coalesce(v_meal_count, 0) = 0 then
    v_body := v_discover || E'\nNo dislikes yesterday.';
  else
    -- A push body is not a report viewer: top 8 meals, and the rest is one query away.
    v_body := v_discover || E'\n'
      || format('Dislikes: %s %s, %s %s', v_users, case when v_users = 1 then 'user' else 'users' end,
                v_meal_count, case when v_meal_count = 1 then 'meal' else 'meals' end)
      || E'\n' || array_to_string(v_lines[1:8], E'\n')
      || case when v_meal_count > 8
              then E'\n+' || (v_meal_count - 8) || ' more — select * from ops_dislike_report'
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
      -- pg_net is async: this only QUEUES the request. Expo's verdict lands in net._http_response
      -- under request_id; its default 5s timeout is raised because nothing waits on it.
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

-- Supabase's default privileges grant EXECUTE on new public functions to anon and authenticated
-- directly, so revoking from PUBLIC alone is not enough. Without this, anyone holding the anon key
-- (it ships in the app bundle) could rpc('daily_ops_report') and push to Logan's phone at will.
revoke execute on function public.daily_ops_report(boolean) from public, anon, authenticated;

-- The full list the push truncates. security_invoker so meal_ratings' RLS applies to whoever reads
-- it, AND no grant to the API roles at all — views in public are otherwise exposed via PostgREST.
-- Read it from the SQL editor or table editor, which run as a role that bypasses RLS.
create or replace view public.ops_dislike_report with (security_invoker = true) as
select r.meal_name,
       coalesce(r.reason, 'none') as reason,
       count(distinct r.user_id) as users,
       array_remove(array_agg(distinct i.ing), null) as ingredients,
       max(r.created_at) as last_at
  from meal_ratings r
  left join lateral unnest(r.reason_ingredients) as i(ing) on true
 where r.rating = -1
 group by r.meal_name, coalesce(r.reason, 'none')
 order by max(r.created_at) desc;

revoke all on public.ops_dislike_report from public, anon, authenticated;

-- 14:00 UTC = 9am CDT. pg_cron runs in UTC, so from Nov 1 (CST) this lands at 8am — accepted
-- rather than two DST-swapped schedules. Unschedule-then-schedule keeps the migration re-runnable.
select cron.unschedule('ops-daily-report') where exists (select 1 from cron.job where jobname = 'ops-daily-report');
select cron.schedule('ops-daily-report', '0 14 * * *', $cron$select public.daily_ops_report()$cron$);
