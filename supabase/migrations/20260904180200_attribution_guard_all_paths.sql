-- Third correction to redeem_referral_code, same defect as the second, one branch over.
--
-- 20260904174500 stopped the UNKNOWN-code path clobbering profiles.referral_code_used, but the
-- valid-code-not-granted path (`elsif v_eligible`) still wrote unconditionally. So: redeem a
-- working code, get premium and attribution; later type a valid code whose cap is spent; the
-- attribution silently moves to the code that gave you nothing.
--
-- That column is what the creator programme pays 50% of first conversions against, so a silent
-- overwrite is a money bug, not a cosmetic one. Only ever fill a blank — except on an actual
-- grant, which is the one case where the new code genuinely is the reason the user has premium.
--
-- Lesson worth keeping: this function has three exits that touch referral_code_used and the fix
-- was applied to them one at a time across three commits. When guarding a column, guard every
-- write to it in the same pass.

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

  select * into v_row from referral_codes
   where code = v_norm and active = true
     and (expires_at is null or expires_at > now())
   for update;

  if not found then
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

  v_eligible := v_first_time or not coalesce(v_prior_granted, false);

  if v_eligible and v_row.grants_premium then
    if v_row.max_redemptions is null then
      v_claimed := true;
    elsif v_row.cap_window_days is null then
      v_claimed := v_row.redemption_count < v_row.max_redemptions;
    else
      select count(*) into v_window_used from referral_redemptions
       where code = v_norm and granted
         and redeemed_at > now() - make_interval(days => v_row.cap_window_days);
      v_claimed := v_window_used < v_row.max_redemptions;
    end if;

    if v_claimed then
      update referral_redemptions set granted = true, redeemed_at = now()
       where user_id = v_uid and code = v_norm;
      update referral_codes set redemption_count = redemption_count + 1 where code = v_norm;
    end if;
  end if;

  if v_row.grants_premium and v_claimed then
    -- An actual grant is the only case that may REPLACE existing attribution: this code is now
    -- demonstrably why the user has premium.
    update profiles set promo_active = true, referral_code_used = v_norm where id = v_uid;
  elsif v_eligible then
    -- Valid code, nothing granted (attribution-only code, or a spent cap). Fill a blank only.
    update profiles set referral_code_used = v_norm
     where id = v_uid and referral_code_used is null;
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
