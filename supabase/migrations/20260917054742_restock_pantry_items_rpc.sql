-- One round trip for a scan's restocks.
--
-- addPantryItemsDeduped re-stocked each already-owned item with its own PATCH, eight at a time. A
-- stocked kitchen is mostly restocks, so a 57-item scan sent 49 of them; on 2026-09-17 each took
-- ~370 ms at the API (the UPDATEs themselves run in milliseconds) and the Add-all spinner stayed up
-- for 8.1 s. One call does the same work in one request.
--
-- SECURITY INVOKER: RLS ("Users manage own pantry") still applies, and the explicit auth.uid()
-- filter keeps the statement to the caller's rows even for a role that bypasses RLS. Matching is
-- lower(trim()) on both sides — the same key the client already dedupes on, and the case-insensitive
-- equality the per-row ilike (with wildcards escaped) expressed.
create or replace function public.restock_pantry_items(p_names text[])
returns integer
language sql
security invoker
set search_path = public
as $$
  with updated as (
    update public.pantry_items
       set in_stock = true,
           last_confirmed_at = now()
     where user_id = auth.uid()
       and lower(trim(name)) in (select lower(trim(n)) from unnest(p_names) as n)
    returning 1
  )
  select count(*)::int from updated;
$$;

revoke all on function public.restock_pantry_items(text[]) from public, anon;
grant execute on function public.restock_pantry_items(text[]) to authenticated;
