-- Rolling redemption budget for comp codes, so one permanent code renews instead of being
-- re-minted monthly.
--
-- Logan's ask was a fresh code each month (Pantry_Creator1!, 2!, ...) with 25 uses, so newly
-- signed creators are not blocked by a spent lifetime cap. The budget half is right; monthly
-- CODES are the wrong mechanism twice over:
--   * Guessability. 'PANTRY_CREATOR' is published in a public repo, so name+digit is a ~12 guess
--     space, validate_referral_code_v2 confirms a hit to an ANONYMOUS caller with no rate limit,
--     and the scheme is predictable forward — this month's code gives you next month's.
--   * Upkeep. Minting and re-distributing monthly is a chore that, when forgotten, blocks exactly
--     the new creators it was meant to serve.
--
-- So: keep one unguessable code forever and let its cap refill. Same shape as
-- _shared/scan-cap.ts's check_and_increment_scan_window, which already does rolling N-day caps.
-- Leak behaviour is better than rotation too: a leaker burns the window, redemption_count shows
-- it, and the budget restores itself without intervention.

-- NULL = max_redemptions is a lifetime total (unchanged; this is what 1-use personal codes use).
-- Set  = max_redemptions is allowed PER this many days, counted from referral_redemptions.
alter table referral_codes add column if not exists cap_window_days int;

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

  -- FOR UPDATE serialises every redemption of THIS code. The rolling count below is a
  -- read-then-decide, which under READ COMMITTED would let two concurrent racers both see 24
  -- used and both grant, overshooting the cap. The row lock is what makes the count exact; the
  -- lifetime path got the same guarantee for free from its conditional UPDATE.
  select * into v_row from referral_codes
   where code = v_norm and active = true
     and (expires_at is null or expires_at > now())
   for update;

  if not found then
    update profiles set referral_code_used = v_norm where id = v_uid;
    return jsonb_build_object('valid', false, 'grants_premium', false);
  end if;

  insert into referral_redemptions (user_id, code) values (v_uid, v_norm)
  on conflict (user_id, code) do nothing;
  v_first_time := found;

  if v_first_time and v_row.grants_premium then
    if v_row.max_redemptions is null then
      v_claimed := true;                       -- uncapped
    elsif v_row.cap_window_days is null then
      v_claimed := v_row.redemption_count < v_row.max_redemptions;   -- lifetime cap
    else
      -- Rolling window. The row inserted above is inside this count, so the caller is the Nth
      -- redemption and <= is the correct comparison: at cap 25 with 24 already used, this call
      -- counts 25 and is allowed; the next counts 26 and is not.
      select count(*) into v_window_used from referral_redemptions
       where code = v_norm and redeemed_at > now() - make_interval(days => v_row.cap_window_days);
      v_claimed := v_window_used <= v_row.max_redemptions;
    end if;

    -- redemption_count stays a LIFETIME total in both modes. It is not the gate for windowed
    -- codes, it is the signal Logan reads to notice a code has been shared around.
    if v_claimed then
      update referral_codes set redemption_count = redemption_count + 1 where code = v_norm;
    end if;
  end if;

  if v_first_time then
    if v_row.grants_premium and v_claimed then
      update profiles set promo_active = true, referral_code_used = v_norm where id = v_uid;
    else
      update profiles set referral_code_used = v_norm where id = v_uid;
    end if;
  end if;

  select promo_active into v_has_premium from profiles where id = v_uid;

  return jsonb_build_object(
    'valid', true,
    'grants_premium', coalesce(v_has_premium, false),
    'already_redeemed', not v_first_time,
    'exhausted', v_row.grants_premium and v_first_time and not v_claimed
  );
end;
$$;
grant execute on function redeem_referral_code(text) to authenticated;

-- The shared creator code was put on a 25-per-30-days budget here, BY LITERAL VALUE, and this
-- file is in a public repo. That republished a working premium code — the exact defect this
-- day's migrations exist to remove. The code was rotated in 20260904183000; the value is gone
-- from the working tree but remains in git history, which is why rotation was the fix rather
-- than an edit. Replacements are minted with scripts/creator-code.sh and live only in the
-- database. NEVER write a code value into this repo.
