-- The dislike sheet's taste follow-up gains a flavour row: Too bland, Too spicy, Too sweet, Texture
-- was off. Ingredient chips miss that whole class of failure — a dish with nothing the user dislikes
-- can still be bland. Stored in meal_ratings.reason_flavours (CHECKed to the four keys in
-- lib/dislikeReasons.ts FLAVOUR_ISSUES), and shown in the daily report as
-- "Beef Pasta Skillet: 1 not to my taste (too bland; onion)". Nothing acts on it automatically yet;
-- the report is where a pattern would show.
-- ops_report_data is regenerated from 20260910203058 with only the flavour lines changed.

alter table public.meal_ratings add column if not exists reason_flavours text[];
alter table public.meal_ratings drop constraint if exists meal_ratings_reason_flavours_check;
alter table public.meal_ratings add constraint meal_ratings_reason_flavours_check
  check (reason_flavours is null or reason_flavours <@ array['too_bland', 'too_spicy', 'too_sweet', 'texture_off']::text[]);

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
  v_discover_bad boolean;
  v_summary text;
  v_users int;
  v_meal_count int;
  v_total int;
  v_lines text[];
  v_tail text;
  v_title text;
  v_reasons text;
  v_fix_html text;
  v_fix_text text;
  v_most_html text;
  v_most_text text;
  v_single_count int;
  v_single_html text;
  v_single_text text;
  v_stats text;
  v_html text;
  v_text text;
  -- String concatenation, not format(): CSS is full of "%" and format() would read them as slots.
  c_grey constant text := '#8a8a8a';
  c_sec constant text := '<div style="font-size:12px;font-weight:700;letter-spacing:1.2px;color:#8a8a8a;margin:28px 0 0">';
  c_tbl constant text := '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">';
