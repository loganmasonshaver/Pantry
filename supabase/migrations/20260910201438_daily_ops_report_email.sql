-- The daily report goes by EMAIL (Logan: easier to see than a push), through a Loops transactional
-- template. Push stays only as the fallback for when email is not configured, so exactly one of
-- the two is sent each day and the switch-over leaves no gap.
--
-- Email is configured when BOTH Vault secrets exist:
--   loops_api_key          a Loops API key (Logan adds it in the dashboard; never in chat or repo)
--   loops_daily_report_id  the transactional template's id
-- The template needs a subject of {title} and one ARRAY block named `lines` holding {line}. An array
-- rather than one text variable with "\n" in it, because Loops documents arrays and says nothing
-- about newlines surviving a data variable.
--
-- Email has no length limit, so it lists EVERY meal; the push keeps its 10-meal cap plus the
-- counts-per-reason tail line. Both orders are the same: fixable (photo / recipe) first.
-- The recipient is the ops user's auth email, looked up at send time — no address in this repo.

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
  v_summary text;
  v_users int;
  v_meal_count int;
  v_lines text[];
  v_tail text;
  v_title text;
  v_body text;
  v_ops_user uuid;
  v_email text;
  v_loops_key text;
  v_loops_tid text;
  v_token text;
  v_channel text;
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
         -- ALL meals, ranked. The push slices the first 10; the email sends them all.
         (select array_agg(meal_name || ': ' || detail order by rn) from ranked),
         (select string_agg(t.n || ' ' || coalesce(l.label, t.reason), ', ' order by t.n desc, t.reason)
            from tail t left join labels l using (reason))
    into v_users, v_meal_count, v_lines, v_tail;

  v_title := 'Pantry daily · ' || to_char(now() at time zone 'America/Chicago', 'Dy Mon FMDD');
  v_summary := case when coalesce(v_meal_count, 0) = 0 then 'No dislikes yesterday.'
    else format('Dislikes: %s %s, %s %s', v_users, case when v_users = 1 then 'user' else 'users' end,
                v_meal_count, case when v_meal_count = 1 then 'meal' else 'meals' end) end;

  -- The push body (also what the run log records, so the log reads the same for either channel).
  v_body := v_discover || E'\n' || v_summary
    || coalesce(E'\n' || array_to_string(v_lines[1:10], E'\n'), '')
    || case when v_meal_count > 10
            then format(E'\n+%s more %s: %s', v_meal_count - 10,
                        case when v_meal_count - 10 = 1 then 'meal' else 'meals' end, v_tail)
            else '' end;

  select decrypted_secret::uuid into v_ops_user from vault.decrypted_secrets where name = 'ops_user_id';
  select decrypted_secret into v_loops_key from vault.decrypted_secrets where name = 'loops_api_key';
  select decrypted_secret into v_loops_tid from vault.decrypted_secrets where name = 'loops_daily_report_id';
  v_channel := case when v_loops_key is not null and v_loops_tid is not null then 'email' else 'push' end;

  if p_send then
    if v_ops_user is null then
      -- Recorded, not raised: the run log is where "why didn't it arrive" gets answered.
      v_push := 'FAILED: vault ops_user_id missing';
    elsif v_channel = 'email' then
      select email into v_email from auth.users where id = v_ops_user;
      -- pg_net only QUEUES this. Loops' verdict ({"success":true} or a message) lands in
      -- net._http_response under request_id.
      v_req := net.http_post(
        url := 'https://app.loops.so/api/v1/transactional',
        body := jsonb_build_object(
          'transactionalId', v_loops_tid,
          'email', v_email,
          'dataVariables', jsonb_build_object(
            'title', v_title,
            'lines', (select jsonb_agg(jsonb_build_object('line', l) order by i)
                        from unnest(array[v_discover, v_summary] || coalesce(v_lines, '{}'))
                             with ordinality as u(l, i))
          )
        ),
        headers := jsonb_build_object('Content-Type', 'application/json',
                                      'Authorization', 'Bearer ' || v_loops_key),
        timeout_milliseconds := 15000
      );
      v_push := 'queued';
    else
      select expo_push_token into v_token from profiles where id = v_ops_user;
      if v_token is null then
        v_push := 'FAILED: ops user has no expo_push_token';
      else
        -- Expo answers HTTP 200 even when it rejects the push; the real verdict is data.status in
        -- net._http_response under request_id — "queued" is not "delivered".
        v_req := net.http_post(
          url := 'https://exp.host/--/api/v2/push/send',
          body := jsonb_build_object('to', v_token, 'title', v_title, 'body', v_body,
                                     'sound', 'default', 'priority', 'high'),
          timeout_milliseconds := 15000
        );
        v_push := 'queued';
      end if;
    end if;
  end if;

  insert into pipeline_runs (dry_run, provider, stored, funnel)
  values (not p_send, 'daily-report', v_meals,
          jsonb_build_object('title', v_title, 'body', v_body, 'channel', v_channel, 'push', v_push,
                             'request_id', v_req, 'dislike_users', coalesce(v_users, 0),
                             'dislike_meals', coalesce(v_meal_count, 0)));

  return jsonb_build_object('title', v_title, 'body', v_body, 'channel', v_channel,
                            'push', v_push, 'request_id', v_req);
end;
$$;

-- Restated so a future DROP + CREATE cannot quietly re-expose it to the bundled anon key.
revoke execute on function public.daily_ops_report(boolean) from public, anon, authenticated;
