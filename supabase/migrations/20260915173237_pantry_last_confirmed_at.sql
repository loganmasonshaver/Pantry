-- When the user last confirmed an item is still there. The pantry could only grow: every write
-- set in_stock TRUE and the only path to FALSE was a toggle buried in a collapsed category, so
-- meal generation cooked from an ever-growing fiction. The Pantry tab now asks "12 items untouched
-- for 3+ weeks — still have them?" and answers land here (keep → now(), used up → in_stock false).
-- Age = now() - coalesce(last_confirmed_at, created_at); existing rows start from created_at.
alter table pantry_items add column if not exists last_confirmed_at timestamptz default now();
update pantry_items set last_confirmed_at = created_at where last_confirmed_at is null or last_confirmed_at > now();