begin
  select count(*), count(*) filter (where image is null or image not like 'http%')
    into v_meals, v_no_image
    from trending_meals
   where generated_at = v_today and trend_source = 'YouTube trending';

  -- 12 matches trending-health-check's TRENDING_MIN_EXPECTED default.
  v_discover_bad := v_meals = 0 or v_no_image > 0 or v_meals < 12;
  v_discover := case
    when v_meals = 0 then 'Discover: NO new recipes today'
    when v_no_image > 0 then format('Discover: %s new recipes, %s missing photos', v_meals, v_no_image)
    when v_meals < 12 then format('Discover: only %s new recipes (expected 12+), all have photos', v_meals)
    else format('Discover: %s new recipes, all have photos', v_meals)
  end;

  -- One row per user per meal (unique user_id, meal_name), so counts are counts of USERS.
  with d as (
    select meal_name, coalesce(reason, 'none') as reason, user_id, reason_ingredients, reason_flavours
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
    select d.meal_name, d.reason, count(distinct d.user_id)::int as n,
           -- Only "not to my taste" carries ingredients: which ones they named, deduped.
           (select string_agg(distinct i, ', ')
              from d d2, unnest(d2.reason_ingredients) as i
             where d2.meal_name = d.meal_name and d2.reason = d.reason) as ings,
           -- The flavour row (too bland / too spicy / too sweet / texture off), same dedupe.
           (select string_agg(distinct replace(f, '_', ' '), ', ')
              from d d2, unnest(d2.reason_flavours) as f
             where d2.meal_name = d.meal_name and d2.reason = d.reason) as flavs
      from d
     group by d.meal_name, d.reason
  ),
  pr as (
    select p.*, coalesce(l.label, p.reason) as label,
           -- "not to my taste (too bland; dill, onion)": flavours first, then named ingredients.
           coalesce(l.label, p.reason) || coalesce(' (' || nullif(concat_ws('; ', p.flavs, p.ings), '') || ')', '') as lbl,
           p.reason in ('photo_mismatch', 'recipe_wrong') as fixable
      from per_reason p left join labels l using (reason)
  ),
  -- OLD single-list format — the push and the current email_body. Remove once email_html ships.
  per_meal as (
    select meal_name, sum(n) as total, bool_or(fixable) as fixable,
           string_agg(n || ' ' || lbl, ', ' order by n desc, reason) as detail
      from pr group by meal_name
  ),
  ranked as (
    select *, row_number() over (order by fixable desc, total desc, meal_name) as rn from per_meal
  ),
  tail as (
    select pr.reason, pr.label, sum(pr.n) as n
      from pr join ranked r using (meal_name)
     where r.rn > 10
     group by pr.reason, pr.label
  ),
  -- NEW sectioned format. A meal with one reason shows the label alone — its count is on the right.
  meal as (
    select meal_name, sum(n)::int as total,
           case when count(*) = 1 then max(lbl)
                else string_agg(n || ' ' || lbl, ' · ' order by n desc, reason) end as detail,
           coalesce(sum(n) filter (where fixable), 0)::int as fix_total,
           case when count(*) filter (where fixable) = 1 then max(lbl) filter (where fixable)
                else string_agg(n || ' ' || lbl, ' · ' order by n desc, reason) filter (where fixable) end as fix_detail
      from pr group by meal_name
  ),
  reason_tot as (select reason, label, sum(n)::int as n from pr group by reason, label)
  select (select count(distinct user_id) from d),
         (select count(*) from meal),
         (select coalesce(sum(n), 0) from pr),
         (select array_agg(meal_name || ': ' || detail order by rn) from ranked),
         (select string_agg(t.n || ' ' || t.label, ', ' order by t.n desc, t.reason) from tail t),
         (select string_agg(upper(left(label, 1)) || substr(label, 2) || ' ' || n, ' · ' order by n desc, label)
            from reason_tot),
         (select string_agg(public.ops_email_row(meal_name, fix_total, fix_detail), '' order by fix_total desc, meal_name)
            from meal where fix_total > 0),
         (select string_agg(meal_name || ' (' || fix_total || '): ' || fix_detail, E'\n' order by fix_total desc, meal_name)
            from meal where fix_total > 0),
         (select string_agg(public.ops_email_row(meal_name, total, detail), '' order by total desc, meal_name)
            from meal where total >= 2 and fix_total < total),
         (select string_agg(meal_name || ' (' || total || '): ' || detail, E'\n' order by total desc, meal_name)
            from meal where total >= 2 and fix_total < total),
         (select count(*) from meal where total = 1 and fix_total = 0),
         (select string_agg(public.ops_html(meal_name), ', ' order by meal_name) from meal where total = 1 and fix_total = 0),
         (select string_agg(meal_name, ', ' order by meal_name) from meal where total = 1 and fix_total = 0)
    into v_users, v_meal_count, v_total, v_lines, v_tail, v_reasons,
         v_fix_html, v_fix_text, v_most_html, v_most_text, v_single_count, v_single_html, v_single_text;

  v_title := 'Pantry daily · ' || to_char(now() at time zone 'America/Chicago', 'Dy Mon FMDD');
  v_summary := case when coalesce(v_meal_count, 0) = 0 then 'No dislikes yesterday.'
    else format('Dislikes: %s %s, %s %s', v_users, case when v_users = 1 then 'user' else 'users' end,
                v_meal_count, case when v_meal_count = 1 then 'meal' else 'meals' end) end;
  v_stats := v_total || case when v_total = 1 then ' dislike' else ' dislikes' end
    || ' · ' || v_users || case when v_users = 1 then ' user' else ' users' end
    || ' · ' || v_meal_count || case when v_meal_count = 1 then ' meal' else ' meals' end;

  v_html := '<div style="font-family:-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif;'
    || 'font-size:15px;line-height:1.45;max-width:560px">'
    -- A Discover problem is the one line that must not be missed: red and bold, else quiet grey.
    || '<div style="font-size:14px;' || case when v_discover_bad then 'color:#e5484d;font-weight:700' else 'color:' || c_grey end
    || '">' || public.ops_html(v_discover) || '</div>'
    || case when coalesce(v_meal_count, 0) = 0 then
         '<div style="font-size:18px;font-weight:700;margin-top:16px">No dislikes yesterday.</div>'
       else
         '<div style="font-size:20px;font-weight:700;margin:16px 0 4px">' || v_stats || '</div>'
         || '<div style="font-size:13px;color:' || c_grey || '">' || public.ops_html(v_reasons) || '</div>'
         -- An empty section is a NULL string, so coalesce drops the heading along with it.
         || coalesce(c_sec || 'TO FIX</div>' || c_tbl || v_fix_html || '</table>', '')
         || coalesce(c_sec || 'MOST DISLIKED</div>' || c_tbl || v_most_html || '</table>', '')
         || case when v_single_count > 0 then
              c_sec || '1 DISLIKE EACH (' || v_single_count || case when v_single_count = 1 then ' MEAL)' else ' MEALS)' end
              || '</div><div style="font-size:13px;color:' || c_grey || ';padding-top:8px">' || v_single_html || '</div>'
            else '' end
       end
    || '</div>';

  -- Plain-text alternative with the same sections, for clients that will not render HTML.
  v_text := v_discover || E'\n\n'
    || case when coalesce(v_meal_count, 0) = 0 then 'No dislikes yesterday.'
       else v_stats || E'\n' || v_reasons
         || coalesce(E'\n\nTO FIX\n' || v_fix_text, '')
         || coalesce(E'\n\nMOST DISLIKED\n' || v_most_text, '')
         || case when v_single_count > 0 then E'\n\n1 DISLIKE EACH (' || v_single_count || E')\n' || v_single_text else '' end
       end;

  return jsonb_build_object(
    'title', v_title,
    'email_html', v_html,
    'email_text', v_text,
    -- Current format, still what the 9am task sends until it is switched to email_html.
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

-- CREATE OR REPLACE keeps grants; restated so a DROP + CREATE cannot re-expose it.
revoke execute on function public.ops_report_data() from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_read_only_user') then
    grant execute on function public.ops_report_data() to supabase_read_only_user;
  end if;
end $$;

-- The full list, now with flavours. Columns only appended, so CREATE OR REPLACE keeps the view.
create or replace view public.ops_dislike_report with (security_invoker = true) as
select r.meal_name,
       coalesce(r.reason, 'none') as reason,
       count(distinct r.user_id) as users,
       array_remove(array_agg(distinct i.ing), null) as ingredients,
       max(r.created_at) as last_at,
       array_remove(array_agg(distinct f.fl), null) as flavours
  from meal_ratings r
  left join lateral unnest(r.reason_ingredients) as i(ing) on true
  left join lateral unnest(r.reason_flavours) as f(fl) on true
 where r.rating = -1
 group by r.meal_name, coalesce(r.reason, 'none')
 order by max(r.created_at) desc;

revoke all on public.ops_dislike_report from public, anon, authenticated;
