-- SECURITY: refund_scan was granted to `authenticated`, which made every AI cost cap optional.
--
-- The cap is enforced by check_and_increment_scan{,_window}, but refund_scan simply decrements
-- the caller's counter and required no evidence that a scan had actually failed. The anon key
-- ships in the app bundle, so anyone who signs up could loop:
--
--   POST /functions/v1/scan-pantry           -> counter 0 -> 1, burns a GPT-5.4 vision call
--   POST /rest/v1/rpc/refund_scan {pantry}   -> counter 1 -> 0
--
-- and never reach the ceiling. It defeated all seven caps that share this function (pantry,
-- receipt, meal_gen, recipe_gen, macro_est, url_extract, image_gen). The greatest(count-1, 0)
-- floor only stopped negative quota; it did nothing about refunding a real increment.
--
-- The refund calls also went straight to PostgREST, so the per-IP limiter in the edge functions
-- never saw them, and the DB-backed cap is documented as the real ceiling behind that limiter.
--
-- Fix: the refund is a SERVER decision, so take the identity from the server instead of from
-- auth.uid(). The new signature takes the user id explicitly and is executable only by
-- service_role; _shared/scan-cap.ts now verifies the JWT itself and calls it with the service key.

-- Old signature is removed outright — leaving it in place would leave the grant path open.
drop function if exists public.refund_scan(text);

create or replace function public.refund_scan(p_user_id uuid, p_scan_type text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then return; end if;
  -- Floors at 0 so a double refund can't manufacture extra quota. Only today's row is
  -- decremented: every increment targets today's row, including the rolling-window variant.
  update scan_usage set count = greatest(count - 1, 0)
    where user_id = p_user_id and scan_type = p_scan_type and day = current_date;
end;
$$;

-- No client role may call this. service_role does not bypass function EXECUTE grants, so it
-- needs an explicit one; anon/authenticated get nothing.
revoke all on function public.refund_scan(uuid, text) from public, anon, authenticated;
grant execute on function public.refund_scan(uuid, text) to service_role;
