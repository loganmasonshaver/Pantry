-- Two corrections to redeem_referral_code from 20260904152600, both raised by the pre-push review.
--
-- 1. `grants_premium` was reported as `v_row.grants_premium and (v_claimed or not v_first_time)`.
--    On a REPEAT call v_first_time is false, so it returned the code's advertised value without
--    checking whether the caller ever actually received the grant. The case that gets this wrong:
--    a user redeems a code whose cap is already spent -> ledger row written, no promo_active. Call
--    again -> "grants_premium: true" for a grant they never got. The whole point of the previous
--    commit was to report what the caller GOT rather than what the code advertises, and the repeat
--    branch did the opposite. It now reads promo_active back instead of inferring it.
--
-- 2. The slot-claiming UPDATE re-checked neither `active` nor `expires_at`. Between the SELECT and
--    the UPDATE a code could be deactivated or expire and still be claimed. The window is tiny and
--    an attacker cannot steer it, but re-stating both predicates on the UPDATE costs nothing and
--    makes the claim self-contained rather than trusting a read taken microseconds earlier.

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
     and (expires_at is null or expires_at > now());

  if not found then
    update profiles set referral_code_used = v_norm where id = v_uid;
    return jsonb_build_object('valid', false, 'grants_premium', false);
  end if;

  insert into referral_redemptions (user_id, code) values (v_uid, v_norm)
  on conflict (user_id, code) do nothing;
  v_first_time := found;

  if v_first_time and v_row.grants_premium then
    -- Conditional UPDATE, so exactly one of N concurrent racers wins the last slot. active and
    -- expires_at are re-asserted here so the claim does not rely on the SELECT above still holding.
    update referral_codes
       set redemption_count = redemption_count + 1
     where code = v_norm
       and active = true
       and (expires_at is null or expires_at > now())
       and (max_redemptions is null or redemption_count < max_redemptions);
    v_claimed := found;
  end if;

  if v_first_time then
    if v_row.grants_premium and v_claimed then
      update profiles set promo_active = true, referral_code_used = v_norm where id = v_uid;
    else
      update profiles set referral_code_used = v_norm where id = v_uid;
    end if;
  end if;

  -- Read the truth back rather than inferring it. promo_active is trigger-protected, so this is
  -- the authoritative answer to "does this caller have premium from a code?" in both branches.
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
