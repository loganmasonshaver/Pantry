-- Rolling-window scan cap (e.g. "7 per rolling 7 days") for the expensive GPT-4o vision
-- pantry scan. The existing check_and_increment_scan is calendar-day only; this variant
-- sums usage over the last p_days. Reuses the same scan_usage table + refund_scan.

create or replace function public.check_and_increment_scan_window(
  p_scan_type text,
  p_cap int,
  p_days int
)
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

  -- Ensure today's row exists, then lock it. All increments target today's row, so
  -- locking it serializes concurrent scans for this user and makes the window check race-proof.
  insert into scan_usage(user_id, scan_type, day, count)
    values (v_uid, p_scan_type, current_date, 0)
    on conflict (user_id, scan_type, day) do nothing;
  perform 1 from scan_usage
    where user_id = v_uid and scan_type = p_scan_type and day = current_date
    for update;

  -- Sum usage across the rolling window (today + the prior p_days-1 days).
  select coalesce(sum(count), 0) into v_used from scan_usage
    where user_id = v_uid and scan_type = p_scan_type
      and day > current_date - p_days;

  if v_used >= p_cap then
    allowed := false; used := v_used; return next; return;
  end if;

  update scan_usage set count = count + 1
    where user_id = v_uid and scan_type = p_scan_type and day = current_date;

  allowed := true; used := v_used + 1; return next;
end;
$$;

revoke all on function public.check_and_increment_scan_window(text, int, int) from public;
grant execute on function public.check_and_increment_scan_window(text, int, int) to authenticated;
