-- Two fixes to 20260904171500, both raised by the pre-push review. The first is a real defect.
--
-- 1. DENIED ATTEMPTS ATE THE BUDGET. The referral_redemptions row is written before the cap is
--    evaluated, and the rolling count counted every row in the window. So callers 26+ each left a
--    row that suppressed grants for the next 30 days: the cap behaved as "25 ATTEMPTS per window",
--    not "25 grants". Under continuous demand it never fully refilled, and since signup is free,
--    anyone could have starved the creator budget with attempts that granted nothing.
--
--    Fix: record whether the attempt was actually GRANTED and count only those. Keeping the row
--    for denials (rather than not inserting) preserves the audit trail — you can still see demand
--    that was turned away.
--
-- 2. A previously-denied user could never come back. `on conflict do nothing` made v_first_time
--    false on a retry, so someone refused at the cap stayed refused forever even once the window
--    refilled. Retrying after a denial is the correct behaviour and now works; a retry after a
--    SUCCESSFUL redemption is still a no-op.
--
-- 3. The unknown-code path overwrote profiles.referral_code_used unconditionally, so a user who
--    had redeemed a valid code and later typed a typo lost the attribution on their row. Now only
--    fills a blank. (Pre-existing since 20260606010000, not introduced by the rolling cap.)

alter table referral_redemptions add column if not exists granted boolean not null default false;
-- Every row predating this column existed only because a redemption was recorded, so they are
-- grants. No-op today (the table is empty) but correct if replayed against a populated database.
update referral_redemptions set granted = true where redeemed_at < now();

create or replace function redeem_referral_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_norm text;
  v_row  referral_codes%rowtype;
  v_first_time boolean;
  v_prior_granted boolean;
  v_eligible boolean;
  v_claimed boolean := false;
  v_window_used int;
  v_has_premium boolean;
begin
  if v_uid is null then
    return jsonb_build_object('valid', false, 'grants_premium', false);
  end if;

  v_norm := upper(trim(coalesce(p_code, '')));
  if length(v_norm) = 0 then
    return jsonb_build_object('valid', false, 'grants_premium', false);
  end if;

  -- Serialises redemptions of THIS code. The windowed path is read-then-decide, which without the
  -- lock lets two racers both see 24 used and both grant.
  select * into v_row from referral_codes
   where code = v_norm and active = true
     and (expires_at is null or expires_at > now())
   for update;

  if not found then
    -- Attribution for a mistyped code, but never clobber a code the user already redeemed.
    update profiles set referral_code_used = v_norm
     where id = v_uid and referral_code_used is null;
    return jsonb_build_object('valid', false, 'grants_premium', false);
  end if;

  insert into referral_redemptions (user_id, code, granted) values (v_uid, v_norm, false)
  on conflict (user_id, code) do nothing;
  v_first_time := found;

  if not v_first_time then
    select granted into v_prior_granted from referral_redemptions
     where user_id = v_uid and code = v_norm;
  end if;

  -- A previous DENIAL is not a redemption. Let them try again now the window may have refilled.
  v_eligible := v_first_time or not coalesce(v_prior_granted, false);

  if v_eligible and v_row.grants_premium then
    if v_row.max_redemptions is null then
      v_claimed := true;
    elsif v_row.cap_window_days is null then
      v_claimed := v_row.redemption_count < v_row.max_redemptions;
    else
      -- This caller's own row is granted=false, so it is NOT in the count and `<` is correct.
      select count(*) into v_window_used from referral_redemptions
       where code = v_norm and granted
         and redeemed_at > now() - make_interval(days => v_row.cap_window_days);
      v_claimed := v_window_used < v_row.max_redemptions;
    end if;

    if v_claimed then
      update referral_redemptions set granted = true, redeemed_at = now()
       where user_id = v_uid and code = v_norm;
      -- Lifetime total, kept as the signal that a code is circulating more than expected.
      update referral_codes set redemption_count = redemption_count + 1 where code = v_norm;
    end if;
  end if;

  if v_row.grants_premium and v_claimed then
    update profiles set promo_active = true, referral_code_used = v_norm where id = v_uid;
  elsif v_eligible then
    update profiles set referral_code_used = v_norm where id = v_uid;
  end if;

  select promo_active into v_has_premium from profiles where id = v_uid;

  return jsonb_build_object(
    'valid', true,
    'grants_premium', coalesce(v_has_premium, false),
    'already_redeemed', coalesce(v_prior_granted, false),
    'exhausted', v_row.grants_premium and v_eligible and not v_claimed
  );
end;
$$;
grant execute on function redeem_referral_code(text) to authenticated;
