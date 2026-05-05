-- Waitlist table for heypantry.app landing page email capture
create table if not exists waitlist (
  id         uuid        primary key default gen_random_uuid(),
  email      text        not null,
  source     text        not null default 'landing',
  created_at timestamptz not null default now(),
  constraint waitlist_email_unique unique (email)
);

-- Only allow anonymous inserts — no reads, updates, or deletes for public
alter table waitlist enable row level security;

create policy "Public can join waitlist"
  on waitlist for insert
  to anon
  with check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');
