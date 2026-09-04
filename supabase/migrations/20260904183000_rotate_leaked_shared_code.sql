-- ROTATION: the shared comp code created earlier today was written into
-- 20260904171500_referral_rolling_cap.sql as a literal and pushed to a PUBLIC repo. Same defect
-- as PANTRY_CREATOR, introduced by the very session that removed it, roughly an hour later.
--
-- Editing that file does not fix it — the value is in git history and the repo is public — so the
-- code has to be rotated, not hidden. Deactivate here; the replacement is minted with
-- scripts/creator-code.sh, which returns the value and writes it to no file.
--
-- Deliberately identified WITHOUT naming the value: the only active premium code carrying a
-- rolling window is the one being rotated. Writing the literal again to retire it would republish
-- it a second time.
--
-- STANDING RULE, now also in scripts/creator-code.sh and docs/PRELAUNCH.md 6e:
-- a code value NEVER enters a file in this repo. Not a migration, not a doc, not a comment.
-- Mint with the script; the database is the only place a working code exists.
update referral_codes
   set active = false
 where grants_premium and active and cap_window_days is not null;
