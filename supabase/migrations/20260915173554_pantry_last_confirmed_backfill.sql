-- The previous migration's `default now()` stamped every existing row with the migration's own
-- moment (2026-09-15 17:32:39 UTC, all 158 rows), so its backfill `where last_confirmed_at is null`
-- matched nothing: every item read "confirmed today" and the stale nudge would have stayed silent
-- for three weeks. Backfill from created_at, bounded to that one minute so a re-run can never touch
-- a confirmation the app has written since.
update pantry_items
set last_confirmed_at = created_at
where last_confirmed_at >= '2026-09-15 17:32:00+00' and last_confirmed_at < '2026-09-15 17:33:00+00'
  and last_confirmed_at > created_at;
