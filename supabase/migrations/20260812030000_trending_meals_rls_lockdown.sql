-- SECURITY: trending_meals currently accepts INSERT, UPDATE and DELETE from the anon role.
--
-- Found by accident while deleting four bad rows: the delete succeeded using nothing but the
-- public anon key. Probing confirmed the rest — an INSERT with a bogus column returned PGRST204
-- (schema error) rather than 401/403, and an UPDATE returned 204. None of those are blocked.
--
-- The anon key ships inside the app bundle and is trivially extractable, so as it stands anyone
-- can wipe the entire Discover feed for every user, or inject arbitrary recipes with arbitrary
-- text and image URLs into it. No auth required.
--
-- Intended access:
--   * everyone reads the feed
--   * a signed-in creator writes ONLY their own creator recipes
--   * the generation pipeline writes freely (service_role bypasses RLS, so the cron is unaffected)
--   * anon writes nothing
--
-- Voting is unaffected: it goes through the increment_vote_score RPC rather than a direct table
-- update, and SECURITY DEFINER functions bypass RLS.

alter table public.trending_meals enable row level security;

-- Drop every existing policy by name rather than guessing at them — whatever is currently
-- permitting anon writes has to go, and it can't be assumed to have a predictable name.
do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'trending_meals'
  loop
    execute format('drop policy %I on public.trending_meals', pol.policyname);
  end loop;
end $$;

-- The feed is public content; reading it is the whole point.
create policy "trending_meals_public_read"
  on public.trending_meals for select
  using (true);

-- A creator may only add rows attributed to a creator profile they own, and only as 'creator'
-- source — this specifically prevents forging a row that impersonates the YouTube pipeline.
create policy "trending_meals_creator_insert"
  on public.trending_meals for insert to authenticated
  with check (
    trend_source = 'creator'
    and creator_id in (select id from public.creators where user_id = auth.uid())
  );

-- Both USING and WITH CHECK: USING decides which rows may be edited, WITH CHECK stops the edit
-- from reassigning creator_id to somebody else on the way out.
create policy "trending_meals_creator_update"
  on public.trending_meals for update to authenticated
  using      (creator_id in (select id from public.creators where user_id = auth.uid()))
  with check (creator_id in (select id from public.creators where user_id = auth.uid()));

create policy "trending_meals_creator_delete"
  on public.trending_meals for delete to authenticated
  using (creator_id in (select id from public.creators where user_id = auth.uid()));

-- No anon write policy is defined, which under RLS means anon gets SELECT only.
