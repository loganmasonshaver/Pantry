-- Email marketing infrastructure
-- Adds columns needed to track GDPR-compliant opt-in + the engagement signals
-- that Loops sequences read to decide whether to send / skip emails.

alter table profiles add column if not exists marketing_email_opt_in boolean not null default false;
alter table profiles add column if not exists marketing_consent_at timestamptz;

-- Engagement signals — kept synced to Loops as contact properties so sequence
-- conditions like "skip day 3 email if user is already engaged" work.
alter table profiles add column if not exists last_active_at timestamptz;
alter table profiles add column if not exists cook_tonight_used_count int not null default 0;
alter table profiles add column if not exists meals_saved_count int not null default 0;
alter table profiles add column if not exists goals_customized boolean not null default false;

-- Marketing-related subscription lifecycle markers (used by Loops sequences).
-- These are derived from Superwall events but cached here so Loops webhooks can
-- read them without needing live Superwall calls.
alter table profiles add column if not exists trial_started_at timestamptz;
alter table profiles add column if not exists trial_ended_at timestamptz;
alter table profiles add column if not exists subscribed_at timestamptz;
alter table profiles add column if not exists churned_at timestamptz;

-- Loops sync state — tracks which Loops events we've already fired for a user
-- so re-running the sync function is idempotent.
alter table profiles add column if not exists loops_contact_synced_at timestamptz;
create index if not exists profiles_last_active_idx on profiles(last_active_at);
create index if not exists profiles_trial_started_idx on profiles(trial_started_at);

-- Permission for the loops-sync edge function (runs with service role) to read
-- and write these columns is implicit via the existing RLS-bypass on service role.
