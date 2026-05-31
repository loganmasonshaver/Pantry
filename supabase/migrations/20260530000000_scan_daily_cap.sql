-- Per-user daily abuse ceiling for AI vision scans (pantry + receipt).
-- Premium-only model has no freemium counter, but unlimited scans is a real
-- cost/abuse vector: each scan is 1-2 GPT-4o vision calls, so a scripted client
-- could burn far more than the $7.99/mo subscription in OpenAI spend. This caps
-- exposure server-side where the client can't bypass it.

create table if not exists public.scan_usage (
  user_id   uuid not null references auth.users(id) on delete cascade,
  scan_type text not null,                 -- 'pantry' | 'receipt' (capped separately)
  day       date not null default current_date,  -- UTC day; resets at 00:00 UTC
  count     int  not null default 0,
  primary key (user_id, scan_type, day)
);

-- Lock the table down: only the SECURITY DEFINER functions below may touch it.
-- No RLS policies = no direct read/write for authenticated or anon roles, so a
-- user can't inspect or reset their own counter.
alter table public.scan_usage enable row level security;

-- Atomic check-and-increment. Doing the read, cap test, and increment inside one
-- locked transaction is what makes the cap race-proof — the old freemium client
-- counters let parallel requests all read the same pre-increment value and slip
-- past. Counts the ATTEMPT (called before the OpenAI request) so the cost-bearing
-- call is gated before any money is spent; transient failures are refunded below.
create or replace function public.check_and_increment_scan(p_scan_type text, p_cap int)
returns table(allowed boolean, used int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_used int;
begin
  if v_uid is null then
    allowed := false; used := 0; return next; return;
  end if;

  insert into scan_usage(user_id, scan_type, day, count)
    values (v_uid, p_scan_type, current_date, 0)
    on conflict (user_id, scan_type, day) do nothing;

  -- FOR UPDATE serializes concurrent scans for this (user, type, day) row.
  select count into v_used from scan_usage
    where user_id = v_uid and scan_type = p_scan_type and day = current_date
    for update;

  if v_used >= p_cap then
    allowed := false; used := v_used; return next; return;
  end if;

  update scan_usage set count = count + 1
    where user_id = v_uid and scan_type = p_scan_type and day = current_date
    returning count into v_used;

  allowed := true; used := v_used; return next;
end;
$$;

-- Refund one scan when the OpenAI call fails transiently (timeout / 5xx) so a
-- legitimate user isn't charged a slot for a failure they have to retry. Floors
-- at 0 so a double-refund can't manufacture extra quota.
create or replace function public.refund_scan(p_scan_type text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  update scan_usage set count = greatest(count - 1, 0)
    where user_id = v_uid and scan_type = p_scan_type and day = current_date;
end;
$$;

revoke all on function public.check_and_increment_scan(text, int) from public;
revoke all on function public.refund_scan(text) from public;
grant execute on function public.check_and_increment_scan(text, int) to authenticated;
grant execute on function public.refund_scan(text) to authenticated;
