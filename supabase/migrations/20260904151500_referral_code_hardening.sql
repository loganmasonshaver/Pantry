-- SECURITY: a permanent premium bypass was published in a PUBLIC GitHub repo.
--
-- 20260512000000_promo_codes.sql seeds 'PANTRY_CREATOR' with grants_premium = TRUE, active,
-- no expires_at and no redemption limit. github.com/loganmasonshaver/Pantry is public, so the
-- whole bypass is three steps with no exploit required:
--
--   1. read the code out of the migration on GitHub
--   2. sign up (free)
--   3. rpc redeem_referral_code('PANTRY_CREATOR')  -> promo_active = TRUE, forever
--
-- _shared/premium.ts gates every paid endpoint on (is_premium OR promo_active), so that is the
-- entire paywall. Even unpublished the code was weak: "app name + role" is what a wordlist
-- produces on the first pass.
--
-- Deactivating does NOT revoke grants already applied — promo_active is a column on profiles and
-- stays TRUE on rows that already have it. The App Review demo account keeps its access.

-- ── 1. Kill the published code ────────────────────────────────────────────────────────────────
update referral_codes set active = false where code = 'PANTRY_CREATOR';

-- ── 2. Make a guessed code worth less ─────────────────────────────────────────────────────────
-- NULL max_redemptions = unlimited, so every existing code behaves exactly as before.
alter table referral_codes add column if not exists max_redemptions  int;
alter table referral_codes add column if not exists redemption_count int not null default 0;

-- ── 3. Enforce the cap inside the grant path ──────────────────────────────────────────────────
-- Identity still comes from auth.uid(), never a parameter. search_path is pinned here — it was
-- missing on this function while the newer refund_scan/increment_vote_score both pin it.
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
    -- Unknown code: still record attribution, but no premium.
    update profiles set referral_code_used = v_norm where id = v_uid;
    return jsonb_build_object('valid', false, 'grants_premium', false);
  end if;

  -- Single-use gate per (user, code).
  insert into referral_redemptions (user_id, code) values (v_uid, v_norm)
  on conflict (user_id, code) do nothing;
  v_first_time := found;

  if v_first_time and v_row.grants_premium then
    -- Claim a slot ATOMICALLY. Doing this as a conditional UPDATE rather than
    -- read-then-write is what stops concurrent redemptions oversubscribing a limited code:
    -- the row lock is held for the duration of the update, so exactly one of N racers wins
    -- the last slot. NOT FOUND here means the cap is already spent.
    update referral_codes
       set redemption_count = redemption_count + 1
     where code = v_norm
       and (max_redemptions is null or redemption_count < max_redemptions);
    v_claimed := found;
  end if;

  if v_first_time then
    if v_row.grants_premium and v_claimed then
      update profiles set promo_active = true, referral_code_used = v_norm where id = v_uid;
    else
      -- Exhausted cap, or a non-premium code: attribution only. The creator still gets credit.
      update profiles set referral_code_used = v_norm where id = v_uid;
    end if;
  end if;

  return jsonb_build_object(
    'valid', true,
    -- Report what the caller actually GOT, not what the code advertises — a exhausted code
    -- must not tell the client it granted premium when the trigger-protected column says no.
    'grants_premium', v_row.grants_premium and (v_claimed or not v_first_time),
    'already_redeemed', not v_first_time,
    'exhausted', v_row.grants_premium and v_first_time and not v_claimed
  );
end;
$$;
grant execute on function redeem_referral_code(text) to authenticated;

-- ── 4. Drop the dead v1 oracle ────────────────────────────────────────────────────────────────
-- Superseded by validate_referral_code_v2 in 20260512000000 and referenced NOWHERE in app code,
-- but never dropped — so it stayed EXECUTE-able by anon. Same overload hygiene that already
-- caught refund_scan(text) and increment_vote_score(uuid,int).
drop function if exists public.validate_referral_code(text);

-- ── 5. Pin search_path on the remaining live SECURITY DEFINER functions ───────────────────────
-- Defense in depth: not currently reachable (authenticated cannot create objects in public on a
-- default Supabase project), but an unpinned search_path on a definer function is the standard
-- escalation path, and the newer functions in this codebase all pin it. ALTER, not CREATE, so no
-- function body is rewritten here. Tolerant of a signature drift rather than aborting the file.
do $$
begin
  alter function public.insert_saved_meal(uuid, text, int, int, int, int, int, jsonb, jsonb, text)
    set search_path = public;
exception when undefined_function then raise notice 'insert_saved_meal signature differs, skipped';
end $$;

do $$
begin
  alter function public.validate_referral_code_v2(text) set search_path = public;
exception when undefined_function then raise notice 'validate_referral_code_v2 missing, skipped';
end $$;

do $$
begin
  alter function public.increment_recipe_log_count() set search_path = public;
exception when undefined_function then raise notice 'increment_recipe_log_count missing, skipped';
end $$;
