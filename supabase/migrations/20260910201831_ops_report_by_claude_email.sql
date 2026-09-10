-- Logan wants the daily report as a plain email to his personal inbox, sent directly — not through
-- Loops. The sender is now a Claude scheduled task (in the desktop app, 9am local) that reads this
-- report and mails it from his Gmail to himself. So the database's job shrinks to BUILDING the text:
--
--   ops_report_data()      read-only; everything the report says, plus a ready-to-send email body.
--                          The task sends that body VERBATIM, so wording never depends on a model.
--   daily_ops_report(bool) unchanged push path for a manual send, built from the same data. The
--                          cron now calls it with FALSE — log only — so Logan gets ONE message a day.
--
-- The Loops branch from 20260910201438 is gone; no Vault secrets beyond ops_user_id are needed.
-- Known trade, stated to Logan: the scheduled task runs only while the Claude app is open, so a
-- closed laptop at 9am means the email arrives on next launch rather than not at all.

create or replace function public.ops_report_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  -- trending_meals.generated_at is the pipeline's UTC date; after 08:00 UTC it is Chicago's date.
  v_today date := (now() at time zone 'utc')::date;
  v_meals int;
  v_no_image int;
  v_discover text;
  v_summary text;
  v_users int;
  v_meal_count int;
  v_lines text[];
  v_tail text;
  v_title text;
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
  -- Fixable (photo / recipe) first — the reports Logan can act on — then by users who disliked it.
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
         (select array_agg(meal_name || ': ' || detail order by rn) from ranked),
         (select string_agg(t.n || ' ' || coalesce(l.label, t.reason), ', ' order by t.n desc, t.reason)
            from tail t left join labels l using (reason))
    into v_users, v_meal_count, v_lines, v_tail;

  v_title := 'Pantry daily · ' || to_char(now() at time zone 'America/Chicago', 'Dy Mon FMDD');
  v_summary := case when coalesce(v_meal_count, 0) = 0 then 'No dislikes yesterday.'
    else format('Dislikes: %s %s, %s %s', v_users, case when v_users = 1 then 'user' else 'users' end,
                v_meal_count, case when v_meal_count = 1 then 'meal' else 'meals' end) end;

  return jsonb_build_object(
    'title', v_title,
    -- Email has no length limit: EVERY meal, one per line, after a blank line.
    'email_body', v_discover || E'\n' || v_summary
                  || coalesce(E'\n\n' || array_to_string(v_lines, E'\n'), ''),
    'discover', v_discover,
    'summary', v_summary,
    'lines', to_jsonb(coalesce(v_lines, '{}'::text[])),
    'tail', v_tail,
    'meal_count', coalesce(v_meal_count, 0),
    'dislike_users', coalesce(v_users, 0),
    'meals', v_meals
  );
end;
$$;

-- Every user's dislikes are in here, and SECURITY DEFINER reads past meal_ratings' RLS. Supabase
-- grants EXECUTE on new public functions to anon and authenticated directly, so without this any
-- app user could rpc('ops_report_data') and read everyone's feedback.
revoke execute on function public.ops_report_data() from public, anon, authenticated;

create or replace function public.daily_ops_report(p_send boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r jsonb := public.ops_report_data();
  v_lines text[] := array(select e from jsonb_array_elements_text(r->'lines') with ordinality as t(e, i) order by i);
  v_count int := (r->>'meal_count')::int;
  v_body text;
  v_ops_user uuid;
  v_token text;
  v_req bigint;
  v_push text := 'not sent (log only)';
begin
  -- The push keeps a 10-meal cap; the rest collapses into counts per reason.
  v_body := (r->>'discover') || E'\n' || (r->>'summary')
    || coalesce(E'\n' || array_to_string(v_lines[1:10], E'\n'), '')
    || case when v_count > 10
            then format(E'\n+%s more %s: %s', v_count - 10,
                        case when v_count - 10 = 1 then 'meal' else 'meals' end, r->>'tail')
            else '' end;

  if p_send then
    select decrypted_secret::uuid into v_ops_user from vault.decrypted_secrets where name = 'ops_user_id';
    select expo_push_token into v_token from profiles where id = v_ops_user;
    if v_token is null then
      v_push := case when v_ops_user is null then 'FAILED: vault ops_user_id missing'
                     else 'FAILED: ops user has no expo_push_token' end;
    else
      -- Expo answers HTTP 200 even when it rejects the push; the real verdict is data.status in
      -- net._http_response under request_id — "queued" is not "delivered".
      v_req := net.http_post(
        url := 'https://exp.host/--/api/v2/push/send',
        body := jsonb_build_object('to', v_token, 'title', r->>'title', 'body', v_body,
                                   'sound', 'default', 'priority', 'high'),
        timeout_milliseconds := 15000
      );
      v_push := 'queued';
    end if;
  end if;

  -- A daily snapshot of what the report said, whichever channel (if any) delivered it.
  insert into pipeline_runs (dry_run, provider, stored, funnel)
  values (not p_send, 'daily-report', (r->>'meals')::int,
          jsonb_build_object('title', r->>'title', 'body', v_body, 'push', v_push, 'request_id', v_req,
                             'dislike_users', (r->>'dislike_users')::int, 'dislike_meals', v_count));

  return jsonb_build_object('title', r->>'title', 'body', v_body, 'push', v_push, 'request_id', v_req);
end;
$$;

revoke execute on function public.daily_ops_report(boolean) from public, anon, authenticated;

-- Log only. The email comes from the Claude scheduled task; a push as well would be two messages.
select cron.unschedule('ops-daily-report') where exists (select 1 from cron.job where jobname = 'ops-daily-report');
select cron.schedule('ops-daily-report', '0 14 * * *', $cron$select public.daily_ops_report(false)$cron$);
